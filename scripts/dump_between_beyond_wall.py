"""READ-ONLY: the wall where the blend stops interpolating and starts extruding.

``_stack_at`` (``domain/services/voxel_litho/label_voxels.py``) decides, at every map
point, between two regimes. When the point lies BETWEEN the two nearest sections it
blends them by distance; when it lies beyond them it extrudes the nearest section alone.
Nothing carries one regime into the other, so the column can change by whatever the two
regimes happen to disagree about, in a single 2 m step, wherever that boundary runs
(docs/debt.md #260).

This writes ``blend_viewer/wall.json`` so the boundary can be looked at in three
dimensions before anything is done about it: every in-footprint grid column with the
regime it fell under and the two sections it chose, and every adjacent pair of columns
whose shared body's top moved by half a metre or more across one step.

Nothing is measured that the builder does not already do. The stack at each column comes
from calling ``_stack_at`` itself, at the production settings, so the elevations here are
the elevations the build labelled. Only the regime and the section pair are recomputed,
because ``_stack_at`` decides them internally and does not return them; the recomputation
calls the same private helpers in the same order, so it agrees with the build by
construction rather than by resemblance.

One thing this run does NOT confirm. The regime flip #260 points at is real and is where
it says it is, but the 12.15 m attributed to it is not a body moving. Across that step
the two columns share every body they carry, and the deepest any of their roofs moves is
3 cm. The 12 m appears only when the two stacks are lined up by POSITION — the between
branch emits three hairline slivers the beyond branch does not, so from the fourth
interval down the nth entry of one column is a different body from the nth of the other.
Lined up that way the same step reads 12.14 m, which is #260's figure to the centimetre.
All three readings are printed at the end of a run so the difference is visible; only the
shared-body one is written out, because it is the only one that measures ground.

Read-only, dev-DB guarded, writes one JSON file and nothing else. Serve with
``cd blend_viewer && python -m http.server 8801 --bind 127.0.0.1``.

Usage
-----
    uv run python scripts/dump_between_beyond_wall.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _EPS,
    _Entry,
    _pair_occurrences,
    _project_to_section_fence,
    _section_stack_at,
    _stack_at,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (  # noqa: E402
    SectionPartitionInput,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.dump_tie_pinch_vs_midline import _name_sections  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

MIN_STEP_M: float = 0.5
"""Smallest jump across one 2 m step that is written out, in metres.

Below this the difference is the blend doing its job — two neighbouring columns sit at
slightly different distances from the same two sections, so the same body's top moves a
little. The wall is not that; it is the metres.
"""

HOTSPOT: tuple[float, float] = (88316.3, 164879.1)
"""The step #260 singles out on the owner's model, where the regime flips.

Carried through to the viewer so the scene can open on it, and used as this run's own
acceptance check: the recomputed regimes must still put a ``beyond`` column next to a
``between`` column here. If they do not, the decision has been reproduced wrongly and the
file draws something other than the wall, which the run says out loud rather than
shipping quietly.

The Y is a fifth of a metre off this generation's grid, whose rows sit at 164 347.29 plus
a multiple of 2 m. The nearest row is 164 879.29 and the flip is on it, so the tolerance
below covers the difference.
"""

HOTSPOT_TOL_M: float = 3.0
"""How close a step has to land to count as the one #260 measured, in metres."""


