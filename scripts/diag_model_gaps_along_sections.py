"""READ-ONLY: find the VOIDS in the built model, along every section's fence path.

The acceptance gate (``eval_strat_fidelity``) only scores the model AT the
investigation columns, so it reports "uncovered: 0" while the space BETWEEN
columns is full of holes. This script looks at the space between them, which is
what the section view actually renders.

Definition used, deliberately independent of the 2-D partition: an **interior
void** is an elevation interval at a sample point that has model material both
ABOVE and BELOW it but nothing in it. That is unambiguously a defect — no
appeal to what "should" be filled is needed — and it is exactly what reads as a
gap on screen.

Sampling follows the SAME path the renderer slices: ``sectionFromSolids`` cuts
leg by leg between consecutive test columns' WORLD positions (the fence
polyline), not along the straight start->end line. Scanning the straight line
instead reports zero voids on a model whose section view is full of them — the
columns sit metres off the line, so the two paths cross different ground.

Each void is reported with the section, the leg it falls on, the elevation range,
and the two investigation columns it sits between, so it can be matched against
what the owner sees.

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_model_gaps_along_sections.py
    uv run python scripts/diag_model_gaps_along_sections.py --section "Cross-section 1"
    uv run python scripts/diag_model_gaps_along_sections.py --step 0.5 --min-void 0.2
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

from groundmodel.application.project_investigations_onto_section import (  # noqa: E402
    project_investigations_onto_section,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
    _load_solids,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Scan every section line for interior voids in the persisted model."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--section", default=None, help="only this section (by name)")
    ap.add_argument("--step", type=float, default=1.0, help="sample step along the line (m)")
    ap.add_argument(
        "--min-void",
        type=float,
        default=0.15,
        help="ignore voids thinner than this (m) — below the voxel height they are seams",
    )
    args = ap.parse_args()

    print("\n=== MODEL VOIDS ALONG THE SECTION LINES (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, args.model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {args.model_id} not found.")
        project_id = model.app_project_id

        names = await _load_formation_names(session, args.model_id)
        solids = await _load_solids(session, args.model_id)

        inv_names: dict[UUID, str] = {}
        inv_xy: dict[UUID, tuple[float, float]] = {}
        for orm in (CptOrm, BoreholeOrm):
            for r in (
                await session.execute(
                    select(orm.id, orm.name, orm.location_x, orm.location_y).where(
                        orm.app_project_id == project_id
                    )
                )
            ).all():
                inv_names[r.id] = r.name
                if r.location_x is not None and r.location_y is not None:
                    inv_xy[r.id] = (float(r.location_x), float(r.location_y))

        sections = (
            await session.execute(
                select(
                    CrossSectionOrm.id,
                    CrossSectionOrm.name,
                    CrossSectionOrm.start_x,
                    CrossSectionOrm.start_y,
                    CrossSectionOrm.end_x,
                    CrossSectionOrm.end_y,
                )
                .where(CrossSectionOrm.app_project_id == project_id)
                .order_by(CrossSectionOrm.name)
            )
        ).all()

        alongs: dict[UUID, dict[UUID, float]] = {}
        for sec in sections:
            if args.section and sec.name != args.section:
                continue
            alongs[sec.id] = await project_investigations_onto_section(
                session, project_id=project_id, section_id=sec.id
            )

    active = [(b, f, v, t) for b, f, v, t, flagged, _s in solids if v and t and not flagged]
    print(
        f"  {len(active)} active body solids; step {args.step} m; "
        f"ignoring voids < {args.min_void} m\n"
    )

    grand_total = 0
    for sec in sections:
        if args.section and sec.name != args.section:
            continue
        # The columns in along-order, WITH their true world positions — the
        # renderer walks this polyline leg by leg, so the scan must too.
        cols = sorted(
            (
                (dist, inv_names.get(inv, str(inv)[:8]), *inv_xy[inv])
                for inv, dist in alongs[sec.id].items()
                if inv in inv_xy
            ),
            key=lambda c: c[0],
        )
        if len(cols) < 2:
            continue

        # Merge consecutive samples that show the same void into one finding, so
        # a 6 m wide hole reads as one gap rather than six.
        runs: list[dict] = []
        samples: list[tuple[float, float, float, str]] = []
        cursor = 0.0
        for (da, na, xa, ya), (db, nb, xb, yb) in zip(cols, cols[1:]):
            leg = math.hypot(xb - xa, yb - ya)
            label = f"{na} .. {nb}"
            n = max(1, int(leg / args.step))
            for k in range(n + 1):
                t = k / n
                samples.append((cursor + t * leg, xa + (xb - xa) * t, ya + (yb - ya) * t, label))
            cursor += leg

        for distance, x, y, leg_label in samples:
            stack = _compute_model_stack(x, y, active)
            if len(stack) < 2:
                continue
            # stack is (formation_id, base, top) sorted top -> bottom.
            for upper, lower in zip(stack, stack[1:]):
                void_top = lower[2]  # top of the deeper interval
                void_base = upper[1]  # base of the shallower interval
                size = void_base - void_top
                if size < args.min_void:
                    continue
                merged = False
                for run in runs:
                    if (
                        abs(run["last"] - distance) <= args.step * 1.5
                        and run["top"] > void_top - 1.0
                        and run["base"] < void_base + 1.0
                    ):
                        run["last"] = distance
                        run["top"] = min(run["top"], void_top)
                        run["base"] = max(run["base"], void_base)
                        run["max"] = max(run["max"], size)
                        merged = True
                        break
                if not merged:
                    runs.append(
                        {
                            "first": distance,
                            "last": distance,
                            "top": void_top,
                            "base": void_base,
                            "max": size,
                            "above": names.get(upper[0], "?"),
                            "below": names.get(lower[0], "?"),
                            "leg": leg_label,
                        }
                    )

        if runs:
            print(
                # ``cursor`` is the accumulated FENCE length (the polyline through
                # the columns' true positions), which is the path actually scanned
                # — not the straight start->end distance.
                f"  {sec.name}  ({cursor:.0f} m of fence, {len(cols)} columns) — "
                f"{len(runs)} void run(s):"
            )
            for run in sorted(runs, key=lambda r: -r["max"]):
                width = run["last"] - run["first"] + args.step
                print(
                    f"      along {run['first']:>6.0f}-{run['last']:<6.0f} m "
                    f"({width:>5.1f} m wide)  elev {run['base']:>7.2f}..{run['top']:<7.2f} "
                    f"(max {run['max']:.2f} m)  {run['above']} over {run['below']}"
                    f"   [{run['leg']}]"
                )
            grand_total += len(runs)
            print()

    print(f"  TOTAL void runs across the scanned sections: {grand_total}\n")


if __name__ == "__main__":
    asyncio.run(main())
