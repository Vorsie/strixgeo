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
litho unit are placed.

Where they land changed on 2026-08-18. The first build read "measure it's
position relative to those two" as a FRACTION of the unit, blended between the
columns. On B9 that put the committed contact 2.2 m above the tie line the
engineer had drawn — his unit is far thicker than the flanks', so the fraction
blend and the drawn line disagree. His ruling: *"go for the mtaw, it'll look
better than the fractional"*. A tied boundary now lands where the drawn tie
LINE crosses the borehole's column (elevation-interpolated between the two
columns' boundary elevations); a one-sided construct carries flat at its own
elevation. A landing outside the borehole's unit is dropped — the litho
contact already bounds it there.

Pure domain module: no I/O, no ORM, no logging.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

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
    elev_m : float
        The boundary's elevation on its own column (mTAW) — collar minus its
        depth. Interior boundaries only — the contacts themselves are the
        litho model's and are never carried here.
    band_above_id : str
        ``litho_layer`` id of the packing band immediately above the boundary.
    band_below_id : str
        ``litho_layer`` id of the band immediately below it.
    """

    elev_m: float
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
    on_log : bool
        ``True`` when the boundary lands strictly inside the borehole's unit
        and becomes a band cut on its log. ``False`` for a tie LINE that
        crosses the column outside the unit (or on its contact): the litho
        contact bounds the unit there, so nothing is drawn and the tie is not
        replaced — but the line still says which bands run PAST the unit, so
        the caller can classify the intervals it clips.
    """

    depth_m: float
    fraction: float
    left_band_above_id: str | None
    left_band_below_id: str | None
    right_band_above_id: str | None
    right_band_below_id: str | None
    kind: str
    tie_index: int | None
    on_log: bool = True


def interior_boundary_index(band_index: int, side: str, band_count: int) -> int | None:
    """Which interior seam a tie endpoint's (band, side) declares.

    Audit P1-2 (2026-08-18): the placement used to assume every endpoint was a
    ``top``, so a base↔base tie — the bottom-tie spec, the only way the deepest
    band can band — was applied one seam too high, and a base tie on the
    deepest band was silently dropped by a guard written for tops.  A tie
    names a band AND a side; the side decides which seam is meant.

    Parameters
    ----------
    band_index : int
        The endpoint band's index in its column stack, 0 = shallowest.
    side : str
        ``'top'`` or ``'base'`` — which surface of that band the tie names.
    band_count : int
        How many bands the stack holds inside this litho unit.

    Returns
    -------
    int | None
        The interior seam index (seam ``k`` lies between bands ``k`` and
        ``k+1``), or ``None`` when the named surface is the unit's own litho
        contact — the litho model owns those, this placement never moves them.
        Band 0's base and band 1's top are ONE physical seam and map to one
        index, whichever way the tie was stated.
    """
    if side == "base":
        return band_index if band_index < band_count - 1 else None
    return band_index - 1 if band_index > 0 else None