def _mode_and_pair(
    sections: list[SectionPartitionInput], x: float, y: float
) -> tuple[str, tuple[int, int] | None]:
    """Which regime ``_stack_at`` falls under at ``(x, y)``, and the sections it chose.

    This is ``_stack_at``'s own opening, kept line for line: project onto every section's
    column-world fence, rank by perpendicular distance, and ask whether the query point's
    projection onto the axis joining the two nearest feet lands inside that axis. Inside
    is BETWEEN and blends; outside is BEYOND and extrudes the nearest section alone.

    The pair is returned NEAREST FIRST, because the order is not cosmetic: under BEYOND
    the first section is the one extruded, and under BETWEEN it is the one that carries
    weight ``d2 / (d1 + d2)``. Two columns that pick the same two sections in the
    opposite order have not picked the same thing.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The seated sections, exactly as handed to ``label_voxels``.
    x, y : float
        The map-plane query point in metres, project CRS.

    Returns
    -------
    tuple of (str, tuple of int or None)
        ``('between' | 'beyond', (nearest index, second-nearest index))``. The pair is
        ``None`` when there is only one section, in which case the regime is always
        ``'beyond'`` — there is no second section to lie between.
    """
    projs = [(i, s, *_project_to_section_fence(s, x, y)) for i, s in enumerate(sections)]
    projs.sort(key=lambda p: p[4])  # by perpendicular distance
    i1 = projs[0][0]
    px1, py1 = projs[0][5], projs[0][6]
    if len(projs) < 2:
        return "beyond", None
    i2 = projs[1][0]
    px2, py2 = projs[1][5], projs[1][6]
    dx, dy = px2 - px1, py2 - py1
    axis2 = dx * dx + dy * dy
    t = 0.0 if axis2 < _EPS else ((x - px1) * dx + (y - py1) * dy) / axis2
    between = -_EPS <= t <= 1.0 + _EPS
    return ("between" if between else "beyond"), (i1, i2)


def _defers_to_one_section(
    sections: list[SectionPartitionInput], pair: tuple[int, int] | None, x: float, y: float
) -> bool:
    """Whether a BETWEEN column silently extrudes one section anyway.

    ``_stack_at`` blends the two nearest sections only when both of them actually have a
    stack at their projected foot. Where one comes back empty — the projection clamped to
    a section's end column, or landed in a gap the partition never filled — it hands the
    column to the other section whole. The regime still reads BETWEEN, but what the
    column got is the same single-section extrusion the BEYOND branch performs.

    This matters for reading the picture: a step from such a column to a genuine BEYOND
    column is labelled a regime change and is not one, and a step between two of them can
    jump without any label saying so.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The seated sections.
    pair : tuple of int or None
        The two nearest sections, nearest first, as returned by :func:`_mode_and_pair`.
    x, y : float
        The map-plane query point.

    Returns
    -------
    bool
        True when exactly one of the two nearest sections has a stack here.
    """
    if pair is None:
        return False
    i1, i2 = pair
    s1, s2 = sections[i1], sections[i2]
    gap1, frac1, _d1, _fx1, _fy1 = _project_to_section_fence(s1, x, y)
    gap2, frac2, _d2, _fx2, _fy2 = _project_to_section_fence(s2, x, y)
    has1 = bool(_section_stack_at(s1, gap1, frac1))
    has2 = bool(_section_stack_at(s2, gap2, frac2))
    return has1 != has2


def _hotspot_distance(step: dict) -> float:
    """How far a step's nearer end lies from the hotspot, in metres."""
    return min(
        math.dist((step["x0"], step["y0"]), HOTSPOT),
        math.dist((step["x1"], step["y1"]), HOTSPOT),
    )


def _touches_hotspot(step: dict) -> bool:
    """Whether a step lands close enough to the hotspot to be the one #260 measured."""
    return _hotspot_distance(step) <= HOTSPOT_TOL_M


def _body_key(entry: _Entry) -> str:
    """The identity two columns have to agree on to be carrying the same material.

    A never-correlated minority carries no ``body_id``; ``label_voxels`` gives it a
    synthetic id keyed by formation, and the same key is used here so a minority is
    compared against the minority of its own formation and nothing else.

    Parameters
    ----------
    entry : _Entry
        One interval of a column's stack.

    Returns
    -------
    str
        The body id, or the synthetic formation-keyed id for a ``None`` body.
    """
    return entry.body_id if entry.body_id is not None else f"__none__:{entry.formation_id}"


def _by_body(stack: tuple[_Entry, ...]) -> dict[str, list[_Entry]]:
    """Group one column's intervals by the body carrying them, shallow to deep."""
    out: dict[str, list[_Entry]] = {}
    for entry in stack:
        out.setdefault(_body_key(entry), []).append(entry)
    return out


