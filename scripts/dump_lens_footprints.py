"""READ-ONLY dev-viewer dump: candidate lens outlines, in plan view.

A lens's lateral extent is already determined by the correlations: it is the set of
points where the body's 2-D extent ends on each section that carries it. Two crossing
sections give four such points, which outline the body; the surrounding matrix — any
lithology, the classification is geometric — fills everything else, exactly as the
2-D fill bands do in section. Nothing here reads a soil code.

What is NOT determined is how to turn a set of pinch-out points into an outline. This
dumps the candidates side by side, on real bodies, for ``blend_viewer/footprints.html``
to draw:

``hull``      the convex hull of every pinch point — one outline, always valid,
              but it bridges over ground where the body genuinely continues.
``angular``   the points in angular order around their centroid — follows a
              concave shape, but can cross itself on scattered point sets.
``clusters``  points grouped by proximity, one outline per group — a body that
              terminates in several separate places gets several outlines.
``circle``    for a body with only two points, a circle on them as diameter,
              since two points alone do not determine an outline.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/dump_lens_footprints.py
    uv run python scripts/dump_lens_footprints.py --cluster-gap 80
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
from scripts.diag_lens_footprints import _runs_on_section, _section_point  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _confirm_db_target,
    _load_formation_names,
)

_CIRCLE_STEPS = 48


def _hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The convex hull of a point set, counter-clockwise (monotone chain).

    Parameters
    ----------
    points : list of tuple of float
        World ``(x, y)`` positions; duplicates are tolerated.

    Returns
    -------
    list of tuple of float
        Hull vertices in order. Fewer than three distinct inputs are returned as-is,
        since they do not enclose an area.
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


def _angular(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The points ordered by angle about their centroid.

    Parameters
    ----------
    points : list of tuple of float
        World ``(x, y)`` positions.

    Returns
    -------
    list of tuple of float
        The same points, reordered so a polygon through them sweeps once around.
    """
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return sorted(pts, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))


def _clusters(points: list[tuple[float, float]], gap: float) -> list[list[tuple[float, float]]]:
    """Group points by proximity, single-link, so each termination gets its own outline.

    Parameters
    ----------
    points : list of tuple of float
        World ``(x, y)`` positions.
    gap : float
        Two points join the same group when they are closer than this, in metres.

    Returns
    -------
    list of list of tuple of float
        One group per termination, largest first.
    """
    pts = sorted(set(points))
    parent = list(range(len(pts)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if math.dist(pts[i], pts[j]) <= gap:
                parent[find(i)] = find(j)
    grouped: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for i, p in enumerate(pts):
        grouped[find(i)].append(p)
    return sorted(grouped.values(), key=len, reverse=True)


def _circle(a: tuple[float, float], b: tuple[float, float]) -> list[tuple[float, float]]:
    """A circle on two points as diameter, as a polygon.

    Parameters
    ----------
    a, b : tuple of float
        The two pinch-out points.

    Returns
    -------
    list of tuple of float
        ``_CIRCLE_STEPS`` vertices around the circle.
    """
    cx, cy = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
    r = math.dist(a, b) / 2.0
    return [
        (
            cx + r * math.cos(2 * math.pi * k / _CIRCLE_STEPS),
            cy + r * math.sin(2 * math.pi * k / _CIRCLE_STEPS),
        )
        for k in range(_CIRCLE_STEPS)
    ]


async def main() -> None:
    """Write ``blend_viewer/footprints.json`` for the plan-view outline viewer."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--steps", type=int, default=200, help="samples per gap")
    ap.add_argument(
        "--cluster-gap", type=float, default=120.0, help="join points closer than this, metres"
    )
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "footprints.json"))
    args = ap.parse_args()

    print("\n=== LENS FOOTPRINT DUMP (READ-ONLY) ===\n")
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

    formation_of: dict[str, str] = {}
    sections_of: dict[str, set[int]] = defaultdict(set)
    pinches_of: dict[str, list[tuple[float, float]]] = defaultdict(list)

    for s_idx, section in enumerate(seated):
        for body, spans in _runs_on_section(section, args.steps, formation_of).items():
            sections_of[body].add(s_idx)
            for start, end, start_interior, end_interior in spans:
                for idx, interior in ((start, start_interior), (end, end_interior)):
                    if interior:
                        pinches_of[body].append(_section_point(section, args.steps, idx))

    bodies = []
    for body in sorted(sections_of, key=lambda b: -len(pinches_of[b])):
        pts = pinches_of[body]
        outlines: dict[str, list[list[list[float]]]] = {}
        if len(pts) >= 3:
            outlines["hull"] = [[list(p) for p in _hull(pts)]]
            outlines["angular"] = [[list(p) for p in _angular(pts)]]
            outlines["clusters"] = [
                [list(p) for p in (_hull(g) if len(g) >= 3 else _circle(g[0], g[-1]))]
                for g in _clusters(pts, args.cluster_gap)
                if len(g) >= 2
            ]
        elif len(pts) == 2:
            ring = [[list(p) for p in _circle(pts[0], pts[1])]]
            outlines = {"hull": ring, "angular": ring, "clusters": ring}
        bodies.append(
            {
                "id": body,
                "formation": names.get(formation_of.get(body, ""), "?"),
                "sections": len(sections_of[body]),
                "pinches": [list(p) for p in pts],
                "outlines": outlines,
            }
        )

    payload = {
        "sections": [
            {
                "index": i,
                "pts": [[c.world_x, c.world_y] for c in s.columns],
                "tests": [inv.get(c.investigation_id, "?") for c in s.columns],
            }
            for i, s in enumerate(seated)
        ],
        "clusterGapM": args.cluster_gap,
        "bodies": bodies,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")

    lens_like = sum(1 for b in bodies if 4 <= len(b["pinches"]) <= 9)
    wide = sum(1 for b in bodies if len(b["pinches"]) >= 10)
    default_shape = sum(1 for b in bodies if len(b["pinches"]) in (2, 3))
    print(f"  wrote {out.name} — {len(bodies)} bodies, {out.stat().st_size / 1024:.0f} kB")
    print(f"      lens-shaped (4-9 points):     {lens_like}")
    print(f"      terminates in many places:    {wide}")
    print(f"      needs a default shape (2-3):  {default_shape}")
    multi = [b for b in bodies if len(b["outlines"].get("clusters", [])) > 1]
    print(f"      bodies splitting into >1 cluster at {args.cluster_gap:.0f} m: {len(multi)}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
