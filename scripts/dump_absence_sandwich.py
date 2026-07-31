"""READ-ONLY: the bodies whose ties disagree — present, absent, present again.

Owner rulings 2026-07-31 (docs/debt.md #256) say to interpolate the pinch-out edge
between the ties that carry a body, and never to carry it across a tie that does not.
Four bodies on the dev model, all SILT, are carried by a tie, absent on the next tie
along, and carried again beyond it. The two rulings give opposite answers there, so the
edge cannot be built until the case is decided.

This writes what the model actually holds for those bodies, for
``blend_viewer/sandwich.html`` to draw in map view:

* every section as its true column polyline, tie and cross-section alike;
* which ties carry the body and which stand as evidence against it;
* where the body starts and stops along each tie that carries it, and how thick it is
  along that stretch — a body already at apex thickness beside the gap reads very
  differently from one a metre thick;
* whether the absent tie even passes through the body's footprint. A tie can lack a body
  simply because it runs past the end of it, which is not evidence of a hole at all, and
  that alone may settle some of the four.

Read-only, dev-DB guarded. Serve with
``cd blend_viewer && python -m http.server 8801 --bind 127.0.0.1`` — deliberately not
8765 (the dev app's backend) or 8799 (the voxel viewer), so nothing collides with a live
session.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _section_stack_at,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_absence_ties import _ties_in_spatial_order  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.diag_lens_footprints import _runs_on_section, _section_point  # noqa: E402
from scripts.dump_tie_pinch_vs_midline import (  # noqa: E402
    _apply_aliases_to_columns,
    _confirm_db_target,
    _investigation_columns_from_picks,
    _load_formation_names,
    _name_sections,
)

STEPS = 200
"""Samples per gap. Matches the other tie diagnostics so the runs line up with them."""

PROFILE_SAMPLES = 60
"""Thickness samples along each stretch where a body is present on a tie."""


def _thickness_at(section, steps: int, idx: float, body: str) -> float:
    """Thickness of one body at a global sample index, in metres.

    Parameters
    ----------
    section : SectionPartitionInput
        The seated section being sampled.
    steps : int
        Samples per gap, matching the runs.
    idx : float
        Global sample index along the section.
    body : str
        The body whose thickness is wanted.

    Returns
    -------
    float
        Thickness in metres, or 0.0 where the body is not present at that position.
    """
    gap = min(int(idx) // steps, len(section.columns) - 2)
    frac = (idx - gap * steps) / max(steps - 1, 1)
    for entry in _section_stack_at(section, gap, min(max(frac, 0.0), 1.0)):
        if entry.body_id == body:
            return float(entry.top_elev - entry.base_elev)
    return 0.0


def _profile(section, steps: int, body: str, runs: list) -> list[dict]:
    """Sampled world position and thickness along every stretch a body occupies.

    Parameters
    ----------
    section : SectionPartitionInput
        The seated section.
    steps : int
        Samples per gap.
    body : str
        Body id.
    runs : list
        The body's ``(start, end, start interior, end interior)`` runs on this section.

    Returns
    -------
    list of dict
        One entry per run, each carrying its sampled ``points`` (x, y, thickness) and
        the maximum thickness over the run.
    """
    out = []
    for start, end, start_interior, end_interior in runs:
        pts = []
        for k in range(PROFILE_SAMPLES):
            idx = start + (end - start) * (k / max(PROFILE_SAMPLES - 1, 1))
            x, y = _section_point(section, steps, idx)
            pts.append({"x": x, "y": y, "th": round(_thickness_at(section, steps, idx, body), 3)})
        out.append(
            {
                "points": pts,
                "max_th": round(max((p["th"] for p in pts), default=0.0), 3),
                "starts_interior": bool(start_interior),
                "ends_interior": bool(end_interior),
            }
        )
    return out


def _segments_cross(a1, a2, b1, b2) -> bool:
    """Whether two line segments properly intersect.

    Parameters
    ----------
    a1, a2, b1, b2 : tuple of float
        Segment endpoints as ``(x, y)``.

    Returns
    -------
    bool
        True when the segments cross.
    """

    def side(p, q, r) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    d1, d2 = side(a1, a2, b1), side(a1, a2, b2)
    d3, d4 = side(b1, b2, a1), side(b1, b2, a2)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def _point_in_polygon(pt, poly) -> bool:
    """Whether a point lies inside a polygon, by ray casting.

    Parameters
    ----------
    pt : tuple of float
        The point as ``(x, y)``.
    poly : list of tuple of float
        Polygon ring.

    Returns
    -------
    bool
        True when the point is inside.
    """
    x, y = pt
    inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def _point_segment_distance(pt, a, b) -> float:
    """Shortest distance from a point to a segment, in metres."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0.0 and dy == 0.0:
        return math.dist(pt, a)
    t = max(0.0, min(1.0, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy)))
    return math.dist(pt, (ax + t * dx, ay + t * dy))


