"""READ-ONLY dev-viewer dump: the pinching lens as a 3-D body, one per rule.

``dump_blend_compare.py`` shows one column at a time, which is hard to judge. This
samples a PATCH of ground — along the section from the left test to the right test,
and away from the section toward its nearest neighbour — and records, at every node,
what each candidate rule does to one chosen lens and to the floor beneath it.

The lens is the thing to watch: it is present on this section and absent on the
neighbour, so it must die out somewhere in between. The three rules disagree about
where and about what takes its place, and the floor underneath is the tell — today
it rides up by whatever the lens gave away.

Axes of the patch:

* ``x`` — along the section, left test to right test (the 2-D partition's own axis)
* ``y`` — away from the section toward the neighbour; 0 is on the section line
* ``z`` — elevation, mTAW

For each rule the dump records the lens's top and base surfaces over the patch and
the column's deepest base, so the viewer can draw the lens as a solid and the floor
as a surface underneath it.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/dump_blend_3d.py
    uv run python scripts/dump_blend_3d.py --left GEO-23/125-S6 --right GEO-10/170-S11
    uv run python scripts/dump_blend_3d.py --along 31 --perp 31
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _EPS,
    _project_to_section_fence,
    _section_stack_at,
    _th,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.dump_blend_compare import _candidates  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _confirm_db_target,
    _load_formation_names,
)

_RULES = ("today", "taper", "hold", "host")


def _pick_lens(stack1: list, stack2: list) -> str | None:
    """The thickest body present on stack 1 and absent from stack 2.

    That is a lens by the builder's own definition — one-sided, therefore pinched —
    and the thickest one is the one whose disappearance is worth watching.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The two sections' stacks at the reference point.

    Returns
    -------
    str or None
        The chosen ``body_id``, or ``None`` when every body is matched.
    """
    theirs = {e.body_id for e in stack2 if e.body_id is not None}
    mine = [e for e in stack1 if e.body_id is not None and e.body_id not in theirs]
    if not mine:
        return None
    return max(mine, key=_th).body_id


async def main() -> None:
    """Write ``blend_viewer/model3d.json`` for the 3-D comparison viewer."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--left", default="GEO-22/115-S10")
    ap.add_argument("--right", default="GEO-10/170-S6")
    ap.add_argument("--along", type=int, default=25, help="samples along the section")
    ap.add_argument("--perp", type=int, default=25, help="samples away from the section")
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "model3d.json"))
    args = ap.parse_args()

    print("\n=== 3-D BLEND PATCH DUMP (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        gen = (
            (
                await session.execute(
                    select(LithoBuildGenerationOrm).order_by(
                        LithoBuildGenerationOrm.created_at.desc()
                    )
                )
            )
            .scalars()
            .first()
        )
        if gen is None:
            raise SystemExit("ABORT: no stored build generation — click Build once.")
        picks = await LithoLayerRepository(session).load_body_picks(gen.model_id)
        names = await _load_formation_names(session, gen.model_id)
        inv: dict[str, str] = {}
        for orm in (CptOrm, BoreholeOrm):
            for row in (await session.execute(select(orm.id, orm.name))).all():
                inv[str(row.id)] = row.name

    aliases = dict(gen.body_aliases or {})
    seated, _moved, _shift = apply_true_column_positions(
        apply_body_aliases(_sections_from_payload(gen.payload), aliases),
        _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases),
    )

    found = None
    for section in seated:
        ids = [inv.get(c.investigation_id, "?") for c in section.columns]
        if args.left in ids:
            i = ids.index(args.left)
            if i + 1 < len(ids) and ids[i + 1] == args.right:
                found = (section, i)
                break
    if found is None:
        raise SystemExit(f"ABORT: gap {args.left} -> {args.right} not found.")
    section, gap = found
    left, right = section.columns[gap], section.columns[gap + 1]

    # The neighbour we walk toward, measured from the middle of the gap.
    mx = (left.world_x + right.world_x) / 2.0
    my = (left.world_y + right.world_y) / 2.0
    ranked = sorted(
        ((s, *_project_to_section_fence(s, mx, my)) for s in seated), key=lambda p: p[3]
    )
    second, _g2, _f2, reach, px2, py2 = ranked[1]
    towards = " .. ".join(inv.get(c.investigation_id, "?") for c in second.columns[:2])
    ux, uy = (px2 - mx) / max(reach, _EPS), (py2 - my) / max(reach, _EPS)

    # The lens to follow: chosen at the middle of the gap, on the section line.
    ref1 = _section_stack_at(section, gap, 0.5)
    s2, g2b, f2b, _d2, _x2, _y2 = ranked[1]
    ref2 = _section_stack_at(s2, g2b, f2b)
    lens_body = _pick_lens(ref1, ref2)
    if lens_body is None:
        raise SystemExit("ABORT: every body at this gap is matched — no lens to watch.")
    lens_formation = next(e.formation_id for e in ref1 if e.body_id == lens_body)
    print(f"  gap {args.left} -> {args.right}, {reach:.1f} m to {towards}")
    print(f"  lens = {names.get(lens_formation, '?')} body {lens_body[:13]}\n")

    alongs = [k / (args.along - 1) for k in range(args.along)]
    perps = [reach * k / (args.perp - 1) for k in range(args.perp)]

    grids: dict[str, dict[str, list[list[float | None]]]] = {
        rule: {"lensTop": [], "lensBase": [], "floor": []} for rule in _RULES
    }
    for frac in alongs:
        rows = {rule: {"lensTop": [], "lensBase": [], "floor": []} for rule in _RULES}
        bx = left.world_x + (right.world_x - left.world_x) * frac
        by = left.world_y + (right.world_y - left.world_y) * frac
        for dist in perps:
            x, y = bx + ux * dist, by + uy * dist
            projs = sorted(
                ((s, *_project_to_section_fence(s, x, y)) for s in seated), key=lambda p: p[3]
            )
            s1, g1, f1, d1, _a, _b = projs[0]
            sB, gB, fB, dB, _c, _d = projs[1]
            st1, st2 = _section_stack_at(s1, g1, f1), _section_stack_at(sB, gB, fB)
            if not st1 or not st2:
                for rule in _RULES:
                    for key in ("lensTop", "lensBase", "floor"):
                        rows[rule][key].append(None)
                continue
            w1 = 0.5 if (d1 + dB) < _EPS else dB / (d1 + dB)
            cand = _candidates(st1, st2, w1)
            for rule in _RULES:
                units = cand[rule]
                mine = [u for u in units if u["body"] == lens_body]
                rows[rule]["lensTop"].append(max((u["top"] for u in mine), default=None))
                rows[rule]["lensBase"].append(min((u["base"] for u in mine), default=None))
                rows[rule]["floor"].append(min((u["base"] for u in units), default=None))
        for rule in _RULES:
            for key in ("lensTop", "lensBase", "floor"):
                grids[rule][key].append(rows[rule][key])

    payload = {
        "gap": f"{args.left} -> {args.right}",
        "left": args.left,
        "right": args.right,
        "towards": towards,
        "gapLengthM": math.hypot(right.world_x - left.world_x, right.world_y - left.world_y),
        "reachM": reach,
        "lensFormation": names.get(lens_formation, "?"),
        "alongFractions": alongs,
        "perpM": perps,
        "leftColumn": [
            {"formation": names.get(e.formation_id, "?"), "top": e.top_elev, "base": e.base_elev}
            for e in _section_stack_at(section, gap, 0.02)
        ],
        "rightColumn": [
            {"formation": names.get(e.formation_id, "?"), "top": e.top_elev, "base": e.base_elev}
            for e in _section_stack_at(section, gap, 0.98)
        ],
        "rules": grids,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(
        f"  wrote {out.name} — {args.along}x{args.perp} nodes, {out.stat().st_size / 1024:.0f} kB"
    )
    for rule in _RULES:
        present = sum(1 for row in grids[rule]["lensTop"] for v in row if v is not None)
        floors = [v for row in grids[rule]["floor"] for v in row if v is not None]
        print(
            f"      {rule:<6} lens present at {present:>4} of {args.along * args.perp} nodes, "
            f"floor {min(floors):.2f} .. {max(floors):.2f} m"
        )
    print()


if __name__ == "__main__":
    asyncio.run(main())