def _worst_occurrence_jump(stack_a: tuple[_Entry, ...], stack_b: tuple[_Entry, ...]) -> float:
    """Worst move of a matched OCCURRENCE of a shared body, in metres.

    A body can occur more than once down a column, so asking only where its roof sits
    misses a deeper occurrence moving. This matches occurrences the way the blend itself
    matches them — ``_pair_occurrences``, nearest mid-elevation first, greedily — and
    reports the largest top move among the pairs that found a partner. An occurrence with
    no partner is not counted here: that is a body coming and going, which is the same
    distinct event the shared-body test sets aside.

    Parameters
    ----------
    stack_a, stack_b : tuple of _Entry
        The two columns' stacks.

    Returns
    -------
    float
        The largest matched-occurrence top move, or 0.0 when nothing matched.
    """
    a_by, b_by = _by_body(stack_a), _by_body(stack_b)
    worst = 0.0
    for key in a_by.keys() & b_by.keys():
        for e1, e2 in _pair_occurrences(a_by[key], b_by[key]):
            if e1 is not None and e2 is not None:
                worst = max(worst, abs(e1.top_elev - e2.top_elev))
    return worst


def _worst_rank_jump(stack_a: tuple[_Entry, ...], stack_b: tuple[_Entry, ...]) -> float:
    """Worst move when the two stacks are lined up by POSITION rather than by body.

    This is not a measurement of the model; it is a measurement of a way of measuring.
    Where one column has more intervals than its neighbour — routine here, because the
    between branch emits slivers the beyond branch does not — the nth interval of one is
    a different body from the nth of the other, and comparing them reports a jump that
    nothing in the ground did. It is computed only so the number it produces can be told
    apart from the number a shared body actually moved.

    Parameters
    ----------
    stack_a, stack_b : tuple of _Entry
        The two columns' stacks.

    Returns
    -------
    float
        The largest top difference between intervals at the same depth rank.
    """
    return max(
        (abs(a.top_elev - b.top_elev) for a, b in zip(stack_a, stack_b, strict=False)),
        default=0.0,
    )


def _tops_by_body(stack: tuple[_Entry, ...]) -> dict[str, float]:
    """Highest top elevation each body reaches in one column, keyed as the grid keys it.

    A body can occur more than once down a column, a clay that comes back below a sand.
    The comparison between two neighbouring columns is about where the body's roof sits,
    so each body is represented by its SHALLOWEST occurrence.

    A never-correlated minority carries no ``body_id``; ``label_voxels`` gives it a
    synthetic id keyed by formation, and the same key is used here so the two columns
    agree on what counts as the same material.

    Parameters
    ----------
    stack : list of _Entry
        One column's stack as ``_stack_at`` returned it, shallow to deep.

    Returns
    -------
    dict of str to float
        Body key to the top elevation of its shallowest occurrence.
    """
    tops: dict[str, float] = {}
    for entry in stack:
        key = _body_key(entry)
        if key not in tops or entry.top_elev > tops[key]:
            tops[key] = entry.top_elev
    return tops


def _worst_shared_jump(
    tops_a: dict[str, float], tops_b: dict[str, float]
) -> tuple[float, float, float] | None:
    """The largest move of a body BOTH columns carry, across one step.

    Parameters
    ----------
    tops_a, tops_b : dict of str to float
        The two columns' body-to-top maps.

    Returns
    -------
    tuple of float or None
        ``(top in a, top in b, absolute difference)`` for the worst shared body, or
        ``None`` when the two columns share no body at all — which is a body appearing or
        vanishing, a different event from a shared body jumping, and is reported
        separately.
    """
    shared = tops_a.keys() & tops_b.keys()
    if not shared:
        return None
    key = max(shared, key=lambda k: abs(tops_a[k] - tops_b[k]))
    return tops_a[key], tops_b[key], abs(tops_a[key] - tops_b[key])


