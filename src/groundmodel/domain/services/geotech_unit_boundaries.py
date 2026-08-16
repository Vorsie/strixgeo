"""Place a litho unit's packing boundaries on a borehole standing between two CPTs.

Owner's rule, 2026-08-16, given verbatim after three of my attempts had failed:

    first check all contacts if they are litho contacts? If a cpt to cpt contact
    is a litho contact, then you replace it by the litho bands? If it is not a
    litho band but a packing band, find the litho band above it below it.
    measure it's position relative to those two, if the packing band is
    continuous draw it, if it is a lens or onlap check if the boreholes is more
    than 0.5xD away if it is not draw the lens of onlap on the borehole, if it
    is not then prefer the matrix

    ... then you delete all the bands you checked and replaced by hops

Why this is the right shape, and the earlier attempts were not
--------------------------------------------------------------
Every previous attempt derived the borehole's correlation from something
ONE-SIDED — a donor stack that usually resolved to a single flank, then a
partition region that named only the layer it grew from — so the hop it wrote
reached one CPT and never the other. The chain a spanning tie needs
(CPT→BH→BH→CPT) could not close, and the tie was never replaced.

A TIE names both bands it joins. Placing a boundary FROM the tie therefore
yields the correspondence on both sides for free, and the chain closes by
construction rather than by a search that has to rediscover it.

That is also why deletion becomes bookkeeping: a tie that was re-expressed is
known to have been re-expressed, so it is deleted outright. Nothing has to
prove after the fact that a replacement exists.

Litho stays authoritative: a boundary that IS a litho contact is already on the
borehole's own log and is never interpolated; only boundaries INTERIOR to a
litho unit are placed, and they are placed at their fraction of that unit.

Pure domain module: no I/O, no ORM, no logging.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

# Boundaries closer than this to the unit's own top or base are the unit
# contact itself, not an interior packing boundary: ``litho_layer`` stores
# intervals at mm grain, so anything finer is noise.
_MIN_OFFSET = 0.001

# A one-sided construct (lens / onlap) reaches half-way across the gap — the
# same half-length the 2/1/0 fill draws it with. A column beyond that takes the
# matrix instead.
_HALF_LENGTH = 0.5


@dataclass(frozen=True)
class ColumnBoundary:
    """One packing boundary inside a litho unit on one CPT column.

    Parameters
    ----------
    fraction : float
        Position within the unit, ``0`` at its top contact and ``1`` at its
        base. Interior boundaries only — the contacts themselves are the litho
        model's and are never carried here.
    band_above_id : str
        ``litho_layer`` id of the packing band immediately above the boundary.
    band_below_id : str
        ``litho_layer`` id of the band immediately below it.
    """

    fraction: float
    band_above_id: str
    band_below_id: str


@dataclass(frozen=True)
class PlacedBoundary:
    """A boundary laid on the borehole, and what it corresponds to.

    Parameters
    ----------
    depth_m : float
        Depth below the borehole's collar.
    fraction : float
        Position within the borehole's own unit, for provenance.
    left_band_above_id, left_band_below_id : str | None
        The bands the boundary separates on the LEFT column, when that column
        declared it.
    right_band_above_id, right_band_below_id : str | None
        The same on the RIGHT column.
    kind : str
        ``continuous`` when a tie declared it on both columns, ``onlap`` or
        ``lens`` when one column did and the borehole stands within reach.
    tie_index : int | None
        Index into the caller's tie list for a ``continuous`` boundary — what
        the caller deletes once it has written the hops. ``None`` otherwise:
        a one-sided construct replaced no tie.
    """

    depth_m: float
    fraction: float
    left_band_above_id: str | None
    left_band_below_id: str | None
    right_band_above_id: str | None
    right_band_below_id: str | None
    kind: str
    tie_index: int | None


def place_unit_boundaries(
    left: Sequence[ColumnBoundary],
    right: Sequence[ColumnBoundary],
    ties: Sequence[tuple[int, int]],
    *,
    fraction: float,
    unit_top_m: float,
    unit_base_m: float,
) -> list[PlacedBoundary]:
    """Lay one litho unit's interior packing boundaries onto a borehole.

    Parameters
    ----------
    left, right : Sequence[ColumnBoundary]
        The unit's interior packing boundaries on the gap's two CPT columns,
        each already expressed as a fraction of that column's own unit.
    ties : Sequence[tuple[int, int]]
        Accepted correlations as ``(index into left, index into right)``. Each
        one declares its boundary CONTINUOUS across the gap.
    fraction : float
        Where the borehole stands across the gap: ``0`` at the left column,
        ``1`` at the right.
    unit_top_m, unit_base_m : float
        The unit's extent on the BOREHOLE's own log — the litho model's answer,
        never interpolated.

    Returns
    -------
    list[PlacedBoundary]
        Boundaries inside ``(unit_top_m, unit_base_m)``, ordered top to bottom
        and strictly increasing. A boundary that would land on the unit's own
        contact, or outside it, is dropped: the contact is the litho model's.

    Notes
    -----
    A tied boundary is blended between the two columns' fractions by the
    borehole's position, so a boundary 40 % down the unit on both sides stays
    40 % down it here however the unit thickens.

    An untied boundary is a lens or an onlap: it is drawn only if the borehole
    stands within half the gap of the column that declared it, and otherwise
    the matrix wins. That is the same half-length the 2/1/0 fill draws these
    with, so the section and the borehole agree about where they end.
    """
    thickness = unit_base_m - unit_top_m
    if thickness <= 0.0:
        return []

    tied_left = {i for i, _ in ties}
    tied_right = {j for _, j in ties}
    placed: list[PlacedBoundary] = []

    for tie_index, (i, j) in enumerate(ties):
        if not (0 <= i < len(left) and 0 <= j < len(right)):
            continue
        blended = left[i].fraction + fraction * (right[j].fraction - left[i].fraction)
        placed.append(
            PlacedBoundary(
                depth_m=unit_top_m + blended * thickness,
                fraction=blended,
                left_band_above_id=left[i].band_above_id,
                left_band_below_id=left[i].band_below_id,
                right_band_above_id=right[j].band_above_id,
                right_band_below_id=right[j].band_below_id,
                kind="continuous",
                tie_index=tie_index,
            )
        )

    # One-sided constructs. ``fraction`` is the distance from the left column,
    # so the left column's own reach is ``fraction <= 0.5`` and the right
    # column's is the mirror.
    if fraction <= _HALF_LENGTH:
        for i, boundary in enumerate(left):
            if i in tied_left:
                continue
            placed.append(
                PlacedBoundary(
                    depth_m=unit_top_m + boundary.fraction * thickness,
                    fraction=boundary.fraction,
                    left_band_above_id=boundary.band_above_id,
                    left_band_below_id=boundary.band_below_id,
                    right_band_above_id=None,
                    right_band_below_id=None,
                    kind="onlap",
                    tie_index=None,
                )
            )
    if fraction >= _HALF_LENGTH:
        for j, boundary in enumerate(right):
            if j in tied_right:
                continue
            placed.append(
                PlacedBoundary(
                    depth_m=unit_top_m + boundary.fraction * thickness,
                    fraction=boundary.fraction,
                    left_band_above_id=None,
                    left_band_below_id=None,
                    right_band_above_id=boundary.band_above_id,
                    right_band_below_id=boundary.band_below_id,
                    kind="onlap",
                    tie_index=None,
                )
            )

    # The unit's own contacts belong to the litho model; a boundary landing on
    # one of them would redraw it.
    inside = [
        b
        for b in placed
        if b.depth_m - unit_top_m >= _MIN_OFFSET and unit_base_m - b.depth_m >= _MIN_OFFSET
    ]
    inside.sort(key=lambda b: b.depth_m)

    # Two boundaries closer than the storage grain are one boundary; keeping the
    # first is what makes the resulting bands writable.
    deduped: list[PlacedBoundary] = []
    for boundary in inside:
        if deduped and boundary.depth_m - deduped[-1].depth_m < _MIN_OFFSET:
            continue
        deduped.append(boundary)
    return deduped


def replaced_tie_indices(placed: Sequence[PlacedBoundary]) -> list[int]:
    """Which ties were re-expressed, and may therefore be deleted.

    Owner, 2026-08-16: *"then you delete all the bands you checked and replaced
    by hops"*. A tie whose boundary was placed on the borehole has had its
    replacement written, so it goes. A tie whose boundary was NOT placed — it
    fell on the unit's own contact, or it was an onlap the borehole stood
    beyond — was not replaced and must survive.

    Parameters
    ----------
    placed : Sequence[PlacedBoundary]
        The output of :func:`place_unit_boundaries`.

    Returns
    -------
    list[int]
        Tie indices, ascending and unique.
    """
    return sorted({b.tie_index for b in placed if b.tie_index is not None})
