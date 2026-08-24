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

What the split leaves standing is judged a second time, by
:func:`crossings_through_banded_range` (owner ruling 2026-08-24): *"if no hops
can be made, you just auto delete the crossing correlation, user will notice
something weird in the fill if he/she needs to subdivide"*.  A tie that still
runs through a borehole's own banded range after the split states continuity
straight through data that disagrees with it — the fill draws that weld, and
the engineer was deleting them by hand.  Sub-TD is untouched by both verdicts.

Pure module: no session, no I/O, no logging.  The application half
(``DivideBoreholes``) owns the loads, the row writes, and the deletion of the
original span.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from uuid import UUID

__all__ = [
    "SPAN_LANDING_TOLERANCE_M",
    "SpanColumn",
    "SpanCrossing",
    "SpanNode",
    "SpanTie",
    "crossings_through_banded_range",
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
    contact_soils : tuple[tuple[str | None, str | None], ...]
        Per contact, the soil codes of the band ABOVE and BELOW the seam
        (``None`` where no band exists on that face).  Parallel to
        ``contacts_m``; empty = unknown, and the soil guard passes everything
        at this column.
    """

    investigation_id: str
    along_m: float
    collar_elev_m: float
    contacts_m: tuple[float, ...]
    deepest_base_m: float | None
    contact_soils: tuple[tuple[str | None, str | None], ...] = ()


@dataclass(frozen=True)
class SpanTie:
    """One accepted tie reduced to its two (column, depth) endpoints.

    ``soils_a`` / ``soils_b`` carry the (above, below) soil codes of the seam
    each endpoint sits on.  A landing contact must present the same soils
    (owner dogfeed 2026-08-18: a sand span crossing B6 landed on its
    ZAND8|KLEI22 seam because it was 0.11 m nearer than the VD top, and the
    machine wrote SAND↔CLAY hops he had to prune).  ``None`` = unknown → the
    guard does not constrain.
    """

    edge_id: UUID
    inv_a: str
    depth_a_m: float
    inv_b: str
    depth_b_m: float
    soils_a: tuple[str | None, str | None] | None = None
    soils_b: tuple[str | None, str | None] | None = None


@dataclass(frozen=True)
class SpanNode:
    """One node of a split chain: a contact depth on a column."""

    investigation_id: str
    depth_m: float


@dataclass(frozen=True)
class SpanCrossing:
    """One column a tie passes over inside that column's own banded range."""

    investigation_id: str
    crossing_elev_m: float


@dataclass(frozen=True)
class _SpanLine:
    """The tie as a straight line between two placed columns."""

    col_a: SpanColumn
    col_b: SpanColumn
    elev_a: float
    elev_b: float

    def elevation_at(self, along_m: float) -> float:
        """Elevation of the line at an along-section position."""
        fraction = (along_m - self.col_a.along_m) / (self.col_b.along_m - self.col_a.along_m)
        return self.elev_a + fraction * (self.elev_b - self.elev_a)

    def spans(self, along_m: float) -> bool:
        """Whether an along-position lies STRICTLY between the two endpoints."""
        return (
            min(self.col_a.along_m, self.col_b.along_m)
            < along_m
            < max(self.col_a.along_m, self.col_b.along_m)
        )


def _span_line(tie: SpanTie, section_order: Sequence[SpanColumn]) -> _SpanLine | None:
    """The tie's line in (along, elevation) space, or ``None`` when unplaceable."""
    by_inv = {col.investigation_id: col for col in section_order}
    col_a = by_inv.get(tie.inv_a)
    col_b = by_inv.get(tie.inv_b)
    if col_a is None or col_b is None or col_a.investigation_id == col_b.investigation_id:
        return None
    if col_b.along_m == col_a.along_m:
        return None
    return _SpanLine(
        col_a=col_a,
        col_b=col_b,
        elev_a=col_a.collar_elev_m - tie.depth_a_m,
        elev_b=col_b.collar_elev_m - tie.depth_b_m,
    )


def crossings_through_banded_range(
    tie: SpanTie,
    section_order: Sequence[SpanColumn],
    *,
    crossable_ids: Collection[str] | None = None,
) -> list[SpanCrossing]:
    """Every column the tie passes OVER inside that column's banded range.

    Owner ruling, 2026-08-24: *"i also had to manually deleted a correlation
    spanning a borehole from cpt to cpt over borehole, write a check that
    checks if all those are gone after divide boreholes"* / *"if no hops can be
    made, you just auto delete the crossing correlation, user will notice
    something weird in the fill if he/she needs to subdivide"*.

    This is the verdict the DELETE runs on, and it is asked only of the ties
    :func:`split_span` left standing: where hops can be made the span becomes
    the chain, and only what survives that is judged here.  A column is crossed
    when the tie's straight line reaches it at an elevation inside its own
    banded extent — the column HAS data there and still carries no contact the
    span could land on, so the tie states continuity straight through bands
    that disagree with it.

    Outside that extent the answer is no, in both directions.  Below it is the
    sub-TD case the 2026-08-17 ruling protects (*"otherwise it is a subTD
    tie"*): the column stops above the line, so the span is the only way the
    statement can be made at all.  Above it the column is equally silent — it
    begins below the line — and silence is never grounds for deleting the
    engineer's work.

    Parameters
    ----------
    tie : SpanTie
        The surviving tie, endpoints as (column, depth below that collar).
    section_order : Sequence[SpanColumn]
        Every column the section draws, any order.
    crossable_ids : Collection[str] | None, optional
        Only these columns may be crossed — the run's borehole scope.  ``None``
        means every column in *section_order* is a candidate.

    Returns
    -------
    list[SpanCrossing]
        One entry per crossed column with the elevation the line reaches it at,
        ordered along the section.  Empty when the tie crosses nothing: it is
        adjacent, an endpoint is not on this section, every intermediate is
        sub-TD, or none is in scope.
    """
    line = _span_line(tie, section_order)
    if line is None:
        return []

    crossings: list[SpanCrossing] = []
    for col in sorted(section_order, key=lambda c: c.along_m):
        # An endpoint is not crossed by its own tie: a tie ANCHORED on a column
        # states something about it, only a tie passing OVER one crosses it.
        if col.investigation_id in (tie.inv_a, tie.inv_b):
            continue
        if crossable_ids is not None and col.investigation_id not in crossable_ids:
            continue
        if not line.spans(col.along_m):
            continue
        if col.deepest_base_m is None or not col.contacts_m:
            continue  # bandless — no banded range to cross
        crossing_elev = line.elevation_at(col.along_m)
        top_elev = col.collar_elev_m - min(col.contacts_m)
        base_elev = col.collar_elev_m - col.deepest_base_m
        # Millimetre slack, the same grid tolerance the landing test uses: both
        # sides come off the same mm depths.
        if not (base_elev - _DATA_TOL_M <= crossing_elev <= top_elev + _DATA_TOL_M):
            continue
        crossings.append(
            SpanCrossing(investigation_id=col.investigation_id, crossing_elev_m=crossing_elev)
        )
    return crossings


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
    line = _span_line(tie, section_order)
    if line is None:
        return None
    col_a, col_b = line.col_a, line.col_b

    intermediates = sorted(
        (
            col
            for col in section_order
            if line.spans(col.along_m) and col.investigation_id not in (tie.inv_a, tie.inv_b)
        ),
        key=lambda col: col.along_m,
    )

    landed: list[SpanNode] = []
    for col in intermediates:
        if col.deepest_base_m is None or not col.contacts_m:
            continue  # bandless — the span keeps spanning it
        line_depth = col.collar_elev_m - line.elevation_at(col.along_m)
        # "If the borehole has data" — the line must pass through the column's
        # banded extent. Above the first band or below the deepest base, the
        # column cannot speak at this depth and the tie is sub-TD there.
        if not (
            min(col.contacts_m) - _DATA_TOL_M <= line_depth <= col.deepest_base_m + _DATA_TOL_M
        ):
            continue
        # The soils the span's own seams carry, per face. A landing contact
        # must present them: nearest-by-depth alone landed a sand span on
        # B6's ZAND8|KLEI22 seam 0.11 m off, past the VD top 0.42 m off, and
        # the SAND↔CLAY hops it wrote had to be pruned by hand. A ``None``
        # face (no band, or unknown) never contradicts.
        allowed_above = {s[0] for s in (tie.soils_a, tie.soils_b) if s is not None}
        allowed_below = {s[1] for s in (tie.soils_a, tie.soils_b) if s is not None}

        def _seam_ok(index: int) -> bool:
            if index >= len(col.contact_soils):
                return True
            above, below = col.contact_soils[index]
            above_ok = above is None or not allowed_above or above in allowed_above
            below_ok = below is None or not allowed_below or below in allowed_below
            return above_ok and below_ok

        candidates = [
            contact
            for index, contact in enumerate(col.contacts_m)
            if abs(contact - line_depth) <= SPAN_LANDING_TOLERANCE_M and _seam_ok(index)
        ]
        if not candidates:
            # The line crosses this column mid-band, or every nearby contact
            # is the wrong seam: the column does not express the tie's
            # surface — keep spanning it (SP8: B2's thick homogeneous sand;
            # SP10: B6's clay top under a sand span).
            continue
        nearest = min(candidates, key=lambda contact: abs(contact - line_depth))
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