async def main() -> None:
    """Walk the grid, record the regime boundary, and write the viewer payload."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "wall.json"))
    args = ap.parse_args()

    print("\n=== BETWEEN/BEYOND WALL -> browser companion (READ-ONLY) ===\n")
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
        stored = list((await session.execute(select(CrossSectionOrm))).scalars().all())

    # The same setup as every voxel diagnostic that reproduces the persisted build:
    # aliases planned per payload, the hull framed from the sections AS DRAWN unioned
    # with the drilled positions, and the SEATED sections handed to the query. Framing
    # the hull from the seated sections instead loses the projected feet and silently
    # narrows the grid.
    aliases = dict(gen.body_aliases or {})
    as_drawn = apply_body_aliases(_sections_from_payload(gen.payload), aliases)
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    sections, _moved, _shift = apply_true_column_positions(as_drawn, inv_columns)
    section_names = _name_sections(sections, stored)

    domain = build_domain_from_sections(
        as_drawn,
        investigation_positions=tuple(
            (c.investigation_id, c.world_x, c.world_y) for c in inv_columns
        ),
    )

    # The grid, rebuilt the way ``label_voxels`` builds it: the horizontal axes step at
    # the generation's own spacing across the domain hull's bounding box, and a column is
    # labelled when its centre is within half a cell diagonal of the footprint.
    h = float(gen.horizontal_spacing_m)
    ring = np.asarray(domain.polygon, dtype=float)
    xmin, ymin = float(ring[:, 0].min()), float(ring[:, 1].min())
    xmax, ymax = float(ring[:, 0].max()), float(ring[:, 1].max())
    gx = np.arange(xmin, xmax + h / 2.0, h)
    gy = np.arange(ymin, ymax + h / 2.0, h)
    footprint_tol = 0.5 * h * math.sqrt(2.0)

    print(f"  generation {gen.id}")
    print(f"  grid {h} m | {len(gx)}x{len(gy)} columns | {len(sections)} sections")
    print(f"  recorded grid {gen.grid_nx}x{gen.grid_ny} — must match, or this is a different model")
    if (len(gx), len(gy)) != (gen.grid_nx, gen.grid_ny):
        raise SystemExit("ABORT: rebuilt grid does not match the stored generation's grid.")

    # --- walk every column -------------------------------------------------
    started = time.perf_counter()
    columns: list[dict] = []
    stack_at: dict[tuple[int, int], tuple[_Entry, ...]] = {}
    tops_at: dict[tuple[int, int], dict[str, float]] = {}
    mode_at: dict[tuple[int, int], str] = {}
    pair_at: dict[tuple[int, int], tuple[int, int] | None] = {}
    top_at: dict[tuple[int, int], float] = {}
    deferring = 0
    for ix in range(len(gx)):
        x = float(gx[ix])
        for iy in range(len(gy)):
            y = float(gy[iy])
            if not domain.contains(x, y, tol=footprint_tol):
                continue
            # The production settings: no measured pinch factors, and a one-sided body
            # reaching to the section that contradicts it (``label_voxels`` defaults,
            # which the build does not override).
            stack = _stack_at(sections, x, y, None, True)
            if not stack:
                continue
            mode, pair = _mode_and_pair(sections, x, y)
            if mode == "between" and _defers_to_one_section(sections, pair, x, y):
                deferring += 1
            key = (ix, iy)
            mode_at[key] = mode
            pair_at[key] = pair
            stack_at[key] = tuple(stack)
            tops_at[key] = _tops_by_body(tuple(stack))
            top_at[key] = float(stack[0].top_elev)
            columns.append(
                {
                    "ix": ix,
                    "iy": iy,
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "mode": mode,
                    "pair": list(pair) if pair is not None else None,
                    "top": round(float(stack[0].top_elev), 3),
                    "body": stack[0].body_id,
                }
            )
    walked = time.perf_counter() - started

    # --- compare every adjacent pair ---------------------------------------
    steps: list[dict] = []
    pairs_compared = 0
    changes = 0
    unshared = 0
    unshared_written = 0
    worst_dz = 0.0
    worst_at: tuple[float, float] | None = None
    # Two other readings of the same steps, kept only so the headline number can be told
    # apart from the numbers other ways of matching produce. Neither is written out.
    worst_occurrence = 0.0
    worst_occurrence_at: tuple[float, float] | None = None
    worst_rank = 0.0
    worst_rank_at: tuple[float, float] | None = None
    # The hotspot's own step, kept whatever its size: the viewer opens on it, so it has to
    # resolve to a step even when the honest measurement there is small.
    hotspot_step: dict | None = None
    for (ix, iy), tops_a in tops_at.items():
        for jx, jy in ((ix + 1, iy), (ix, iy + 1)):
            tops_b = tops_at.get((jx, jy))
            if tops_b is None:
                continue
            pairs_compared += 1
            mode_a, mode_b = mode_at[(ix, iy)], mode_at[(jx, jy)]
            pair_a, pair_b = pair_at[(ix, iy)], pair_at[(jx, jy)]
            mode_changed = mode_a != mode_b
            pair_changed = pair_a != pair_b
            if mode_changed or pair_changed:
                changes += 1
            stack_a, stack_b = stack_at[(ix, iy)], stack_at[(jx, jy)]
            occurrence = _worst_occurrence_jump(stack_a, stack_b)
            if occurrence > worst_occurrence:
                worst_occurrence = occurrence
                worst_occurrence_at = (float(gx[ix]), float(gy[iy]))
            rank = _worst_rank_jump(stack_a, stack_b)
            if rank > worst_rank:
                worst_rank = rank
                worst_rank_at = (float(gx[ix]), float(gy[iy]))
            worst = _worst_shared_jump(tops_a, tops_b)
            if worst is None:
                # No body in common. Recorded so the viewer can show it, and marked so it
                # is never read as a shared body jumping — the column's own top is used
                # for the elevation, since there is no shared body to take one from.
                unshared += 1
                z0, z1 = top_at[(ix, iy)], top_at[(jx, jy)]
                dz = abs(z0 - z1)
                shared = False
            else:
                z0, z1, dz = worst
                shared = True
                if dz > worst_dz:
                    worst_dz = dz
                    worst_at = (float(gx[ix]), float(gy[iy]))
            step = {
                "x0": round(float(gx[ix]), 2),
                "y0": round(float(gy[iy]), 2),
                "x1": round(float(gx[jx]), 2),
                "y1": round(float(gy[jy]), 2),
                "z0": round(z0, 3),
                "z1": round(z1, 3),
                "dz": round(dz, 3),
                "from": mode_a,
                "to": mode_b,
                "modeChanged": mode_changed,
                "pairChanged": pair_changed,
                "shared": shared,
            }
            if mode_changed and _touches_hotspot(step):
                # Nearest to the hotspot wins, so the kept step is the flip itself rather
                # than a neighbouring one that happens to be equally close.
                if hotspot_step is None or _hotspot_distance(step) < _hotspot_distance(
                    hotspot_step
                ):
                    hotspot_step = step
            if dz < MIN_STEP_M:
                continue
            if not shared:
                unshared_written += 1
            steps.append(step)
    if hotspot_step is not None and hotspot_step not in steps:
        steps.append(hotspot_step)
    steps.sort(key=lambda s: -s["dz"])

    beyond = sum(1 for c in columns if c["mode"] == "beyond")
    beyond_share = beyond / max(len(columns), 1)

    payload = {
        "grid": {
            "h": h,
            "origin_x": round(float(gx[0]), 2),
            "origin_y": round(float(gy[0]), 2),
            "nx": int(len(gx)),
            "ny": int(len(gy)),
        },
        "columns": columns,
        "steps": steps,
        "sections": [
            {
                "index": i,
                "name": section_names[i],
                "is_tie": section_names[i].lower().startswith("tie"),
                "line": [[round(c.world_x, 2), round(c.world_y, 2)] for c in sec.columns],
            }
            for i, sec in enumerate(sections)
        ],
        "hotspot": {"x": HOTSPOT[0], "y": HOTSPOT[1]},
        "stats": {
            "pairsCompared": pairs_compared,
            "worstDz": round(worst_dz, 3),
            "modeOrPairChanges": changes,
            "beyondShare": round(beyond_share, 4),
        },
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload), encoding="utf-8")

    # --- what the run found ------------------------------------------------
    print(f"\n  columns emitted        : {len(columns):,}  (walked in {walked:.1f}s)")
    print(
        f"  between / beyond       : {len(columns) - beyond:,} / {beyond:,}"
        f"   ({100.0 * beyond_share:.1f} % beyond)"
    )
    print(
        f"  between but extruding  : {deferring:,} of those between columns had a stack on"
        " only one of the two sections, so they extrude one section anyway"
    )
    print(f"  adjacent pairs compared: {pairs_compared:,}")
    changed_share = 100.0 * changes / max(pairs_compared, 1)
    print(f"  mode or pair changed   : {changes:,}  ({changed_share:.1f} %)")
    print(f"  pairs sharing no body  : {unshared:,}  ({unshared_written:,} of them written out)")
    print(f"  steps written (>= {MIN_STEP_M} m): {len(steps):,}")
    if worst_at is not None:
        print(
            f"  worst shared-body jump : {worst_dz:.2f} m at ({worst_at[0]:.1f}, {worst_at[1]:.1f})"
        )
    for step in steps[:5]:
        if not step["shared"]:
            continue
        print(
            f"      {step['dz']:6.2f} m  ({step['x0']:.1f}, {step['y0']:.1f}) "
            f"{step['from']} -> {step['to']}"
            f"{'  MODE FLIP' if step['modeChanged'] else ''}"
            f"{'  PAIR CHANGE' if step['pairChanged'] else ''}"
        )

    print("\n  --- the same steps, matched three ways ---")
    print(
        f"    a shared body's TOP moved      : worst {worst_dz:.2f} m"
        + (f" at ({worst_at[0]:.1f}, {worst_at[1]:.1f})" if worst_at else "")
        + "   <- what is written out"
    )
    print(
        f"    a matched OCCURRENCE moved     : worst {worst_occurrence:.2f} m"
        + (
            f" at ({worst_occurrence_at[0]:.1f}, {worst_occurrence_at[1]:.1f})"
            if worst_occurrence_at
            else ""
        )
    )
    print(
        f"    intervals lined up by RANK     : worst {worst_rank:.2f} m"
        + (f" at ({worst_rank_at[0]:.1f}, {worst_rank_at[1]:.1f})" if worst_rank_at else "")
        + "   <- not a measurement of the ground"
    )

    if hotspot_step is not None:
        print(
            f"\n  HOTSPOT ({HOTSPOT[0]}, {HOTSPOT[1]}) reproduces as a mode flip: "
            f"{hotspot_step['from']} -> {hotspot_step['to']}, and it is in the steps list."
        )
        print(
            f"    the shared body's top moves {hotspot_step['dz']:.3f} m there — "
            "the 12.15 m in #260 is not a shared body moving."
        )
    else:
        near = [s for s in steps if _touches_hotspot(s)]
        print(
            f"\n  HOTSPOT ({HOTSPOT[0]}, {HOTSPOT[1]}) does NOT reproduce as a mode flip"
            f" ({len(near)} step(s) land near it)."
            "\n  The regime decision reproduced here does not agree with the one that was"
            "\n  measured, so this file draws something other than the wall. Do not use it."
        )

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"\n  wrote {out_path}  ({size_mb:.1f} MB)")
    print("  serve: cd blend_viewer && python -m http.server 8801 --bind 127.0.0.1")
    print("  open:  http://127.0.0.1:8801/wall.html\n")


if __name__ == "__main__":
    asyncio.run(main())
