"""Split an accepted tie spanning data-bearing columns into the chain.

Owner rulings, 2026-08-17 night (step-4 dogfeed): *"The ties i manually made
spanning both boreholes aren't replaced by hops but never deleted. You can
delete user correlations spanning 2 boreholes. If the borehole has data,
otherwise it is a subTD tie."*

A tie is a straight line in (along, elevation) section space.  At every
intermediate column between its endpoints, the line has one interpolated
elevation.  Where that column carries geotech bands AT that depth, the span
splits: the line lands on the column's nearest packing contact and continues
from it — the chain the divide was always supposed to leave behind.  Where the
column's data stops above (or starts below) the line — a shallow CPT, an
undivided stretch — the tie is sub-TD relative to that column and the segment
keeps spanning it, because the span is then the only way the statement can be
made at all.

Three of his findings die on this one rule: the un-superseded manual spans
become the chain; the "impossible" crossings vanish because the stale spans
that crossed the new borehole-mediated ties are themselves re-expressed
through the same columns; and the missing quad returns because the surviving
sub-TD segment is an ordinary tie the fill engine can band.

Pure module: no session, no I/O, no logging.  The application half
(``DivideBoreholes``) owns the loads, the row writes, and the deletion of the
original span.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

__all__ = [
    "SPAN_LANDING_TOLERANCE_M",
    "SpanColumn",
    "SpanNode",
    "SpanTie",
    "split_span",
]

# A landing must stay within the column's banded extent to count as "has data
# at that depth". Millimetre slack only — the judgement is geometric, and the
# depths on both sides come off the same mm grid.
_DATA_TOL_M = 0.001

# How far a landing contact may sit from the tie's interpolated line before the
# column is judged not to EXPRESS the boundary at all. Measured on the owner's
# live model (2026-08-17 night): every believable chain landed 0.04-0.93 m from
# the line (B4 0.04, B3 0.11, B6 0.17/0.24, B4 0.41, B9 0.93), while the two
# wrong ones — his VD ties crossing B2's thick homogeneous sand mid-band — were
# 1.22 m and 3.28 m from the nearest contact. Landing those would bend his
# statement onto a boundary he never tied AND collapse his two parallel VD ties
# onto one contact. 1.0 m separates the measured cases cleanly; it is a
# tuning constant, not a law — the owner may move it.
SPAN_LANDING_TOLERANCE_M = 1.0


@dataclass(frozen=True)
class SpanColumn:
    """One column of the section, as the splitter needs to see it.

    Parameters
    ----------
    investigation_id : str
        The column's investigation id (stringified).
    along_m : float
        Position along the section line — the same projection the section
        view, the DXF export and the correlation adjacency use.
    collar_elev_m : float
        Collar elevation, for depth↔elevation conversion.
    contacts_m : tuple[float, ...]
        Every packing contact on the column (band tops plus the deepest base),
        depths below collar.  Empty when the column carries no bands.
    deepest_base_m : float | None
        The deepest band base, or ``None`` for a bandless column.
    """

    investigation_id: str
    along_m: float
    collar_elev_m: float
    contacts_m: tuple[float, ...]
    deepest_base_m: float | None


@dataclass(frozen=True)
class SpanTie:
    """One accepted tie reduced to its two (column, depth) endpoints."""

    edge_id: UUID
    inv_a: str
    depth_a_m: float
    inv_b: str
    depth_b_m: float


@dataclass(frozen=True)
class SpanNode:
    """One node of a split chain: a contact depth on a column."""

    investigation_id: str
    depth_m: float


def split_span(tie: SpanTie, section_order: list[SpanColumn]) -> list[SpanNode] | None:
    """The chain a spanning tie becomes, or ``None`` to keep it as drawn.

    Parameters
    ----------
    tie : SpanTie
        The accepted tie, endpoints as (column, depth below that collar).
    section_order : list[SpanColumn]
        Every column the section draws, any order; sorted by ``along_m`` here.

    Returns
    -------
    list[SpanNode] | None
        The chain's nodes from end A to end B — the two originals plus one
        landed contact per intermediate column with data at the line — or
        ``None`` when nothing splits: the tie is adjacent, an endpoint is not
        on this section, or every intermediate is sub-TD relative to the line
        (*"otherwise it is a subTD tie"*).
    """
    by_inv = {col.investigation_id: col for col in section_order}
    col_a = by_inv.get(tie.inv_a)
    col_b = by_inv.get(tie.inv_b)
    if col_a is None or col_b is None or col_a.investigation_id == col_b.investigation_id:
        return None

    elev_a = col_a.collar_elev_m - tie.depth_a_m
    elev_b = col_b.collar_elev_m - tie.depth_b_m
    along_lo, along_hi = sorted((col_a.along_m, col_b.along_m))
    span = col_b.along_m - col_a.along_m
    if span == 0:
        return None

    intermediates = sorted(
        (
            col
            for col in section_order
            if along_lo < col.along_m < along_hi
            and col.investigation_id not in (tie.inv_a, tie.inv_b)
        ),
        key=lambda col: col.along_m,
    )

    landed: list[SpanNode] = []
    for col in intermediates:
        if col.deepest_base_m is None or not col.contacts_m:
            continue  # bandless — the span keeps spanning it
        fraction = (col.along_m - col_a.along_m) / span
        line_elev = elev_a + fraction * (elev_b - elev_a)
        line_depth = col.collar_elev_m - line_elev
        # "If the borehole has data" — the line must pass through the column's
        # banded extent. Above the first band or below the deepest base, the
        # column cannot speak at this depth and the tie is sub-TD there.
        if not (
            min(col.contacts_m) - _DATA_TOL_M <= line_depth <= col.deepest_base_m + _DATA_TOL_M
        ):
            continue
        nearest = min(col.contacts_m, key=lambda contact: abs(contact - line_depth))
        if abs(nearest - line_depth) > SPAN_LANDING_TOLERANCE_M:
            # The line crosses this column mid-band: no boundary near it, so
            # the column does not express the tie's surface — keep spanning it
            # (the SP8 case: B2's thick homogeneous sand).
            continue
        landed.append(SpanNode(investigation_id=col.investigation_id, depth_m=nearest))

    if not landed:
        return None

    # Node order follows the walk from A to B, whichever direction that is
    # along the section.
    if col_a.along_m > col_b.along_m:
        landed.reverse()
    return [
        SpanNode(investigation_id=tie.inv_a, depth_m=tie.depth_a_m),
        *landed,
        SpanNode(investigation_id=tie.inv_b, depth_m=tie.depth_b_m),
    ]
