"""Cross-section body merge — stage 2 of the staged body model.

Owner directive (2026-07-28): *"there should be no auto ties that are generated,
you just keep the ties and merge the bodies on lithological adjacency, like the
renderer does"*, so that *"something rendered as one body is one body in the
data"*.

WHY THIS EXISTS
---------------
The frontend's ``partitionFillV2/mergeTouchingBodies`` merges same-lithology
touching regions into one body **per section**, choosing its component
representative per section — its own docstring records that "stages 2-3
(cross-section, 3D) stay the backend's job — recorded, not here". That stage was
never built, so the same physical unit reaches the voxel builder under a
DIFFERENT ``body_id`` on every section it appears on. Measured on the dev model:
23 cases where one column carried the same lithology over overlapping elevations
under two ids, e.g. ``GEO-23/125-S9``'s clay at 4.84..3.80.

That matters because :func:`label_voxels._blend_stacks` matches the two nearest
sections' stacks BY ``body_id`` and treats an unmatched body as a one-sided lens
scaled by ``max(0, 2w - 1)`` — near zero at roughly equal distance. Two sections
that both show the same sand under two ids therefore each pinch it to nothing
midway between them, the void is back-filled, and whatever IS matched keeps full
thickness and slides into the vacated space. That is the invented lithology and
the climbing lens.

WHY IT LIVES ON THE SERVER
--------------------------
It was first written in the frontend, relabelling only the payload's regions.
But :class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`
separately loads DB picks for the honored investigation columns, and those keep
their original resolver ids — so a frontend-only relabel gives the same material
two identities, one in blended space and another at every honored column. The map
must be built ONCE and applied to BOTH, which is only possible where both are in
hand.

THE RULE
--------
Two regions belong to the same body when they carry the SAME formation and touch
with OVERLAPPING elevation, in either of the two ways two sections can touch:

* at a SHARED investigation column — the renderer's own "across a gap boundary"
  rule, generalised from gaps to sections; or
* where the two section fences CROSS in map space, at an arbitrary point between
  columns (owner, 2026-07-28: *"but also when they touch in between columns
  right?"*). With tie-sections cutting across the long cross-sections this is the
  common case, not an exotic one — restricting the rule to shared columns leaves
  the same unit split wherever two sections merely cross.

Nothing else merges them. Overlap is strict rather than mere contact, so two same-formation
units *stacked* at a column (a sand, a lens, another sand) are never welded.

This creates no correlation edge and writes nothing: the user's ties stay exactly
the user's ties. It only decides which ids are aliases of one another.

Pure domain module — no I/O, no framework imports. It computes; it does not act,
so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import replace

from groundmodel.domain.services.voxel_litho.snap_grid import gap_edge_fraction_margin
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionPartitionInput,
)

__all__ = ["plan_body_aliases", "apply_body_aliases"]

#: Minimum elevation overlap (m) for two spans to count as the same unit. Strict
#: overlap, not contact: 1 mm is the arrangement snap grid, so float slop never
#: merges but a genuinely shared band (identical spans) always does.
_ELEV_OVERLAP_M = 1e-3


def _span_at_fraction(
    region: RegionInput, fraction: float, touch: float
) -> tuple[float, float] | None:
    """Return the elevation span a region covers at a gap-local ``fraction``.

    Parameters
    ----------
    region : RegionInput
        The partition region to measure.
    fraction : float
        Gap-local horizontal position: ``0.0`` = left column, ``1.0`` = right.
    touch : float
        How close a vertex has to be, in gap-local fraction, to count as ON the
        column. This is the SNAP-CELL MARGIN (``SNAP_MARGIN_CELLS`` cells)
        expressed in this gap's own fraction space —
        :mod:`~groundmodel.domain.services.voxel_litho.snap_grid` owns the cell
        count and the reason for it, so it is not restated here. A fixed 1e-6
        was wrong: the engine snaps to a 1 mm grid in METRES, so a band drawn
        across an 11 m gap stops 8.9e-5 short of fraction 1 and was read as
        never touching the column (#259, measured on 33 of 69 real gaps).

    Returns
    -------
    tuple of (float, float) or None
        ``(low, high)`` elevations, or ``None`` when the region does not reach
        that column at all — a wedge that pinches out mid-gap touches only one
        of its two columns.
    """
    elevations = [e for f, e in region.polygon if abs(f - fraction) <= touch]
    if not elevations:
        return None
    return min(elevations), max(elevations)


def _gap_touch_fraction(section: SectionPartitionInput, gap_index: int) -> float:
    """The snap-cell margin (``SNAP_MARGIN_CELLS`` cells), in this gap's fraction space."""
    if gap_index < 0 or gap_index + 1 >= len(section.columns):
        return gap_edge_fraction_margin(0.0)
    left = section.columns[gap_index]
    right = section.columns[gap_index + 1]
    return gap_edge_fraction_margin(
        math.hypot(right.world_x - left.world_x, right.world_y - left.world_y)
    )


def _spans_at_fraction(region: RegionInput, fraction: float) -> list[tuple[float, float]]:
    """Elevation intervals a region covers on the vertical line at ``fraction``.

    Intersects the gap-local vertical line with the region ring and pairs the
    crossings even-odd, which is exact for a simple ring. Used where two section
    fences CROSS mid-gap, so the meeting point is at an arbitrary fraction rather
    than at a column edge.

    Parameters
    ----------
    region : RegionInput
        The partition region to slice.
    fraction : float
        Gap-local horizontal position in ``[0, 1]``.

    Returns
    -------
    list of (float, float)
        ``(low, high)`` intervals, lowest first; empty when the line misses.
    """
    crossings: list[float] = []
    points = region.polygon
    for i in range(len(points)):
        f_a, e_a = points[i]
        f_b, e_b = points[(i + 1) % len(points)]
        if f_a == f_b:
            continue
        # Half-open straddle test so a vertex is counted once, not twice.
        lo, hi = (f_a, f_b) if f_a < f_b else (f_b, f_a)
        if not (lo <= fraction < hi):
            continue
        crossings.append(e_a + (e_b - e_a) * ((fraction - f_a) / (f_b - f_a)))
    crossings.sort()
    return [
        (crossings[i], crossings[i + 1])
        for i in range(0, len(crossings) - 1, 2)
        if crossings[i + 1] - crossings[i] > 0.0
    ]


def _segment_crossing(
    ax: float,
    ay: float,
    bx: float,
    by: float,
    cx: float,
    cy: float,
    dx_: float,
    dy_: float,
) -> tuple[float, float] | None:
    """Where segments ``a-b`` and ``c-d`` cross, as a parameter on each.

    Returns
    -------
    tuple of (float, float) or None
        ``(t, u)`` in ``[0, 1]`` — the position along ``a-b`` and along ``c-d``
        — or ``None`` when the segments are parallel or do not meet.
    """
    r_x, r_y = bx - ax, by - ay
    s_x, s_y = dx_ - cx, dy_ - cy
    denom = r_x * s_y - r_y * s_x
    if abs(denom) < 1e-12:
        return None  # parallel or collinear — no single crossing point
    t = ((cx - ax) * s_y - (cy - ay) * s_x) / denom
    u = ((cx - ax) * r_y - (cy - ay) * r_x) / denom
    if not (0.0 <= t <= 1.0 and 0.0 <= u <= 1.0):
        return None
    return t, u


def plan_body_aliases(sections: list[SectionPartitionInput]) -> dict[str, str]:
    """Map every body id to the representative of its cross-section component.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The per-section 2-D partitions exactly as POSTed by the frontend.

    Returns
    -------
    dict of str to str
        ``body_id -> representative_body_id``. Ids that merge with nothing map to
        themselves, so the map is safe to apply unconditionally. ``None`` bodies
        (never-correlated minorities) never appear: they have no identity to
        alias and must not adopt a neighbour's.
    """
    # Every region's reach at each of its gap's two columns.
    reaches: list[tuple[str, str, str, float, float]] = []  # (body, inv, formation, low, high)
    for section in sections:
        for region in section.regions:
            if region.body_id is None:
                continue
            touch = _gap_touch_fraction(section, region.gap_index)
            for fraction, column_index in ((0.0, region.gap_index), (1.0, region.gap_index + 1)):
                if column_index >= len(section.columns):
                    continue
                span = _span_at_fraction(region, fraction, touch)
                if span is None:
                    continue
                reaches.append(
                    (
                        region.body_id,
                        section.columns[column_index].investigation_id,
                        region.formation_id,
                        span[0],
                        span[1],
                    )
                )

    parent: dict[str, str] = {}

    def find(node: str) -> str:
        """Union-find root with path compression."""
        parent.setdefault(node, node)
        root = node
        while parent[root] != root:
            root = parent[root]
        while parent[node] != root:
            parent[node], node = root, parent[node]
        return root

    def union(a: str, b: str) -> None:
        """Union two components, keeping the smaller id as the representative."""
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    # Group by the only two things that can make two regions the same body, then
    # compare within each group — same column, same lithology.
    buckets: dict[tuple[str, str], list[tuple[str, float, float]]] = defaultdict(list)
    for body, inv, formation, low, high in reaches:
        find(body)  # every body is at least its own component
        buckets[(inv, formation)].append((body, low, high))

    for bucket in buckets.values():
        for i, (body_a, low_a, high_a) in enumerate(bucket):
            for body_b, low_b, high_b in bucket[i + 1 :]:
                if body_a == body_b:
                    continue
                if min(high_a, high_b) - max(low_a, low_b) > _ELEV_OVERLAP_M:
                    union(body_a, body_b)

    # --- second way two sections touch: their fences CROSS between columns ---
    # Each gap segment runs between two consecutive columns' TRUE world
    # positions, so a crossing is a segment-segment intersection. At the crossing
    # both sections have a real stack, and any same-formation pair that overlaps
    # in elevation there is one body passing through the intersection.
    for i, section_a in enumerate(sections):
        for section_b in sections[i + 1 :]:
            for gap_a in range(len(section_a.columns) - 1):
                col_a0 = section_a.columns[gap_a]
                col_a1 = section_a.columns[gap_a + 1]
                for gap_b in range(len(section_b.columns) - 1):
                    col_b0 = section_b.columns[gap_b]
                    col_b1 = section_b.columns[gap_b + 1]
                    hit = _segment_crossing(
                        col_a0.world_x,
                        col_a0.world_y,
                        col_a1.world_x,
                        col_a1.world_y,
                        col_b0.world_x,
                        col_b0.world_y,
                        col_b1.world_x,
                        col_b1.world_y,
                    )
                    if hit is None:
                        continue
                    frac_a, frac_b = hit
                    spans_a = [
                        (r.body_id, r.formation_id, span)
                        for r in section_a.regions
                        if r.gap_index == gap_a and r.body_id is not None
                        for span in _spans_at_fraction(r, frac_a)
                    ]
                    spans_b = [
                        (r.body_id, r.formation_id, span)
                        for r in section_b.regions
                        if r.gap_index == gap_b and r.body_id is not None
                        for span in _spans_at_fraction(r, frac_b)
                    ]
                    for body_a, form_a, (low_a, high_a) in spans_a:
                        find(str(body_a))
                        for body_b, form_b, (low_b, high_b) in spans_b:
                            find(str(body_b))
                            if form_a != form_b or body_a == body_b:
                                continue
                            if min(high_a, high_b) - max(low_a, low_b) > _ELEV_OVERLAP_M:
                                union(str(body_a), str(body_b))

    return {body: find(body) for body in parent}


def apply_body_aliases(
    sections: list[SectionPartitionInput],
    aliases: dict[str, str],
) -> list[SectionPartitionInput]:
    """Relabel every region's ``body_id`` through ``aliases``.

    Relabels only: no vertex, formation or gap index moves, so the pass cannot
    introduce a hole or an overlap in the partition.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The per-section partitions to relabel.
    aliases : dict of str to str
        The map from :func:`plan_body_aliases`.

    Returns
    -------
    list of SectionPartitionInput
        New value objects; the input is not mutated.
    """
    if not aliases:
        return list(sections)
    out: list[SectionPartitionInput] = []
    for section in sections:
        regions = tuple(
            region
            if region.body_id is None
            or aliases.get(region.body_id, region.body_id) == region.body_id
            # ``replace`` rather than a fresh RegionInput: re-identifying the body
            # must change the body and nothing else. Listing the fields by hand is
            # how a later addition gets silently dropped — which is exactly what
            # happened to the 2-D classification at the payload boundary (#256).
            else replace(region, body_id=aliases[region.body_id])
            for region in section.regions
        )
        out.append(
            SectionPartitionInput(
                start_x=section.start_x,
                start_y=section.start_y,
                end_x=section.end_x,
                end_y=section.end_y,
                columns=section.columns,
                regions=regions,
            )
        )
    return out
