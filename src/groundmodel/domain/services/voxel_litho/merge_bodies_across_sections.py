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
from collections.abc import Callable
from dataclasses import replace

from groundmodel.domain.services.voxel_litho.snap_grid import (
    FRACTION_EPS,
    gap_edge_fraction_margin,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionPartitionInput,
)

__all__ = ["apply_body_aliases", "plan_body_aliases", "plan_layer_groups"]

#: Minimum elevation overlap (m) for two spans to count as the same unit. Strict
#: overlap, not contact: 1 mm is the arrangement snap grid, so float slop never
#: merges but a genuinely shared band (identical spans) always does.
_ELEV_OVERLAP_M = 1e-3


def _gap_touch_fraction(section: SectionPartitionInput, gap_index: int) -> float:
    """The snap-cell margin (``SNAP_MARGIN_CELLS`` cells), in this gap's fraction space."""
    if gap_index < 0 or gap_index + 1 >= len(section.columns):
        return gap_edge_fraction_margin(0.0)
    left = section.columns[gap_index]
    right = section.columns[gap_index + 1]
    return gap_edge_fraction_margin(
        math.hypot(right.world_x - left.world_x, right.world_y - left.world_y)
    )


def _merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Union overlapping / touching elevation intervals; drop zero-height ones.

    Parameters
    ----------
    intervals : list of (float, float)
        ``(low, high)`` intervals in any order.

    Returns
    -------
    list of (float, float)
        Disjoint ``(low, high)`` intervals, lowest first, each with strictly
        positive height. Intervals that overlap or merely touch are fused, so a
        wall reported by BOTH the scanline and the vertical-edge pass collapses
        to one span rather than being double-counted (which, fed back through an
        even-odd pairing, would cancel itself to nothing).
    """
    ordered = sorted((low, high) for low, high in intervals if high - low > 0.0)
    merged: list[tuple[float, float]] = []
    for low, high in ordered:
        if merged and low <= merged[-1][1]:
            if high > merged[-1][1]:
                merged[-1] = (merged[-1][0], high)
        else:
            merged.append((low, high))
    return merged


def _spans_at_fraction(
    region: RegionInput, fraction: float, touch: float
) -> list[tuple[float, float]]:
    """Elevation intervals a region covers on the vertical line at ``fraction``.

    Replaces the earlier envelope reader (``min`` / ``max`` over every vertex
    within ``touch`` of the column). A re-entrant region — one that touches the
    line at two disjoint elevation stretches, connected only away from the line
    — had an envelope that spanned the void between them, and the weld test then
    fused a neighbour sitting in that void (R7, debt #278). This returns the
    TRUE intervals instead.

    Two crossing families are unioned:

    * the scanline's even-odd crossings, exact for a simple ring, taken at the
      sample CLAMPED strictly inside the ring's fraction extent — so a wall that
      sits on (or one snap cell short of) the sample line is caught through the
      edges that bound it, rather than missed by the half-open straddle at the
      extent itself; and
    * any VERTICAL edge whose fraction is within ``touch`` of the sample — a
      band's own column edge, which the scanline's ``f_a == f_b`` skip drops;
      its two endpoints bound the interval it covers.

    Unioning the two families (rather than concatenating them into one even-odd
    list) is what keeps a wall found by both from cancelling itself.

    Parameters
    ----------
    region : RegionInput
        The partition region to slice.
    fraction : float
        Gap-local horizontal position in ``[0, 1]``: ``0.0`` = the gap's left
        column, ``1.0`` = its right column, or an interior value where two
        section fences cross mid-gap.
    touch : float
        How close, in gap-local fraction, a vertical edge (or the ring extent)
        has to be to the sample to count as ON it — the SNAP-CELL MARGIN
        (``SNAP_MARGIN_CELLS`` cells) in this gap's own fraction space, owned by
        :mod:`~groundmodel.domain.services.voxel_litho.snap_grid`. A fixed 1e-6
        was wrong: the engine snaps to a 1 mm grid in METRES, so a band drawn
        across an 11 m gap stops 8.9e-5 short of fraction 1 and was read as
        never touching the column (#259, measured on 33 of 69 real gaps). A
        region that dies MORE than ``touch`` short of the sample is a genuine
        pinch-out and yields ``[]``.

    Returns
    -------
    list of (float, float)
        Disjoint ``(low, high)`` intervals, lowest first; empty when the region
        does not reach the sample line within ``touch``.
    """
    points = region.polygon
    # A ring needs at least three vertices to enclose area; a degenerate region
    # (empty or a single edge — the schema sets no min_length, so one can arrive)
    # reaches nothing, and taking min/max over its fractions would raise.
    if len(points) < 3:
        return []
    fractions = [f for f, _ in points]
    f_min, f_max = min(fractions), max(fractions)
    # A region that dies more than a snap margin short of the sample line never
    # reaches it — a genuine pinch-out, not the snap grid.
    if fraction < f_min - touch or fraction > f_max + touch:
        return []

    # Clamp the sample strictly inside the ring's fraction extent so the
    # scanline straddles the edges bounding a wall that sits on (or a snap cell
    # short of) the sample line — the half-open straddle would miss it at the
    # extent itself.
    lo_bound, hi_bound = f_min + FRACTION_EPS, f_max - FRACTION_EPS
    sample = min(max(fraction, lo_bound), hi_bound) if hi_bound >= lo_bound else fraction

    intervals: list[tuple[float, float]] = []
    crossings: list[float] = []
    for i in range(len(points)):
        f_a, e_a = points[i]
        f_b, e_b = points[(i + 1) % len(points)]
        if f_a == f_b:
            # Vertical edge: contributes its whole span when it sits within
            # ``touch`` of the sample line — the scanline below skips it.
            if abs(f_a - fraction) <= touch:
                intervals.append((min(e_a, e_b), max(e_a, e_b)))
            continue
        # Half-open straddle test so a shared vertex is counted once, not twice.
        lo, hi = (f_a, f_b) if f_a < f_b else (f_b, f_a)
        if lo <= sample < hi:
            crossings.append(e_a + (e_b - e_a) * ((sample - f_a) / (f_b - f_a)))
    crossings.sort()
    intervals.extend((crossings[i], crossings[i + 1]) for i in range(0, len(crossings) - 1, 2))
    return _merge_intervals(intervals)


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


def plan_body_aliases(
    sections: list[SectionPartitionInput],
    identity_key_of: Callable[[str], str] | None = None,
) -> dict[str, str]:
    """Map every body id to the representative of its cross-section component.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The per-section 2-D partitions exactly as POSTed by the frontend.
    identity_key_of : callable of (str) -> str, optional
        Collapses a region's ``formation_id`` to the identity two regions must
        share to be the same body. Two regions weld only when their keys agree.
        The geotech model stores one formation ROW per (NAD class, litho parent,
        GEOLOGICAL parent), so the same packing class exists under several row
        ids wherever a litho unit spans a geological boundary; keying on the
        class fuses the twins (debt #278). ``None`` (the default) keys on the
        raw ``formation_id`` — byte-identical to before, and correct for the
        litho model, whose rows carry no packing class to collapse.

    Returns
    -------
    dict of str to str
        ``body_id -> representative_body_id``. Ids that merge with nothing map to
        themselves, so the map is safe to apply unconditionally. ``None`` bodies
        (never-correlated minorities) never appear: they have no identity to
        alias and must not adopt a neighbour's.
    """
    key_of = identity_key_of if identity_key_of is not None else (lambda formation: formation)
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
                # One bucket entry PER disjoint interval: a re-entrant region
                # reaching the column at two stretches is two reaches, never the
                # envelope that spans the void between them.
                for low, high in _spans_at_fraction(region, fraction, touch):
                    reaches.append(
                        (
                            region.body_id,
                            section.columns[column_index].investigation_id,
                            region.formation_id,
                            low,
                            high,
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
    # compare within each group — same column, same IDENTITY (raw formation, or
    # the collapsed packing class when ``identity_key_of`` is supplied).
    buckets: dict[tuple[str, str], list[tuple[str, float, float]]] = defaultdict(list)
    for body, inv, formation, low, high in reaches:
        find(body)  # every body is at least its own component
        buckets[(inv, key_of(formation))].append((body, low, high))

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
    # both sections have a real stack, and any same-IDENTITY pair that overlaps
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
                    touch_a = _gap_touch_fraction(section_a, gap_a)
                    touch_b = _gap_touch_fraction(section_b, gap_b)
                    spans_a = [
                        (r.body_id, r.formation_id, span)
                        for r in section_a.regions
                        if r.gap_index == gap_a and r.body_id is not None
                        for span in _spans_at_fraction(r, frac_a, touch_a)
                    ]
                    spans_b = [
                        (r.body_id, r.formation_id, span)
                        for r in section_b.regions
                        if r.gap_index == gap_b and r.body_id is not None
                        for span in _spans_at_fraction(r, frac_b, touch_b)
                    ]
                    for body_a, form_a, (low_a, high_a) in spans_a:
                        find(str(body_a))
                        for body_b, form_b, (low_b, high_b) in spans_b:
                            find(str(body_b))
                            if key_of(form_a) != key_of(form_b) or body_a == body_b:
                                continue
                            if min(high_a, high_b) - max(low_a, low_b) > _ELEV_OVERLAP_M:
                                union(str(body_a), str(body_b))

    return {body: find(body) for body in parent}


def plan_layer_groups(
    sections: list[SectionPartitionInput],
) -> list[set[str]]:
    """Group LAYER ids whose regions meet across sections — label-independent.

    The sibling of :func:`plan_body_aliases` for the persisted body recompute
    (owner ruling 2026-08-12). Same two geometric tests — shared investigation
    column with elevation overlap, and fence crossings — but the union-find is
    keyed on REGION IDENTITY ``(section, region)`` and the output is groups of
    ``layer_ids``, never body ids. Body-labelled evidence cannot survive its
    own success: once a recompute merges two bodies, the refetched regions all
    carry the merged id, the next payload's body evidence collapses to
    singletons, the wholesale replace erases the facts that held the merge,
    and the bodies split again — measured live as facts flapping 74 → 3 → 69
    on the dev model (dogfeed 2026-08-12 evening). Layer ids never change, so
    the same geometry always yields the same groups and the recompute is
    idempotent by construction.

    This is the IDENTITY engine and it is PERMANENTLY GRANULAR (owner
    2026-09-01: *"start totally granular — small disconnected bodies of litho
    and packing; the user lumps them into groups"*). It keys on the RAW
    ``formation_id``: two masses of the same soil+NAD-class under DIFFERENT
    formation rows are never bridged, so each geometrically-connected mass is
    its own body and the user joins them by hand. It deliberately takes NO
    class-collapse key — unlike :func:`plan_body_aliases`, the 3-D voxel PAINT
    path, which keeps the collapse to avoid the invented-lithology pinch. That
    divergence is a decided owner ruling, not an oversight; do not "restore
    symmetry" by re-adding a key here.

    Regions with no ``layer_ids`` still participate as connectivity NODES
    (they can bridge two layered regions) — they just contribute no layers.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The per-section 2-D partitions exactly as POSTed by the frontend
        (fallback regions already omitted — they never define identity).

    Returns
    -------
    list of set of str
        One set of layer ids per cross-section-connected region component;
        components contributing fewer than two layers are dropped (they state
        nothing the per-section groups do not already state).
    """
    parent: dict[tuple[int, int], tuple[int, int]] = {}

    def find(node: tuple[int, int]) -> tuple[int, int]:
        """Union-find root with path compression."""
        parent.setdefault(node, node)
        root = node
        while parent[root] != root:
            root = parent[root]
        while parent[node] != root:
            parent[node], node = root, parent[node]
        return root

    def union(a: tuple[int, int], b: tuple[int, int]) -> None:
        """Union two region components (representative choice is irrelevant)."""
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    # Shared investigation columns: bucket every region's reach at its gap's two
    # columns by (investigation, raw formation ROW), then union overlapping
    # pairs. Keying on the raw formation id is the granular identity — same
    # soil+class under two different rows never bridges (owner 2026-09-01).
    buckets: dict[tuple[str, str], list[tuple[tuple[int, int], float, float]]] = defaultdict(list)
    for si, section in enumerate(sections):
        for ri, region in enumerate(section.regions):
            key = (si, ri)
            find(key)
            touch = _gap_touch_fraction(section, region.gap_index)
            for fraction, column_index in ((0.0, region.gap_index), (1.0, region.gap_index + 1)):
                if column_index >= len(section.columns):
                    continue
                # One bucket entry per disjoint interval (see plan_body_aliases).
                for low, high in _spans_at_fraction(region, fraction, touch):
                    buckets[
                        (
                            section.columns[column_index].investigation_id,
                            region.formation_id,
                        )
                    ].append((key, low, high))

    for bucket in buckets.values():
        for i, (key_a, low_a, high_a) in enumerate(bucket):
            for key_b, low_b, high_b in bucket[i + 1 :]:
                # Same-section pairs are welcome too: within-section
                # connectivity arrives separately from the frontend's own
                # groups, and a duplicate union is a no-op.
                if min(high_a, high_b) - max(low_a, low_b) > _ELEV_OVERLAP_M:
                    union(key_a, key_b)

    # Fence crossings — identical geometry to plan_body_aliases, region-keyed.
    for i, section_a in enumerate(sections):
        for j_offset, section_b in enumerate(sections[i + 1 :]):
            j = i + 1 + j_offset
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
                    touch_a = _gap_touch_fraction(section_a, gap_a)
                    touch_b = _gap_touch_fraction(section_b, gap_b)
                    spans_a = [
                        ((i, ri), r.formation_id, span)
                        for ri, r in enumerate(section_a.regions)
                        if r.gap_index == gap_a
                        for span in _spans_at_fraction(r, frac_a, touch_a)
                    ]
                    spans_b = [
                        ((j, ri), r.formation_id, span)
                        for ri, r in enumerate(section_b.regions)
                        if r.gap_index == gap_b
                        for span in _spans_at_fraction(r, frac_b, touch_b)
                    ]
                    for key_a, form_a, (low_a, high_a) in spans_a:
                        for key_b, form_b, (low_b, high_b) in spans_b:
                            if form_a != form_b:
                                continue
                            if min(high_a, high_b) - max(low_a, low_b) > _ELEV_OVERLAP_M:
                                union(key_a, key_b)

    components: dict[tuple[int, int], set[str]] = defaultdict(set)
    for key in parent:
        si, ri = key
        components[find(key)].update(sections[si].regions[ri].layer_ids)
    return [layers for layers in components.values() if len(layers) >= 2]


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