def _corridor_test(tie_line, corridor) -> dict:
    """Does an absent tie pass through the corridor between the flanking carrying ties?

    A tie that runs clear of the body's footprint says nothing about a hole in it — the
    body simply ends before that tie is reached. Only a tie crossing the corridor is
    evidence of absence WHERE THE BODY WOULD BE.

    Parameters
    ----------
    tie_line : list of tuple of float
        The absent tie's column polyline in world coordinates.
    corridor : list of tuple of float
        The quadrilateral joining the body's extent on the two flanking carrying ties.

    Returns
    -------
    dict
        ``crosses`` and, when it does not, ``gap_m`` — how far outside it runs.
    """
    if len(corridor) < 3:
        return {"crosses": False, "gap_m": None}
    for pt in tie_line:
        if _point_in_polygon(pt, corridor):
            return {"crosses": True, "gap_m": 0.0}
    for i in range(len(tie_line) - 1):
        for j in range(len(corridor)):
            if _segments_cross(
                tie_line[i], tie_line[i + 1], corridor[j], corridor[(j + 1) % len(corridor)]
            ):
                return {"crosses": True, "gap_m": 0.0}
    best = min(
        _point_segment_distance(c, tie_line[i], tie_line[i + 1])
        for c in corridor
        for i in range(len(tie_line) - 1)
    )
    return {"crosses": False, "gap_m": round(best, 1)}


async def main() -> None:
    """Write the sandwich cases for the browser companion."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "sandwich.json"))
    args = ap.parse_args()

    print("\n=== ABSENCE-SANDWICH BODIES -> browser companion (READ-ONLY) ===\n")
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
        stored = (await session.execute(select(CrossSectionOrm))).scalars().all()

    aliases = dict(gen.body_aliases or {})
    seated, _m, _s = apply_true_column_positions(
        apply_body_aliases(_sections_from_payload(gen.payload), aliases),
        _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases),
    )
    section_names = _name_sections(seated, list(stored))
    ties = [i for i, n in enumerate(section_names) if n.lower().startswith("tie")]
    ordered_ties = _ties_in_spatial_order(seated, ties)

    runs_by_section = {i: _runs_on_section(seated[i], STEPS, {}) for i in range(len(seated))}
    formation_of: dict[str, str] = {}
    for sec in gen.payload["sections"]:
        for r in sec["regions"]:
            if r["body_id"]:
                formation_of.setdefault(r["body_id"], names.get(r["formation_id"], "?"))

    # The four: carried by two or more ties with at least one absent tie between them.
    cases = []
    for body in sorted({b for i in ties for b in runs_by_section[i]}):
        carried = [i for i in ordered_ties if body in runs_by_section[i]]
        if len(carried) < 2:
            continue
        first, last = ordered_ties.index(carried[0]), ordered_ties.index(carried[-1])
        between = [i for i in ordered_ties[first : last + 1] if body not in runs_by_section[i]]
        if between:
            cases.append((body, carried, between))

    print(f"  {len(cases)} bodies present-absent-present across the ties\n")

    payload_sections = []
    for i, sec in enumerate(seated):
        payload_sections.append(
            {
                "index": i,
                "name": section_names[i],
                "is_tie": i in ties,
                "line": [[c.world_x, c.world_y] for c in sec.columns],
                "columns": [
                    {"id": c.investigation_id, "x": c.world_x, "y": c.world_y} for c in sec.columns
                ],
            }
        )

    out_cases = []
    for body, carried, between in cases:
        per_section = {}
        for i in range(len(seated)):
            runs = runs_by_section[i].get(body)
            if not runs:
                continue
            per_section[str(i)] = _profile(seated[i], STEPS, body, runs)

        # For each absent tie, the corridor between the carrying ties either side of it.
        absences = []
        for tie_index in between:
            pos = ordered_ties.index(tie_index)
            left = [t for t in carried if ordered_ties.index(t) < pos]
            right = [t for t in carried if ordered_ties.index(t) > pos]
            corridor: list[tuple[float, float]] = []
            if left and right:
                lo_runs = per_section.get(str(left[-1]), [])
                hi_runs = per_section.get(str(right[0]), [])
                if lo_runs and hi_runs:
                    lo_pts = lo_runs[0]["points"]
                    hi_pts = hi_runs[0]["points"]
                    corridor = [
                        (lo_pts[0]["x"], lo_pts[0]["y"]),
                        (lo_pts[-1]["x"], lo_pts[-1]["y"]),
                        (hi_pts[-1]["x"], hi_pts[-1]["y"]),
                        (hi_pts[0]["x"], hi_pts[0]["y"]),
                    ]
            tie_line = [(c.world_x, c.world_y) for c in seated[tie_index].columns]
            test = _corridor_test(tie_line, corridor)
            absences.append(
                {
                    "section": tie_index,
                    "name": section_names[tie_index],
                    "corridor": [[x, y] for x, y in corridor],
                    **test,
                }
            )

        max_th = max(
            (r["max_th"] for i in carried for r in per_section.get(str(i), [])), default=0.0
        )
        out_cases.append(
            {
                "body_id": body,
                "short": body[:8],
                "formation": formation_of.get(body, "?"),
                "carrying_ties": carried,
                "absent_between": [a["section"] for a in absences],
                "absences": absences,
                "profiles": per_section,
                "max_th_on_ties": max_th,
            }
        )
        crossing = sum(1 for a in absences if a["crosses"])
        print(
            f"  {body[:8]}  {formation_of.get(body, '?'):<6} "
            f"carried by {len(carried)} ties, absent on {len(absences)} between — "
            f"{crossing} of those actually cross the body's footprint "
            f"(max thickness on a carrying tie {max_th:.2f} m)"
        )

    out = {
        "sections": payload_sections,
        "tie_order": ordered_ties,
        "cases": out_cases,
        "generation": str(gen.id),
    }
    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"\n  wrote {args.out}")
    print("  serve: cd blend_viewer && python -m http.server 8801 --bind 127.0.0.1")
    print("  open:  http://127.0.0.1:8801/sandwich.html\n")


if __name__ == "__main__":
    asyncio.run(main())
