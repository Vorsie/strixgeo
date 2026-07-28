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
Two regions belong to the same body when they meet at a SHARED investigation
column, carry the SAME formation, and OVERLAP in elevation there — the renderer's
own "across a gap boundary" rule, generalised from gaps to sections. Nothing else
merges them. Overlap is strict rather than mere contact, so two same-formation
units *stacked* at a column (a sand, a lens, another sand) are never welded.

This creates no correlation edge and writes nothing: the user's ties stay exactly
the user's ties. It only decides which ids are aliases of one another.

Pure domain module — no I/O, no framework imports. It computes; it does not act,
so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from collections import defaultdict

from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionPartitionInput,
)

__all__ = ["plan_body_aliases", "apply_body_aliases"]

#: Fraction tolerance for "this region reaches the column". Output fractions are
#: snapped to 1e-6 by the frontend slicer, so a region that genuinely reaches a
#: column edge lands byte-equal on 0 or 1.
_FRACTION_TOUCH = 1e-6

#: Minimum elevation overlap (m) for two spans to count as the same unit. Strict
#: overlap, not contact: 1 mm is the arrangement snap grid, so float slop never
#: merges but a genuinely shared band (identical spans) always does.
_ELEV_OVERLAP_M = 1e-3


def _span_at_fraction(region: RegionInput, fraction: float) -> tuple[float, float] | None:
    """Return the elevation span a region covers at a gap-local ``fraction``.

    Parameters
    ----------
    region : RegionInput
        The partition region to measure.
    fraction : float
        Gap-local horizontal position: ``0.0`` = left column, ``1.0`` = right.

    Returns
    -------
    tuple of (float, float) or None
        ``(low, high)`` elevations, or ``None`` when the region does not reach
        that column at all — a wedge that pinches out mid-gap touches only one
        of its two columns.
    """
    elevations = [e for f, e in region.polygon if abs(f - fraction) <= _FRACTION_TOUCH]
    if not elevations:
        return None
    return min(elevations), max(elevations)


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
            for fraction, column_index in ((0.0, region.gap_index), (1.0, region.gap_index + 1)):
                if column_index >= len(section.columns):
                    continue
                span = _span_at_fraction(region, fraction)
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
            else RegionInput(
                formation_id=region.formation_id,
                body_id=aliases[region.body_id],
                polygon=region.polygon,
                gap_index=region.gap_index,
            )
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
