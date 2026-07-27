"""READ-ONLY: audit the columns the widened footprint newly covers.

After the model footprint is widened to reach every drilled position, nine
previously-uncovered investigations get a voxel column.  Three of them score
``wrong`` on the acceptance gate.  This script decides, per column and on
evidence, whether that verdict is the EXPECTED deep-to-deep substrate below the
borehole's total depth (which the gate scores as a mismatch by design) or a
genuine reorder / invention WITHIN the drilled interval.

It also names the column that owns the worst contact-depth error, and re-checks
which investigations still contend for a single honor cell under the widened
grid (the grid origin moves when the footprint grows, so a contending pair can
dissolve — or appear — purely by grid phase).

Nothing is persisted; the DB is only read, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_voxel_newly_covered.py
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _investigation_columns_from_picks,
)
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.honor_precedence import honor_rank  # noqa: E402
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import (  # noqa: E402
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_voxel_label_columns import _load_payload, _slug  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column,
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_PAYLOAD = _REPO_ROOT / "scripts" / "throwaway_v2_voxel_payload.json"

# The nine investigations the feet-only footprint left uncovered.
_NEWLY_COVERED = ("7c2b", "7c62", "7c2a", "7c4e", "7c4a", "7c4b", "7c4d", "7c4c", "7c36")

# A model unit whose TOP sits more than this above the borehole's total depth is
# inside the drilled interval, so a mismatch there is a genuine defect rather
# than the below-TD substrate.  One vertical voxel (0.25 m) plus margin.
_BELOW_TD_MARGIN_M = 0.30


async def main() -> None:
    """Build the widened-footprint model in memory and audit the new columns."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--payload", type=Path, default=_DEFAULT_PAYLOAD)
    args = ap.parse_args()

    print("\n=== NEWLY-COVERED COLUMN AUDIT (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        names = await _load_formation_names(session, args.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        model = await session.get(GeologicalModelOrm, args.model_id)
        geo_surfaces: tuple = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)
        project = await ProjectRepository(session).get_by_id(model.app_project_id)
        seg = (project.view_state or {}).get("litho_segmenter") or {}
        snap_tol = float(seg.get("litho_snap_tolerance_m") or 0.20)
        h = float(seg.get("voxel_horizontal_spacing_m") or 2.0)
        v = float(seg.get("voxel_vertical_spacing_m") or h)

    sections, _ph, _pv = _load_payload(args.payload)
    inv_columns = _investigation_columns_from_picks(picks)
    columns = _authored_columns(picks)
    positions = tuple((c.investigation_id, c.world_x, c.world_y) for c in inv_columns)

    domain = build_domain_from_sections(sections, investigation_positions=positions)
    grid = label_voxels(
        domain,
        h,
        sections,
        vertical_spacing_m=v,
        investigation_columns=inv_columns,
        geo_surfaces=geo_surfaces,
        litho_snap_tolerance_m=snap_tol,
    )
    meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
    active = [(m.body_id, m.formation_id, m.vertices, m.triangles) for m in meshes]
    print(
        f"  widened build: {len(meshes)} bodies, grid {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)}"
    )

    # --- honor contention under the WIDENED grid ---------------------------
    # The selection reads the PRODUCTION rule (``honor_rank``) rather than a
    # copy of it: a diagnostic that re-implements the thing it is checking will
    # eventually report a winner the build does not agree with.
    by_id = {c.investigation_id: c for c in inv_columns}
    honored: dict[tuple[int, int], str] = {}
    cell_of: dict[str, tuple[int, int]] = {}
    for inv in inv_columns:
        if not inv.intervals:
            continue
        ci = int(np.argmin(np.abs(grid.gx - inv.world_x)))
        cj = int(np.argmin(np.abs(grid.gy - inv.world_y)))
        cell_of[inv.investigation_id] = (ci, cj)
        prev = honored.get((ci, cj))
        if prev is None or honor_rank(inv) < honor_rank(by_id[prev]):
            honored[(ci, cj)] = inv.investigation_id
    losers = [i for i, cell in cell_of.items() if honored[cell] != i]
    print("\n  --- honor contention under the WIDENED grid ---")
    if not losers:
        print("    none — every investigation owns its own column.")
    for loser in sorted(losers):
        winner = honored[cell_of[loser]]
        print(
            f"    {_slug(loser)} LOSES its honor cell {cell_of[loser]} to {_slug(winner)} "
            "— it is labelled from its neighbour's log"
        )

    # --- the newly covered columns -----------------------------------------
    print("\n  --- the nine newly covered columns ---")
    worst = (0.0, "", 0.0, 0.0)
    for inv_id, x, y, authored in sorted(columns, key=lambda c: c[0]):
        stack = _compute_model_stack(x, y, active)
        auth_td = authored[-1][2]
        aseq = [names.get(u[0], u[0][:8]) for u in authored]
        mseq = [names.get(r[0], r[0][:8]) for r in stack]
        # Worst contact-depth error across ALL columns (the gate's pairing walk).
        pos = 0
        for fid, _top, auth_base in authored:
            while pos < len(stack) and stack[pos][0] != fid:
                pos += 1
            if pos >= len(stack):
                break
            err = abs(stack[pos][1] - auth_base)
            if err > worst[0]:
                worst = (err, _slug(inv_id), auth_base, stack[pos][1])
            pos += 1

        if _slug(inv_id) not in _NEWLY_COVERED:
            continue
        verdict = _classify_column(authored, stack) if stack else "uncovered"
        k = 0
        while k < len(aseq) and k < len(mseq) and aseq[k] == mseq[k]:
            k += 1
        extras = stack[k:]
        above_td = [e for e in extras if e[2] > auth_td + _BELOW_TD_MARGIN_M]
        print(
            f"\n    {_slug(inv_id)}  verdict={verdict}  drilled_TD={auth_td:8.3f}  "
            f"authored_prefix_matched={k}/{len(aseq)}  extras={len(extras)}  "
            f"extras_INSIDE_drilled_interval={len(above_td)}"
        )
        print(f"      authored: {' / '.join(aseq)}")
        print(f"      model   : {' / '.join(mseq)}")
        for e in above_td:
            print(
                f"      >>> INSIDE-INTERVAL extra: {names.get(e[0], e[0][:8])} "
                f"top={e[2]:.3f} base={e[1]:.3f}"
            )

    print(
        f"\n  worst contact-depth error: {worst[0]:.3f} m at {worst[1]} "
        f"(authored base {worst[2]:.3f} vs model base {worst[3]:.3f})"
    )
    print("\n=== AUDIT COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
