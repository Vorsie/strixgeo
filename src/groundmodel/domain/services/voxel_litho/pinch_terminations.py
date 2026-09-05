"""Where each body is measured to pinch out, read from the 2-D partition.

A body that dies between two cross-sections has to terminate somewhere, and the
builder used to assume that somewhere was the equidistance midline: ``max(0, 2w - 1)``
reaches zero exactly halfway. The tie-sections run between the cross-sections, so the
body actually terminates ON a tie, and the 2-D partition already places and classifies
that termination. This module collects those places — measured evidence in the very
direction the builder was guessing.

Measured on the dev model, the midline assumption is off by a median of 4.5 m, p90
30.9 m and worst 53.6 m across 39 such cases, and only 21 of 39 land within 5 m.

A termination is the apex of a region that tapers to nothing: all 48 lens regions on
that model thin to <= 1 cm at one end, so the apex is real geometry rather than a
tolerance artefact. A region at full thickness on both sides carries straight through
its gap and terminates nowhere in it.

Pure geometry over the partition value objects — no I/O, no logging, no framework.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from groundmodel.domain.services.voxel_litho.pinch_terminations_constants import FLAT_M
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionPartitionInput,
)

_EDGE_EPS = 1e-4
"""How close a polygon point must be to an end of the region's span to count as on it."""


@dataclass(frozen=True)
class Termination:
    """One place a body is measured to pinch out.

    Parameters
    ----------
    body_id : str
        The resolver-assigned body that terminates here.
    world_x : float
        Easting of the apex in metres (project CRS).
    world_y : float
        Northing of the apex in metres (project CRS).
    kind : {'quad', 'pinch', 'lens'} or None
        What the 2-D engine called the region that terminates here — the 2/1/0
        classification at THIS position. A body may band in one gap and onlap in
        the next, so this describes the region, never the body.
    section_index : int
        Index of the section the apex was measured on, within the list passed in.
    """

    body_id: str
    world_x: float
    world_y: float
    kind: Literal["quad", "pinch", "lens"] | None
    section_index: int


def pinch_factor(
    query: tuple[float, float],
    distance_to_section: float,
    terminations: Sequence[Termination],
    *,
    own_section_index: int,
) -> float | None:
    """How much of a one-sided body survives at ``query``, from where it is measured to die.

    Full thickness on the section that carries the body, nothing where another section
    measures it to end, thinning linearly between. That replaces ``max(0, 2w - 1)``,
    which reached zero at the equidistance midline because the builder had no better
    anchor.

    Only terminations on OTHER sections count. An apex on the body's own section says
    where it ends ALONG that section, which ``_section_stack_at`` already honours by
    slicing at the query's own gap and fraction; it measures nothing about how far the
    body reaches AWAY from that section. Counting it was a real defect: since
    ``distance_to_section`` is the MINIMUM distance to that fence and every apex is
    placed ON a fence, the reach could never be shorter, and the factor was pinned at
    exactly 0.5 — no body tapered to nothing anywhere in the model, on 87-92 % of real
    occurrences.

    Among the apexes that do count, the nearest governs, so a body dying in several
    places thins toward whichever end is closest to the point being labelled.

    This says how much is left, not which side of the boundary the point is on. That is
    the edge test or the 15 % ellipse, and it is a separate step.

    Parameters
    ----------
    query : tuple of float
        World ``(x, y)`` of the point being labelled.
    distance_to_section : float
        Distance from ``query`` to the section carrying the body, in metres.
    terminations : sequence of Termination
        Everywhere this body is measured to pinch out, on any section.
    own_section_index : int
        Index of the section supplying the body here. Its own terminations are
        excluded, for the reason above.

    Returns
    -------
    float or None
        A factor in ``[0, 1]`` scaling the body's thickness, or ``None`` when no other
        section measures this body to end. ``None`` is not zero — it means no evidence
        about the reach, so the caller must fall back rather than invent a pinch.
    """
    reaches = [
        math.dist(query, (t.world_x, t.world_y))
        for t in terminations
        if t.section_index != own_section_index
    ]
    if not reaches:
        return None
    reach = min(reaches)
    total = distance_to_section + reach
    if total <= 0.0:
        return 0.0
    return max(0.0, min(1.0, reach / total))


def _span_thicknesses(
    polygon: tuple[tuple[float, float], ...],
) -> tuple[float, float, float, float]:
    """A region's fraction span and its thickness at each end of it.

    Parameters
    ----------
    polygon : tuple of tuple of float
        The region ring as ``(fraction, elevation)`` points.

    Returns
    -------
    tuple of float
        ``(low fraction, high fraction, thickness at low, thickness at high)``.
    """
    fracs = [p[0] for p in polygon]
    lo, hi = min(fracs), max(fracs)

    def thickness(edge: float) -> float:
        ys = [p[1] for p in polygon if abs(p[0] - edge) <= _EDGE_EPS]
        return max(ys) - min(ys) if len(ys) >= 2 else 0.0

    return lo, hi, thickness(lo), thickness(hi)


def _world_at(
    section: SectionPartitionInput, region: RegionInput, fraction: float
) -> tuple[float, float] | None:
    """Map a gap-local fraction to a world position on the section's column fence.

    The fraction is local to the region's own gap, so it interpolates between that
    gap's two columns — not along the section as a whole.

    Parameters
    ----------
    section : SectionPartitionInput
        The section carrying the region.
    region : RegionInput
        The region whose gap the fraction belongs to.
    fraction : float
        Position across the gap, 0 at its left column and 1 at its right.

    Returns
    -------
    tuple of float or None
        World ``(x, y)``, or ``None`` when the gap index is out of range.
    """
    gap = region.gap_index
    if gap < 0 or gap + 1 >= len(section.columns):
        return None
    a, b = section.columns[gap], section.columns[gap + 1]
    f = min(max(fraction, 0.0), 1.0)
    return (a.world_x + (b.world_x - a.world_x) * f, a.world_y + (b.world_y - a.world_y) * f)


def body_terminations(
    sections: list[SectionPartitionInput], *, flat_m: float = FLAT_M
) -> dict[str, tuple[Termination, ...]]:
    """Every place each body is measured to pinch out, gathered per body.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The project's sections with their 2-D partitions, cross-sections and ties
        alike — a tie is where a body dying between two cross-sections is actually
        caught, so they must not be filtered out.
    flat_m : float
        A region end at or below this thickness is an apex. Defaults to
        :data:`FLAT_M`.

    Returns
    -------
    dict
        Body id to its terminations. Regions with no ``body_id`` are left out —
        a never-correlated minority has no identity to gather them under. Bodies
        that terminate nowhere do not appear.
    """
    out: dict[str, list[Termination]] = defaultdict(list)
    for index, section in enumerate(sections):
        for region in section.regions:
            if region.body_id is None:
                continue
            lo, hi, th_lo, th_hi = _span_thicknesses(region.polygon)
            for fraction, thickness in ((lo, th_lo), (hi, th_hi)):
                if thickness > flat_m or math.isnan(thickness):
                    continue
                world = _world_at(section, region, fraction)
                if world is None:
                    continue
                out[region.body_id].append(
                    Termination(region.body_id, world[0], world[1], region.kind, index)
                )
    return {body: tuple(found) for body, found in out.items()}
