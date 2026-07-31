"""READ-ONLY: what a body's thickness does at its pinch-out, and where the edge tips sit.

Two questions the plan-view work left open.

**Elevation at the edge.** The tie-measured terminations say WHERE a body dies, not
what its thickness does on the way there: it may taper to nothing (a wedge, the shape
a fill band draws) or hold thickness and stop against something (a wall). Each region
carries its own polygon, so the answer is measured off that polygon's two ends.

Measuring instead by summing a BODY's thickness near where it vanishes gives the
wrong answer — a body with several layers in one column looks full-thickness right up
to where its last layer ends, which read as 61 % "wall" when the truth is that every
lens tapers. Measure the region, not the body.

**Edge tips inside the hull.** An edge that simply stops leaves a dangling end, and
where that end lies INSIDE the model footprint the partition is ambiguous there,
which the owner rules out. Only the tips of the tie-measured EDGES matter here, not
every termination, so this reports those against the footprint.

The footprint is the convex hull of every section column plus every drilled position —
an approximation of the builder's own alpha hull, and a conservative one: a convex
hull is never smaller, so a tip it calls interior is interior in the real footprint
too.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/diag_edge_elevation_and_hull.py
    uv run python scripts/diag_edge_elevation_and_hull.py --examples 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

_FLAT = 0.01
"""A region end this thin or thinner counts as tapered to nothing, in metres."""

_DEEP = 25.0
"""An edge tip further inside the footprint than this is a dangling end."""


def _hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convex hull of a point set, counter-clockwise (monotone chain).

    Parameters
    ----------
    points : list of tuple of float
        World ``(x, y)`` positions.

    Returns
    -------
    list of tuple of float
        Hull vertices in order; fewer than three distinct inputs are returned as-is.
    """
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _distance_to_ring(ring: list[tuple[float, float]], p: tuple[float, float]) -> float:
    """Shortest distance from a point to a closed ring, in metres.

    Parameters
    ----------
    ring : list of tuple of float
        The ring's vertices, not repeating the first at the end.
    p : tuple of float
        The point to measure.

    Returns
    -------
    float
        Distance to the nearest point of the ring.
    """
    best = float("inf")
    for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
        dx, dy = b[0] - a[0], b[1] - a[1]
        len2 = dx * dx + dy * dy
        u = (
            0.0
            if len2 <= 0
            else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
        )
        best = min(best, math.dist(p, (a[0] + dx * u, a[1] + dy * u)))
    return best


def _end_thicknesses(polygon: list[list[float]]) -> tuple[float, float]:
    """A region's thickness at each end of its own fraction span.

    Parameters
    ----------
    polygon : list of list of float
        The region ring as ``[fraction, elevation]`` points.

    Returns
    -------
    tuple of float
        ``(thinner end, thicker end)`` in metres.
    """
    fracs = [p[0] for p in polygon]
    lo, hi = min(fracs), max(fracs)

    def at(edge: float) -> float:
        ys = [p[1] for p in polygon if abs(p[0] - edge) <= 1e-4]
        return max(ys) - min(ys) if len(ys) >= 2 else 0.0

    a, b = at(lo), at(hi)
    return min(a, b), max(a, b)


async def main() -> None:
    """Report the taper at pinch-outs and the edge tips' clearance to the footprint."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--examples", type=int, default=10, help="tips to list")
    ap.add_argument(
        "--tiepinch",
        default=str(_REPO_ROOT / "blend_viewer" / "tiepinch.json"),
        help="output of dump_tie_pinch_vs_midline.py",
    )
    args = ap.parse_args()

    print("\n=== EDGE TAPER + HULL CLEARANCE (READ-ONLY) ===\n")
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

    by_kind: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for sec in gen.payload["sections"]:
        for r in sec["regions"]:
            by_kind[r.get("kind") or "(none)"].append(_end_thicknesses(r["polygon"]))

    print("  what each region does at its own ends\n")
    print(
        f"  {'kind':<10}{'n':>6}{'thin end':>12}{'thick end':>12}{'ratio':>8}   tapers to nothing"
    )
    for kind, ends in sorted(by_kind.items(), key=lambda kv: -len(kv[1])):
        thin = sorted(e[0] for e in ends)
        thick = sorted(e[1] for e in ends)
        mt, mk = thin[len(thin) // 2], thick[len(thick) // 2]
        flat = sum(1 for e in ends if e[0] <= _FLAT)
        ratio = mt / mk if mk > 1e-9 else float("nan")
        print(
            f"  {kind:<10}{len(ends):>6}{mt:>10.3f} m{mk:>10.3f} m{ratio:>8.2f}"
            f"   {flat}/{len(ends)} ({flat / len(ends) * 100:.0f} %)"
        )

    tie_path = Path(args.tiepinch)
    if not tie_path.exists():
        print(f"\n  no {tie_path.name} — run dump_tie_pinch_vs_midline.py for the hull half\n")
        return
    tp = json.loads(tie_path.read_text(encoding="utf-8"))

    investigation_columns = _apply_aliases_to_columns(
        _investigation_columns_from_picks(picks), dict(gen.body_aliases or {})
    )
    ring = _hull(
        [tuple(p) for s in tp["sections"] for p in s["pts"]]
        + [(c.world_x, c.world_y) for c in investigation_columns]
    )

    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for c in tp["cases"]:
        groups[(c["body"], c["from"], c["absentOn"])].append(c)

    tips = []
    for (_body, _a, _b), members in groups.items():
        ordered = sorted(members, key=lambda c: c["measured"][0])
        ties = len({c["tie"] for c in members})
        seen = set()
        for c in (ordered[0], ordered[-1]):
            key = tuple(c["measured"])
            if key in seen:
                continue
            seen.add(key)
            tips.append((c["formation"], ties, key, _distance_to_ring(ring, key)))

    deep = [t for t in tips if t[3] > _DEEP]
    single = sum(1 for _f, ties, _p, _d in tips if ties == 1)
    print(f"\n  {len(tips)} edge tips from {len(groups)} groups, against a {len(ring)}-vertex hull")
    print(f"      within 5 m of the boundary        {sum(1 for t in tips if t[3] <= 5):>4}")
    print(f"      deeper than {_DEEP:.0f} m inside            {len(deep):>4}")
    print(f"      tips whose group has ONE tie      {single:>4}  (a point, with no direction)")
    print(f"\n  deepest {args.examples} tips inside the footprint")
    for formation, ties, (x, y), dist in sorted(tips, key=lambda t: -t[3])[: args.examples]:
        print(f"      {formation:<5} {ties} tie(s)  {dist:6.1f} m inside   at ({x:,.0f}, {y:,.0f})")
    print()


if __name__ == "__main__":
    asyncio.run(main())
