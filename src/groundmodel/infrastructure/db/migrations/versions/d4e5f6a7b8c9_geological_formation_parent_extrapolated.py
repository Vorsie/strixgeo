"""geological_formation — add parent_extrapolated + backfill orphans via TIN.

Revision ID: d4e5f6a7b8c9
Revises: c3d7e982f146
Create Date: 2026-05-21 00:00:00.000000

Debt #87. Two parts:

1. Add ``parent_extrapolated bool NOT NULL DEFAULT false`` to
   ``geological_formation``.  The column flags litho-unit rows whose
   ``parent_formation_id`` was inferred by TIN extrapolation (no contact
   covered the depth) so the inspector can show an amber dot + confirm /
   reassign / detach dialog.

2. Backfill every existing orphan litho unit
   (``litho_main_soil_code IS NOT NULL AND parent_formation_id IS NULL``).
   For each orphan: pick any one of its contacts, load the investigation
   (cpt or borehole) for its (x, y, elevation_m), load the parent geological
   model's cached TIN surfaces, and run the same youngest-surface-above-
   target-z extrapolation the runtime accept path uses.  On success: set
   ``parent_formation_id`` + ``parent_extrapolated=True``.  On failure
   (stale TINs, investigation outside footprint, suggestion above all
   surfaces, missing elevation): leave the row as-is and log it.

Self-contained: imports nothing from the application/domain layer.  The
barycentric helper is inlined so this migration runs even if the runtime
``evaluate_tin_at`` is later moved or renamed.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3d7e982f146"
branch_labels = None
depends_on = None


def _evaluate_tin_at(
    vertices: list[list[float]],
    triangles: list[list[int]],
    x: float,
    y: float,
) -> float | None:
    """Inlined copy of ``domain.services.tin_surface.evaluate_tin_at``.

    Returns the barycentric-interpolated elevation at (x, y), or None when
    the point sits outside every triangle.  Migration-local copy: do not
    consolidate with the runtime helper — Alembic migrations must stay
    independent of evolving app code.
    """
    if not triangles:
        return None
    for tri in triangles:
        ia, ib, ic = tri[0], tri[1], tri[2]
        ax, ay, az = vertices[ia][0], vertices[ia][1], vertices[ia][2]
        bx, by, bz = vertices[ib][0], vertices[ib][1], vertices[ib][2]
        cx, cy, cz = vertices[ic][0], vertices[ic][1], vertices[ic][2]
        denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if denom == 0.0:
            continue
        w_a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
        w_b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
        w_c = 1.0 - w_a - w_b
        if w_a >= 0.0 and w_b >= 0.0 and w_c >= 0.0:
            return w_a * az + w_b * bz + w_c * cz
    return None


def _extrapolate_parent(
    target_z: float,
    surfaces: list[tuple[UUID, bool, list[list[float]], list[list[int]]]],
    inv_x: float,
    inv_y: float,
) -> UUID | None:
    """Pick the geology formation whose TIN sits just above ``target_z``.

    Mirrors :meth:`AcceptLithoSuggestions._extrapolate_parent_from_tins`.
    """
    candidates: list[tuple[float, UUID]] = []
    for fid, is_stale, vertices, triangles in surfaces:
        if is_stale or not vertices:
            continue
        z = _evaluate_tin_at(vertices, triangles, inv_x, inv_y)
        if z is None:
            continue
        if z >= target_z:
            candidates.append((z, fid))
    if not candidates:
        return None
    return min(candidates, key=lambda c: c[0])[1]


def upgrade() -> None:
    """Add parent_extrapolated column + backfill existing orphans."""
    op.add_column(
        "geological_formation",
        sa.Column(
            "parent_extrapolated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    bind = op.get_bind()

    # --- Step 1: find every orphan litho unit ----------------------------------
    orphans = bind.execute(
        sa.text(
            """
            SELECT id, app_project_id
            FROM geological_formation
            WHERE litho_main_soil_code IS NOT NULL
              AND parent_formation_id IS NULL
            """
        )
    ).all()

    if not orphans:
        return

    fixed = 0
    unfixable = 0

    for orphan_id, app_project_id in orphans:
        # --- Step 2: pick any contact for this orphan to find an anchor -------
        contact = bind.execute(
            sa.text(
                """
                SELECT fc.depth_top_m, fc.borehole_id, fc.cpt_id, fc.model_id
                FROM formation_contact fc
                WHERE fc.formation_id = :fid
                LIMIT 1
                """
            ),
            {"fid": orphan_id},
        ).first()
        if contact is None:
            # Orphan with zero contacts — nothing to anchor against.
            unfixable += 1
            continue

        depth_top_m, borehole_id, cpt_id, litho_model_id = contact

        # --- Step 3: resolve the parent geological model id -------------------
        parent_geo_model_id_row = bind.execute(
            sa.text(
                """
                SELECT parent_geological_model_id
                FROM geological_model
                WHERE id = :id
                """
            ),
            {"id": litho_model_id},
        ).first()
        if parent_geo_model_id_row is None or parent_geo_model_id_row[0] is None:
            unfixable += 1
            continue
        parent_geo_model_id = parent_geo_model_id_row[0]

        # --- Step 4: load investigation (x, y, elevation) ---------------------
        if borehole_id is not None:
            inv_row = bind.execute(
                sa.text(
                    """
                    SELECT location_x, location_y, elevation_m
                    FROM borehole
                    WHERE id = :id
                    """
                ),
                {"id": borehole_id},
            ).first()
        else:
            inv_row = bind.execute(
                sa.text(
                    """
                    SELECT location_x, location_y, elevation_m
                    FROM cpt
                    WHERE id = :id
                    """
                ),
                {"id": cpt_id},
            ).first()
        if inv_row is None:
            unfixable += 1
            continue
        inv_x, inv_y, inv_elev_m = inv_row
        if inv_elev_m is None:
            # No surveyed elevation → cannot convert depth to absolute z.
            unfixable += 1
            continue

        # --- Step 5: load all geology TIN surfaces in the parent model --------
        surface_rows: Sequence[Any] = bind.execute(
            sa.text(
                """
                SELECT formation_id, is_stale, vertices, triangles
                FROM formation_surface
                WHERE model_id = :mid
                """
            ),
            {"mid": parent_geo_model_id},
        ).all()
        surfaces = [(row[0], bool(row[1]), row[2] or [], row[3] or []) for row in surface_rows]
        if not surfaces:
            unfixable += 1
            continue

        # --- Step 6: extrapolate + commit -------------------------------------
        target_z = inv_elev_m - depth_top_m
        parent_fid = _extrapolate_parent(target_z, surfaces, inv_x, inv_y)
        if parent_fid is None:
            unfixable += 1
            continue

        bind.execute(
            sa.text(
                """
                UPDATE geological_formation
                SET parent_formation_id = :pfid,
                    parent_extrapolated = TRUE
                WHERE id = :id
                """
            ),
            {"pfid": parent_fid, "id": orphan_id},
        )
        fixed += 1

    # Migrations cannot use the GroundModelLogger (different runtime context);
    # raw print is the conventional Alembic diagnostic surface.
    print(
        f"[d4e5f6a7b8c9 backfill] {fixed} orphan litho unit(s) reparented "
        f"via TIN extrapolation, {unfixable} left unfixable "
        f"(no contacts / no elevation / no parent geo model / "
        f"outside TIN footprint / above all surfaces)."
    )


def downgrade() -> None:
    """Drop the parent_extrapolated column.

    The backfilled ``parent_formation_id`` values are NOT reverted — the
    relationships they encode remain valid even without the provenance
    flag.  A re-upgrade would simply leave them be (the orphan-list query
    no longer matches them) and not double-process.
    """
    op.drop_column("geological_formation", "parent_extrapolated")
