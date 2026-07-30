"""READ-ONLY dev-viewer dump: how should a pinching lens give its space back?

Between two sections the builder blends their vertical stacks. A body present on
only one section is a lens and is deliberately pinched toward zero
(``max(0, 2w - 1)``). The blended thicknesses are then laid out CUMULATIVELY
DOWNWARD from a single top anchor, so the thickness the lens gives up is never
absorbed — everything below it rides up by that amount. Measured on the dev model:
the deepest base drifts a median +0.369 m and up to +7.863 m, ALWAYS upward.

For MATCHED bodies the cumulative layout is exact — ``blended_top - sum(blended
thickness)`` is identically ``w1*base1 + w2*base2``. Only the pinch breaks it. So
the question is narrow: when a lens dies out, what fills the space it vacates?

This dumps the three candidate answers, computed on REAL data, for the static
viewer in ``blend_viewer/`` to draw:

``today``   the current rule — nothing fills it; everything below rides up.
``host``    the body enclosing the lens closes over it; nothing else moves.
``spread``  every unit scales so the column closes on the interpolated base.
``deepest`` the bottom unit absorbs the whole residual.

The walk is PERPENDICULAR to the section, from a point on its fence toward the
second-nearest section, because ON the fence the weight is 1.0 and no lens dies.
That is the only place the difference is visible.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/dump_blend_compare.py
    uv run python scripts/dump_blend_compare.py --left GEO-23/125-S6 --right GEO-10/170-S11
    uv run python scripts/dump_blend_compare.py --fraction 0.5 --steps 40
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
    _blend_stacks,
    _blended_top,
    _Entry,
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
from scripts.eval_strat_fidelity import (  # noqa: E402
    _confirm_db_target,
    _load_formation_names,
)

#: Sentinel formation for a slot that reserves space but holds no material.
_VOID = "__void__"


def _pinch(w: float) -> float:
    """The one-sided pinch factor: full at its own section, zero at the midline."""
    return max(0.0, 2.0 * w - 1.0)


def _participants(
    stack1: list[_Entry], stack2: list[_Entry], w1: float
) -> list[tuple[float, str | None, str, float, float, bool]]:
    """One slot per participant, shallow -> deep.

    A SLOT is the vertical space the blend honestly reserves for something; the
    BODY is how much material the pinch actually puts inside it. For matched
    bodies the two are equal. For a body seen on one section only the slot is
    ``w * th`` — the linear share — while the pinch grants ``max(0, 2w - 1) * th``.
    An internal void in a section's own stack is a participant too, with a slot of
    ``w * v`` and no body at all: that is what stops a hole in one section being
    closed up and lifting everything below it.

    The point of slots is that ``sum(slot) == w1*span1 + w2*span2 == top - base``
    identically, so a column laid out from them closes on the interpolated base by
    construction — there is no residual to redistribute.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The two sections' stacks, shallow -> deep.
    w1 : float
        Inverse-distance weight for ``stack1``.

    Returns
    -------
    list of (float, str or None, str, float, float, bool)
        ``(ref_mid, body_id, formation_id, slot, body, lens)`` shallow -> deep.
    """
    w2 = 1.0 - w1
    mid = lambda e: (e.top_elev + e.base_elev) / 2.0  # noqa: E731
    g1: dict[str, list[_Entry]] = {}
    g2: dict[str, list[_Entry]] = {}
    for e in stack1:
        if e.body_id is not None:
            g1.setdefault(e.body_id, []).append(e)
    for e in stack2:
        if e.body_id is not None:
            g2.setdefault(e.body_id, []).append(e)
    matched = set(g1) & set(g2)

    out: list[tuple[float, str | None, str, float, float, bool]] = []
    for stack, w in ((stack1, w1), (stack2, w2)):
        for e in stack:
            if e.body_id is not None and e.body_id in matched:
                continue
            th = _th(e)
            out.append((mid(e), e.body_id, e.formation_id, w * th, _pinch(w) * th, True))
        # Internal voids: a gap between consecutive entries of this section's own
        # stack. It reserves space and contributes no material.
        for hi, lo in zip(stack, stack[1:]):
            gap = hi.base_elev - lo.top_elev
            if gap > 1e-6:
                out.append(
                    (
                        (hi.base_elev + lo.top_elev) / 2.0,
                        None,
                        _VOID,
                        w * gap,
                        0.0,
                        False,
                    )
                )
    for body in matched:
        occ1 = sorted(g1[body], key=lambda e: -e.top_elev)
        occ2 = sorted(g2[body], key=lambda e: -e.top_elev)
        paired = min(len(occ1), len(occ2))
        for e1, e2 in zip(occ1[:paired], occ2[:paired]):
            th = w1 * _th(e1) + w2 * _th(e2)
            out.append((w1 * mid(e1) + w2 * mid(e2), body, e1.formation_id, th, th, False))
        # A re-entrant body with MORE occurrences on one side leaves the extras
        # unpaired. They are one-sided like any other unmatched body — dropping
        # them would lose their slot and let the column climb, which is the very
        # defect being measured.
        for extras, w in ((occ1[paired:], w1), (occ2[paired:], w2)):
            for e in extras:
                th = _th(e)
                out.append((mid(e), body, e.formation_id, w * th, _pinch(w) * th, True))
    out.sort(key=lambda s: (-s[0], str(s[1])))
    return out


def _layout_slots(
    parts: list[tuple[float, str | None, str, float, float, bool]], top: float, mode: str
) -> list[dict]:
    """Lay slots out from ``top``. ``mode`` decides what happens to the surplus.

    Every mode closes on the same interpolated base, because the SLOTS sum to
    ``w1*span1 + w2*span2`` whatever is put inside them. They differ only in where
    a pinching lens's surplus (``slot - body``) goes.

    ``taper``  the body expands to fill its whole slot: it thins linearly and
               reaches zero AT the far section rather than at the midline.
    ``hold``   the body keeps the pinch's thickness, centred in its slot; the
               surplus is left UNKNOWN.
    ``host``   the body keeps the pinch's thickness; the surplus goes to the
               units bracketing it, half up and half down — the matrix closing
               back over a dying lens.
    """
    heights = [slot if mode == "taper" else body_h for _r, _b, _f, slot, body_h, _l in parts]
    slots = [slot for _r, _b, _f, slot, _bh, _l in parts]
    if mode == "host":
        # Hand each lens's surplus to its neighbours, half each; at either end of
        # the column the whole share goes inward, so the top and base stay put.
        # Every surplus is read from the ORIGINAL slots and applied afterwards —
        # computing and applying in one pass lets a lens overwrite what an adjacent
        # lens just gave it, which loses material and stops the column closing.
        gain = [0.0] * len(parts)
        for i, (_r, _b, _f, slot, body_h, _l) in enumerate(parts):
            surplus = slot - body_h
            if surplus <= _EPS:
                continue
            up = i - 1 if i > 0 else None
            down = i + 1 if i + 1 < len(parts) else None
            if up is None and down is None:
                continue
            slots[i] = body_h
            if up is None:
                gain[down] += surplus
            elif down is None:
                gain[up] += surplus
            else:
                gain[up] += surplus / 2.0
                gain[down] += surplus / 2.0
        for i, extra in enumerate(gain):
            if extra > 0.0:
                heights[i] += extra
                slots[i] += extra

    out: list[dict] = []
    cur = top
    for i, (_ref, body, formation, _slot, _body_h, lens) in enumerate(parts):
        height = heights[i]
        pad = (slots[i] - height) / 2.0
        b_top = cur - pad
        if height > _EPS and formation != _VOID:
            out.append(
                {
                    "body": body,
                    "formation": formation,
                    "top": b_top,
                    "base": b_top - height,
                    "lens": lens,
                }
            )
        cur -= slots[i]
    return out


def _candidates(stack1: list[_Entry], stack2: list[_Entry], w1: float) -> dict[str, list[dict]]:
    """The four columns to compare at one sample position.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The two sections' stacks at this point.
    w1 : float
        Inverse-distance weight for ``stack1``.

    Returns
    -------
    dict of str to list of dict
        ``today`` / ``taper`` / ``hold`` / ``host``, each
        ``{body, formation, top, base, lens}``.
    """
    top = _blended_top(stack1, stack2, w1) or 0.0
    parts = _participants(stack1, stack2, w1)
    engine = _blend_stacks(stack1, stack2, w1)
    return {
        "today": [
            {
                "body": e.body_id,
                "formation": e.formation_id,
                "top": e.top_elev,
                "base": e.base_elev,
                "lens": False,
            }
            for e in engine
        ],
        "taper": _layout_slots(parts, top, "taper"),
        "hold": _layout_slots(parts, top, "hold"),
        "host": _layout_slots(parts, top, "host"),
    }


async def main() -> None:
    """Write ``blend_viewer/model.json`` for the static comparison viewer."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--left", default="GEO-22/115-S10", help="left column of the gap")
    ap.add_argument("--right", default="GEO-10/170-S6", help="right column of the gap")
    ap.add_argument("--fraction", type=float, default=0.86, help="gap-local fraction to walk from")
    ap.add_argument(
        "--steps", type=int, default=60, help="samples from the fence to the far section"
    )
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "model.json"))
    args = ap.parse_args()

    print("\n=== BLEND COMPARISON DUMP (READ-ONLY) ===\n")
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

    origin = None
    for section in seated:
        ids = [inv.get(c.investigation_id, "?") for c in section.columns]
        if args.left not in ids:
            continue
        i = ids.index(args.left)
        if i + 1 < len(ids) and ids[i + 1] == args.right:
            origin = (section, i)
            break
    if origin is None:
        raise SystemExit(f"ABORT: gap {args.left} -> {args.right} not found on any section.")
    section, gap = origin
    left, right = section.columns[gap], section.columns[gap + 1]
    fx = left.world_x + (right.world_x - left.world_x) * args.fraction
    fy = left.world_y + (right.world_y - left.world_y) * args.fraction

    # The second-nearest section AT the fence point is the one we walk toward.
    ranked = sorted(
        ((s, *_project_to_section_fence(s, fx, fy)) for s in seated), key=lambda p: p[3]
    )
    second, _g2, _f2, dist2, px2, py2 = ranked[1]
    ids2 = [inv.get(c.investigation_id, "?") for c in second.columns]
    ux, uy = (px2 - fx) / max(dist2, _EPS), (py2 - fy) / max(dist2, _EPS)
    print(f"  gap {args.left} -> {args.right} at fraction {args.fraction}")
    print(f"  walking {dist2:.2f} m toward {' .. '.join(ids2[:2])}\n")

    samples: list[dict] = []
    for k in range(args.steps + 1):
        # Walk the WHOLE way to the second section's foot, not half: the pinch
        # only reaches zero at the midline (w = 0.5) and beyond, which is where
        # the two candidate rules visibly diverge.
        travel = dist2 * (k / args.steps)
        x, y = fx + ux * travel, fy + uy * travel
        projs = sorted(
            ((s, *_project_to_section_fence(s, x, y)) for s in seated), key=lambda p: p[3]
        )
        s1, g1, f1, d1, _p1x, _p1y = projs[0]
        s2, g2, f2, d2, _p2x, _p2y = projs[1]
        st1, st2 = _section_stack_at(s1, g1, f1), _section_stack_at(s2, g2, f2)
        if not st1 or not st2:
            continue
        w1 = 0.5 if (d1 + d2) < _EPS else d2 / (d1 + d2)
        cand = _candidates(st1, st2, w1)
        engine = _blend_stacks(st1, st2, w1)
        correct_base = w1 * min(e.base_elev for e in st1) + (1 - w1) * min(e.base_elev for e in st2)
        samples.append(
            {
                "travel": travel,
                "w1": w1,
                "correctBase": correct_base,
                "engineBase": min((e.base_elev for e in engine), default=None),
                **cand,
            }
        )

    payload = {
        "gap": f"{args.left} → {args.right}",
        "fraction": args.fraction,
        "towards": f"{ids2[0]} .. {ids2[1]}" if len(ids2) > 1 else ids2[0],
        "distanceM": dist2,
        "formations": {fid: names.get(fid, "?") for fid in names},
        "reference": [
            {
                "body": e.body_id,
                "formation": e.formation_id,
                "top": e.top_elev,
                "base": e.base_elev,
            }
            for e in _section_stack_at(
                *(lambda p: (p[0], p[1], p[2]))(
                    sorted(
                        ((s, *_project_to_section_fence(s, fx, fy)) for s in seated),
                        key=lambda p: p[3],
                    )[0]
                )
            )
        ],
        "samples": samples,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(f"  wrote {out} — {len(samples)} samples, {out.stat().st_size / 1024:.0f} kB\n")
    print("  serve it with:")
    print("      cd blend_viewer && python -m http.server 8801 --bind 127.0.0.1")
    print("  then open http://127.0.0.1:8801/\n")


if __name__ == "__main__":
    asyncio.run(main())
