"""A packing tie the engineer deleted, remembered by WHERE it was.

Owner ruling, 2026-08-17: *"A tie i delete stays deleted but does not delete on
the litho model"*, and on how to key it: *"just do position xyz left and xyz
right and the section it was on?"*

Why position, and not the two rows the tie joined: the packing bands are rebuilt
by pipeline step 1 and step 4 — new rows, new ids — so a tombstone naming two
band ids stops matching the moment the model is re-derived, and the deleted tie
comes back anyway.  That is exactly the loop he met twice.  The PLACE survives
the rebuild.  It is the same principle he applied to tie endpoints earlier the
same day: *"Can't work in x,y,z space without using x,y,z coordinates."*

Coordinates
-----------
Each end is a real-world point: ``x``/``y`` from the investigation's map
position, ``z`` the contact's ELEVATION (not depth below collar).  So ``x``/``y``
identify the column exactly — a test does not move — and only ``z`` needs a
tolerance, because a re-derivation can settle a boundary a few centimetres from
where it was.

The tolerance is HALF the model's minimum band thickness.  Two boundaries on one
column can never be closer than the minimum, so half of it is the widest value
that can never be ambiguous.  Anything wider and deleting one tie would silently
suppress its neighbour, with nothing on screen to explain why the tie will not
draw — a worse failure than a tie that returns, because it is invisible.

Scope
-----
A tombstone stops the MACHINE from restating a tie.  It never stops the engineer
from drawing one: if he deletes a tie and later draws it himself, that is a new
decision and it stands.  Deletions made by the machine's own repairs (the
crossing sweep, jump-tie supersession) leave no tombstone either — a tombstone
records HIS judgement, not the model's housekeeping.

Pure module: no session, no I/O, no logging.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

__all__ = [
    "TiePoint",
    "TieTombstone",
    "tie_is_tombstoned",
]

# Two points count as the same column when their map coordinates agree this
# closely. Not a geological tolerance: an investigation's stored position is a
# fixed float that round-trips through the database unchanged, so this only
# absorbs representation noise.
_SAME_COLUMN_TOL_M = 0.01


@dataclass(frozen=True)
class TiePoint:
    """One end of a tie, as a place rather than a row.

    Parameters
    ----------
    x, y : float
        The investigation's map position, in the project CRS.  These identify
        the column: a test does not move between presses.
    z : float
        The contact's elevation.  Elevation rather than depth below collar so
        the key means the same thing after a collar correction.
    """

    x: float
    y: float
    z: float


@dataclass(frozen=True)
class TieTombstone:
    """A tie the engineer deleted, and the section he deleted it on.

    Parameters
    ----------
    section_id : UUID
        Correlations are section-scoped — *"and the section it was on"*.  The
        same two bands may legitimately be tied on one section and not another,
        so a deletion on one says nothing about the other.
    a, b : TiePoint
        The two ends, in whichever order they were stored; matching is
        order-independent.
    """

    section_id: UUID
    a: TiePoint
    b: TiePoint


def _same_place(left: TiePoint, right: TiePoint, tolerance_m: float) -> bool:
    """Whether two ends name the same contact on the same column."""
    return (
        abs(left.x - right.x) <= _SAME_COLUMN_TOL_M
        and abs(left.y - right.y) <= _SAME_COLUMN_TOL_M
        and abs(left.z - right.z) <= tolerance_m
    )


def tie_is_tombstoned(
    tombstones: Iterable[TieTombstone],
    section_id: UUID,
    a: TiePoint,
    b: TiePoint,
    *,
    tolerance_m: float,
) -> bool:
    """Whether the engineer already deleted the tie between these two places.

    Parameters
    ----------
    tombstones : Iterable[TieTombstone]
        Every deletion recorded on this geotech model.
    section_id : UUID
        The section the candidate tie would be drawn on.
    a, b : TiePoint
        The candidate's two ends, in either order.
    tolerance_m : float
        Vertical tolerance — half the model's minimum band thickness.

    Returns
    -------
    bool
        ``True`` when a recorded deletion covers this tie, so the machine must
        not restate it.  ``False`` for an untombstoned model, which derives
        exactly as before.
    """
    for stone in tombstones:
        if stone.section_id != section_id:
            continue
        forwards = _same_place(stone.a, a, tolerance_m) and _same_place(stone.b, b, tolerance_m)
        backwards = _same_place(stone.a, b, tolerance_m) and _same_place(stone.b, a, tolerance_m)
        if forwards or backwards:
            return True
    return False