def place_unit_boundaries(
    left: Sequence[ColumnBoundary],
    right: Sequence[ColumnBoundary],
    ties: Sequence[tuple[int, int]],
    *,
    fraction: float,
    unit_top_m: float,
    unit_base_m: float,
    bh_collar_elev_m: float,
) -> list[PlacedBoundary]:
    """Lay one litho unit's interior packing boundaries onto a borehole.

    Parameters
    ----------
    left, right : Sequence[ColumnBoundary]
        The unit's interior packing boundaries on the gap's two CPT columns,
        each carrying its own elevation (mTAW).
    ties : Sequence[tuple[int, int]]
        Accepted correlations as ``(index into left, index into right)``. Each
        one declares its boundary CONTINUOUS across the gap.
    fraction : float
        Where the borehole stands across the gap: ``0`` at the left column,
        ``1`` at the right.
    unit_top_m, unit_base_m : float
        The unit's extent on the BOREHOLE's own log — the litho model's answer,
        never interpolated.
    bh_collar_elev_m : float
        The borehole's collar elevation, to convert a landed elevation back to
        a depth on its log.

    Returns
    -------
    list[PlacedBoundary]
        Boundaries ordered top to bottom. Entries with ``on_log=True`` land
        strictly inside ``(unit_top_m, unit_base_m)`` and become band cuts. A
        tied LINE that lands on the unit's contact or outside it is returned
        with ``on_log=False`` — never drawn (the contact is the litho
        model's), but its band names still classify the intervals it clips. A
        one-sided construct outside the unit is dropped outright.

    Notes
    -----
    A tied boundary lands where the drawn tie LINE crosses the borehole: its
    elevation interpolated between the two columns' boundary elevations by the
    borehole's position across the gap. The committed contact and the line on
    screen are then the same thing (owner, 2026-08-18: *"go for the mtaw,
    it'll look better than the fractional"*).

    An untied boundary is a lens or an onlap: it is drawn only if the borehole
    stands within half the gap of the column that declared it — flat, at its
    own elevation — and otherwise the matrix wins. That is the same
    half-length the 2/1/0 fill draws these with, so the section and the
    borehole agree about where they end.
    """
    thickness = unit_base_m - unit_top_m
    if thickness <= 0.0:
        return []

    def _at(elev_m: float) -> tuple[float, float]:
        """A landing elevation as (depth on the borehole, fraction of its unit)."""
        depth_m = bh_collar_elev_m - elev_m
        return depth_m, (depth_m - unit_top_m) / thickness

    tied_left = {i for i, _ in ties}
    tied_right = {j for _, j in ties}
    placed: list[PlacedBoundary] = []

    for tie_index, (i, j) in enumerate(ties):
        if not (0 <= i < len(left) and 0 <= j < len(right)):
            continue
        line_elev = left[i].elev_m + fraction * (right[j].elev_m - left[i].elev_m)
        depth_m, unit_fraction = _at(line_elev)
        placed.append(
            PlacedBoundary(
                depth_m=depth_m,
                fraction=unit_fraction,
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
            depth_m, unit_fraction = _at(boundary.elev_m)
            placed.append(
                PlacedBoundary(
                    depth_m=depth_m,
                    fraction=unit_fraction,
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
            depth_m, unit_fraction = _at(boundary.elev_m)
            placed.append(
                PlacedBoundary(
                    depth_m=depth_m,
                    fraction=unit_fraction,
                    left_band_above_id=None,
                    left_band_below_id=None,
                    right_band_above_id=boundary.band_above_id,
                    right_band_below_id=boundary.band_below_id,
                    kind="onlap",
                    tie_index=None,
                )
            )

    # The unit's own contacts belong to the litho model; a boundary landing on
    # one of them would redraw it. A tied LINE outside the unit is kept as
    # off-log context — it still says which bands run past the unit — while a
    # one-sided construct outside it is simply absent (the matrix rule).
    def _is_inside(b: PlacedBoundary) -> bool:
        return b.depth_m - unit_top_m >= _MIN_OFFSET and unit_base_m - b.depth_m >= _MIN_OFFSET

    inside = sorted((b for b in placed if _is_inside(b)), key=lambda b: b.depth_m)
    context = sorted(
        (replace(b, on_log=False) for b in placed if not _is_inside(b) and b.kind == "continuous"),
        key=lambda b: b.depth_m,
    )

    # Two boundaries closer than the storage grain are one boundary; keeping the
    # first is what makes the resulting bands writable.
    deduped: list[PlacedBoundary] = []
    for candidate in inside:
        if deduped and candidate.depth_m - deduped[-1].depth_m < _MIN_OFFSET:
            continue
        deduped.append(candidate)
    return sorted([*context, *deduped], key=lambda b: b.depth_m)


def replaced_tie_indices(placed: Sequence[PlacedBoundary]) -> list[int]:
    """Which ties were re-expressed, and may therefore be deleted.

    Owner, 2026-08-16: *"then you delete all the bands you checked and replaced
    by hops"*. A tie whose boundary was placed on the borehole has had its
    replacement written, so it goes. A tie whose boundary was NOT placed — it
    fell on the unit's own contact or outside the unit, or it was an onlap the
    borehole stood beyond — was not replaced and must survive.

    Parameters
    ----------
    placed : Sequence[PlacedBoundary]
        The output of :func:`place_unit_boundaries`.

    Returns
    -------
    list[int]
        Tie indices, ascending and unique.
    """
    return sorted({b.tie_index for b in placed if b.tie_index is not None and b.on_log})
