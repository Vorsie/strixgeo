"""READ-ONLY: walk the PERSISTED model between two adjacent columns.

The 3-D blend interpolates between the two nearest SECTIONS, not the two nearest
columns. Where a short tie section passes close to the midpoint of a long
section's leg, the tie can outvote the section the leg belongs to — and import a
lithology that neither bracketing column logs.

This script samples the persisted body solids at regular steps along the straight
line between two named investigations and prints the model stack at each step,
next to both endpoints' authored stacks. It also lists, for the midpoint, every
section ranked by perpendicular distance, so the "which sections voted" question
is answered from data rather than argued.

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_blend_between_columns.py --from GEO-23/125-S9 --to GEO-23/125-S8
    uv run python scripts/diag_blend_between_columns.py --from A --to B --step 2.0
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
    _load_solids,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


def _segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Return the distance from point ``p`` to the finite segment ``a``-``b``."""
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq <= 0.0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


async def main() -> None:
    """Sample the persisted model along the leg between two investigations."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--from", dest="from_name", required=True)
    ap.add_argument("--to", dest="to_name", required=True)
    ap.add_argument("--step", type=float, default=2.0, help="sample step in metres")
    args = ap.parse_args()

    print("\n=== BETWEEN-COLUMN BLEND WALK (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, args.model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {args.model_id} not found.")
        project_id = model.app_project_id

        # Investigation positions + surface elevations, CPTs and boreholes alike.
        pos: dict[str, tuple[UUID, float, float, float]] = {}
        for r in (
            await session.execute(
                select(
                    CptOrm.id, CptOrm.name, CptOrm.location_x, CptOrm.location_y, CptOrm.elevation_m
                ).where(CptOrm.app_project_id == project_id)
            )
        ).all():
            if r.location_x is not None and r.location_y is not None:
                pos[r.name] = (
                    r.id,
                    float(r.location_x),
                    float(r.location_y),
                    float(r.elevation_m or 0),
                )
        for r in (
            await session.execute(
                select(
                    BoreholeOrm.id,
                    BoreholeOrm.name,
                    BoreholeOrm.location_x,
                    BoreholeOrm.location_y,
                    BoreholeOrm.elevation_m,
                ).where(BoreholeOrm.app_project_id == project_id)
            )
        ).all():
            if r.location_x is not None and r.location_y is not None:
                pos[r.name] = (
                    r.id,
                    float(r.location_x),
                    float(r.location_y),
                    float(r.elevation_m or 0),
                )

        for name in (args.from_name, args.to_name):
            if name not in pos:
                raise SystemExit(
                    f"ABORT: investigation {name!r} not found (or has no coordinates)."
                )

        a_id, ax, ay, _a_elev = pos[args.from_name]
        b_id, bx, by, _b_elev = pos[args.to_name]
        leg = math.hypot(bx - ax, by - ay)
        print(f"  {args.from_name} -> {args.to_name}: {leg:.2f} m apart\n")

        names = await _load_formation_names(session, args.model_id)

        # Authored stacks at both ends, in mTAW.
        authored: dict[UUID, list[tuple[str, float, float]]] = {a_id: [], b_id: []}
        for r in (
            await session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.litho_main_soil_code,
                )
                .join(
                    GeologicalFormationOrm,
                    GeologicalFormationOrm.id == LithoLayerOrm.formation_id,
                )
                .where(
                    LithoLayerOrm.model_id == args.model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all():
            inv = r.cpt_id if r.cpt_id is not None else r.borehole_id
            if inv not in authored:
                continue
            surf = pos[args.from_name][3] if inv == a_id else pos[args.to_name][3]
            authored[inv].append(
                (r.litho_main_soil_code or "?", surf - r.depth_top_m, surf - r.depth_base_m)
            )
        for entries in authored.values():
            entries.sort(key=lambda u: -u[1])

        for label, inv in ((args.from_name, a_id), (args.to_name, b_id)):
            print(f"  AUTHORED {label}:")
            for soil, top, base in authored[inv]:
                print(f"      {soil:<6} {top:>8.3f} / {base:<8.3f}")
            print()

        # Sections ranked by distance from the leg midpoint.
        mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
        sec_rows = (
            await session.execute(
                select(
                    CrossSectionOrm.id,
                    CrossSectionOrm.name,
                    CrossSectionOrm.start_x,
                    CrossSectionOrm.start_y,
                    CrossSectionOrm.end_x,
                    CrossSectionOrm.end_y,
                ).where(CrossSectionOrm.app_project_id == project_id)
            )
        ).all()
        ranked = sorted(
            (
                (
                    _segment_distance(
                        mx, my, float(s.start_x), float(s.start_y), float(s.end_x), float(s.end_y)
                    ),
                    s.name,
                )
                for s in sec_rows
            ),
        )
        print(f"  SECTIONS by distance from the leg midpoint ({mx:.1f}, {my:.1f}):")
        for dist, name in ranked[:6]:
            print(f"      {dist:>8.2f} m   {name}")
        print()

        solids = await _load_solids(session, args.model_id)

    active = [(b, f, v, t) for b, f, v, t, flagged, _stale in solids if v and t and not flagged]
    print(
        f"  sampling the persisted model ({len(active)} active solids) every {args.step:.1f} m:\n"
    )

    steps = max(1, int(leg / args.step))
    for i in range(steps + 1):
        frac = i / steps
        x, y = ax + (bx - ax) * frac, ay + (by - ay) * frac
        stack = _compute_model_stack(x, y, active)
        rendered = " · ".join(
            f"{names.get(fid, fid[:6]):<5} {top:>7.2f}/{base:<7.2f}" for fid, base, top in stack
        )
        print(f"    {frac * leg:>6.1f} m  {rendered or '(no body)'}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
