"""Recompute the cached TIN for one formation in one model.

Called by every contact-mutating use case after its DB writes
land. Loads the formation's contacts, joins each to its anchor's
(x, y, surface elevation), runs Delaunay via the TIN service, and
upserts the result into the ``formation_surface`` cache row.

Cache-validity short-circuit: if the recomputed checksum matches
the cached one, no DB write fires. Lets a no-op refresh (e.g.
re-PATCH that ended up at the same depth) skip the upsert.

Recompute scope rules
---------------------

* Single mutation → recompute ONE (model, formation) pair.
* PATCH that changes ``formation_id`` → recompute BOTH the old
  and new formations (caller's responsibility to pass both ids).
* Batch mutations → caller collects every affected
  (model, formation) tuple + calls this once per pair after the
  batch commit. Avoids N redundant recomputes inside the loop.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.tin_surface import (
    ContactPoint3D,
    checksum_contacts,
    compute_tin,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RecomputeFormationSurface(GroundModelLogger):
    """Refresh the cached TIN for a (model, formation) pair."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, model_id: UUID, formation_id: UUID) -> bool:
        """Recompute and upsert the surface row.

        Parameters
        ----------
        model_id : UUID
        formation_id : UUID

        Returns
        -------
        bool
            ``True`` when the cache was refreshed (DB write happened),
            ``False`` when the existing row's checksum already matched
            the recomputed contacts (no-op).
        """
        self.debug(f"recompute entry: model={model_id} formation={formation_id}")
        # Load the contacts. Eager-load the polymorphic anchor on each
        # so a single round-trip carries everything we need to build
        # the (x, y, elevation_m) tuples.
        contacts = list(
            (
                await self._session.execute(
                    select(FormationContactOrm).where(
                        FormationContactOrm.model_id == model_id,
                        FormationContactOrm.formation_id == formation_id,
                    )
                )
            )
            .scalars()
            .all()
        )

        # Bulk-load the unique anchor ids referenced by these contacts.
        # Two queries because borehole_id and cpt_id are XOR-nullable;
        # one query each is simpler than a UNION.
        bh_ids: set[UUID] = {c.borehole_id for c in contacts if c.borehole_id is not None}
        cpt_ids: set[UUID] = {c.cpt_id for c in contacts if c.cpt_id is not None}
        boreholes_by_id: dict[UUID, BoreholeOrm] = (
            {
                b.id: b
                for b in (
                    await self._session.execute(
                        select(BoreholeOrm).where(BoreholeOrm.id.in_(bh_ids))
                    )
                    if bh_ids
                    else iter([])
                )
                .scalars()
                .all()
            }
            if bh_ids
            else {}
        )
        cpts_by_id: dict[UUID, CptOrm] = (
            {
                c.id: c
                for c in (
                    await self._session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids)))
                    if cpt_ids
                    else iter([])
                )
                .scalars()
                .all()
            }
            if cpt_ids
            else {}
        )

        # Build ContactPoint3D for each contact whose anchor has a
        # complete (x, y, surface_elevation). Skip the rest — the TIN
        # would be polluted by NaN points and the user's intent was
        # "elevation unknown, place me on the section but don't
        # interpolate from me."
        points: list[ContactPoint3D] = []
        for c in contacts:
            anchor: BoreholeOrm | CptOrm | None = None
            if c.borehole_id is not None:
                anchor = boreholes_by_id.get(c.borehole_id)
            elif c.cpt_id is not None:
                anchor = cpts_by_id.get(c.cpt_id)
            if anchor is None:
                continue
            if anchor.location_x is None or anchor.location_y is None or anchor.elevation_m is None:
                continue
            points.append(
                ContactPoint3D(
                    contact_id=str(c.id),
                    x_m=anchor.location_x,
                    y_m=anchor.location_y,
                    elevation_m=anchor.elevation_m - c.depth_top_m,
                )
            )

        new_checksum = checksum_contacts(points)
        existing = (
            await self._session.execute(
                select(FormationSurfaceOrm).where(
                    FormationSurfaceOrm.model_id == model_id,
                    FormationSurfaceOrm.formation_id == formation_id,
                )
            )
        ).scalar_one_or_none()

        if existing is not None and existing.source_contact_checksum == new_checksum:
            self.debug(
                f"recompute no-op: model={model_id} formation={formation_id} checksum unchanged"
            )
            return False

        surface = compute_tin(points)
        # Serialise to plain JSONB-friendly lists.
        vertices_payload = [list(v) for v in surface.vertices]
        triangles_payload = [list(t) for t in surface.triangles]

        # Upsert via Postgres ON CONFLICT on the (model, formation)
        # unique constraint — one round-trip whether the row exists
        # or not. PG-specific but we're already PG-only.
        stmt = pg_insert(FormationSurfaceOrm).values(
            id=uuid7() if existing is None else existing.id,
            model_id=model_id,
            formation_id=formation_id,
            method="tin",
            vertices=vertices_payload,
            triangles=triangles_payload,
            source_contact_count=len(points),
            source_contact_checksum=new_checksum,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_formation_surface_model_formation",
            set_=dict(
                method="tin",
                vertices=vertices_payload,
                triangles=triangles_payload,
                source_contact_count=len(points),
                source_contact_checksum=new_checksum,
            ),
        )
        await self._session.execute(stmt)
        self.debug(
            f"recompute upsert: model={model_id} formation={formation_id} "
            f"vertices={len(vertices_payload)} triangles={len(triangles_payload)}"
        )
        return True

    async def execute_many(self, pairs: Iterable[tuple[UUID, UUID]]) -> int:
        """Convenience: recompute multiple (model, formation) pairs.

        Returns the number of pairs that actually wrote (no-op
        recomputes don't count). Used by batch mutation use cases
        that affect several formations at once.
        """
        unique = list({(m, f) for m, f in pairs})
        wrote = 0
        for model_id, formation_id in unique:
            if await self.execute(model_id, formation_id):
                wrote += 1
        return wrote
