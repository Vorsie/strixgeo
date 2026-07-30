"""READ-ONLY dev-viewer dump: the ground between FOUR tests, one grid per rule.

A lens dies out between two tests — that much is the 2-D partition's own rule and
the builder never touches it. What this dump is about is the OTHER direction: away
from the section, toward the next section, where nothing was ever drawn and the
builder blends the two sections' stacks instead.

To see that you need four tests, not two: the pair on this section, where the lens
is present, and the pair on the neighbouring section, where it is absent. Those four
corners bound the patch the lens has to die across.

The dump samples that patch on a grid and records, at every node, the WHOLE blended
column under each candidate rule — so the viewer can draw real stratigraphic panels
rather than one body floating in the dark.

Axes of the patch (right-handed, elevation up):

* ``x`` — along the section, left test to right test
* ``z`` — straight out from the middle of the gap, perpendicular to it; 0 is on the
  section line
* ``y`` — elevation, mTAW

The far edge is where this section stops being the nearest one and the neighbour
takes over — that handover is the midline the builder pinches lenses at — walked to
and then the same distance again, so the far edge sits as deep in the neighbour's
territory as the near edge sits in this one. Neither of the two obvious shortcuts
works: the second-nearest SECTION can lie almost along this one rather than beside
it, and a perpendicular RAY never meets the tie-sections it runs parallel to.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/dump_blend_3d.py
    uv run python scripts/dump_blend_3d.py --left GEO-23/125-S6 --right GEO-10/170-S11
    uv run python scripts/dump_blend_3d.py --along 51 --perp 9
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


def _column_units(section, gap: int, fraction: float, names: dict[str, str]) -> list[dict]:
    """The authored 2-D column at one fraction of a gap, as plain dicts.

    Parameters
    ----------
    section : _Section
        The section carrying the gap.
    gap : int
        Index of the left column of the gap.
    fraction : float
        Position across the gap, 0 at the left column and 1 at the right.
    names : dict of str to str
        Formation id to display name.

    Returns
    -------
    list of dict
        ``{f, t, b}`` per unit — formation name, top and base elevation.
    """
    return [
        {"f": names.get(e.formation_id, "?"), "t": round(e.top_elev, 3), "b": round(e.base_elev, 3)}
        for e in _section_stack_at(section, gap, fraction)
    ]


def _handover_distance(
    sections: list, near, mx: float, my: float, nx: float, ny: float, cap: float
) -> float | None:
    """How far out along a ray another section takes over as the nearest one.

    That handover is the midline the builder pinches lenses at, so it is the natural
    far edge of the patch: walk to it and the same distance again, and the far edge
    sits as deep in the neighbour's territory as the near edge sits in this one.

    Intersecting the ray with the other fences does not work here — cross-sections and
    their tie-sections are near enough to perpendicular that a ray cast off one runs
    parallel to the others and never meets them.

    Parameters
    ----------
    sections : list of _Section
        Every section in the build, including ``near``.
    near : _Section
        The section the ray starts on.
    mx, my : float
        Where the ray starts — the middle of the gap being studied.
    nx, ny : float
        Unit direction of the ray.
    cap : float
        Stop looking beyond this distance, in metres.

    Returns
    -------
    float or None
        Distance at which another section becomes nearest, or ``None`` when this
        section stays nearest all the way out to ``cap``.
    """
    step = max(cap / 400.0, 0.25)
    t = step
    while t <= cap:
        x, y = mx + nx * t, my + ny * t
        closest = min(sections, key=lambda s: _project_to_section_fence(s, x, y)[2])
        if closest is not near:
            return t
        t += step
    return None


async def main() -> None:
    """Write ``blend_viewer/model3d.json`` for the four-test comparison viewer."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--left", default="GEO-22/115-S10")
    ap.add_argument("--right", default="GEO-10/170-S6")
    ap.add_argument("--along", type=int, default=41, help="samples along the section")
    ap.add_argument("--perp", type=int, default=7, help="panels away from the section")
    ap.add_argument("--cap", type=float, default=600.0, help="how far out to look, metres")
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "model3d.json"))
    args = ap.parse_args()

    print("\n=== FOUR-TEST BLEND PATCH DUMP (READ-ONLY) ===\n")
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

    # Walk perpendicular to this gap, whichever side reaches another section first.
    gap_len = math.hypot(right.world_x - left.world_x, right.world_y - left.world_y)
    ex_x, ex_y = (right.world_x - left.world_x) / gap_len, (right.world_y - left.world_y) / gap_len
    mx = (left.world_x + right.world_x) / 2.0
    my = (left.world_y + right.world_y) / 2.0
    live = [
        (sign, handover)
        for sign in (1.0, -1.0)
        if (
            handover := _handover_distance(
                seated, section, mx, my, -ex_y * sign, ex_x * sign, args.cap
            )
        )
        is not None
    ]
    if not live:
        raise SystemExit(
            f"ABORT: this section stays the nearest one for {args.cap:.0f} m either side "
            "of the gap — raise --cap or pick a gap with a closer neighbour."
        )
    sign, handover = min(live, key=lambda p: p[1])
    ux, uy = -ex_y * sign, ex_x * sign
    reach = handover * 2.0
    far_section, far_gap, far_frac, _far_d, _fx, _fy = min(
        ((s, *_project_to_section_fence(s, mx + ux * reach, my + uy * reach)) for s in seated),
        key=lambda p: p[3],
    )

    # The lens to follow: chosen at the middle of the gap, on the section line.
    ref1 = _section_stack_at(section, gap, 0.5)
    ref2 = _section_stack_at(far_section, far_gap, far_frac)
    lens_body = _pick_lens(ref1, ref2)
    if lens_body is None:
        raise SystemExit("ABORT: every body at this gap is matched — no lens to watch.")
    lens_formation = next(e.formation_id for e in ref1 if e.body_id == lens_body)

    print(f"  near section: {args.left} -> {args.right}  ({gap_len:.1f} m apart)")
    print(
        f"  far  section: handover at {handover:.1f} m, patch runs to {reach:.1f} m, "
        f"gap column {far_gap} at fraction {far_frac:.2f}"
    )
    print(f"  lens = {names.get(lens_formation, '?')} body {lens_body[:13]}\n")

    # Patch frame: origin at the left test, x along the gap chord, z along the ray.
    def _to_patch(cx: float, cy: float) -> tuple[float, float]:
        dx, dy = cx - left.world_x, cy - left.world_y
        return dx * ex_x + dy * ex_y, dx * ux + dy * uy

    tests = []
    for sec, g, near_frac, side in (
        (section, gap, 0.02, "near"),
        (section, gap, 0.98, "near"),
        (far_section, far_gap, 0.02, "far"),
        (far_section, far_gap, 0.98, "far"),
    ):
        col = sec.columns[g if near_frac < 0.5 else g + 1]
        px, pz = _to_patch(col.world_x, col.world_y)
        tests.append(
            {
                "name": inv.get(col.investigation_id, "?"),
                "side": side,
                "x": round(px, 2),
                "z": round(pz, 2),
                "units": _column_units(sec, g, near_frac, names),
            }
        )

    alongs = [gap_len * k / (args.along - 1) for k in range(args.along)]
    perps = [reach * k / (args.perp - 1) for k in range(args.perp)]

    # rules[rule][along index][perp index] = the whole column at that node
    grids: dict[str, list[list[list[dict]]]] = {rule: [] for rule in _RULES}
    for dist_along in alongs:
        frac = dist_along / gap_len
        bx = left.world_x + (right.world_x - left.world_x) * frac
        by = left.world_y + (right.world_y - left.world_y) * frac
        rows: dict[str, list[list[dict]]] = {rule: [] for rule in _RULES}
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
                    rows[rule].append([])
                continue
            w1 = 0.5 if (d1 + dB) < _EPS else dB / (d1 + dB)
            cand = _candidates(st1, st2, w1)
            for rule in _RULES:
                rows[rule].append(
                    [
                        {
                            "f": names.get(u["formation"], "?"),
                            "t": round(u["top"], 3),
                            "b": round(u["base"], 3),
                            "y": u["body"],
                        }
                        for u in cand[rule]
                        if u["top"] - u["base"] > 1e-4
                    ]
                )
        for rule in _RULES:
            grids[rule].append(rows[rule])

    payload = {
        "gap": f"{args.left} -> {args.right}",
        "towards": " .. ".join(t["name"] for t in tests if t["side"] == "far"),
        "gapLengthM": round(gap_len, 2),
        "reachM": round(reach, 2),
        "lensBody": lens_body,
        "lensFormation": names.get(lens_formation, "?"),
        "alongM": [round(v, 2) for v in alongs],
        "perpM": [round(v, 2) for v in perps],
        "tests": tests,
        "rules": grids,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(
        f"  wrote {out.name} — {args.along}x{args.perp} nodes, {out.stat().st_size / 1024:.0f} kB"
    )
    for rule in _RULES:
        bases = [
            min((u["b"] for u in col), default=None) for row in grids[rule] for col in row if col
        ]
        real = [b for b in bases if b is not None]
        lens = sum(1 for row in grids[rule] for col in row if any(u["y"] == lens_body for u in col))
        print(
            f"      {rule:<6} lens in {lens:>4} of {args.along * args.perp} columns, "
            f"floor {min(real):.2f} .. {max(real):.2f} m"
        )
    print()


if __name__ == "__main__":
    asyncio.run(main())
