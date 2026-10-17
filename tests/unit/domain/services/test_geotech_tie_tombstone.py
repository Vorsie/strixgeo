"""A tie the engineer deletes stays deleted, keyed on where it was.

Owner ruling, 2026-08-17: *"A tie i delete stays deleted but does not delete on
the litho model"*, and on how to key it: *"just do position xyz left and xyz
right and the section it was on?"*

Why position and not the rows it joined: the bands are rebuilt by pipeline step
1 and step 4 — new rows, new ids — so a tombstone naming two band ids stops
matching the moment the model is re-derived, and the tie returns anyway.  The
PLACE survives the rebuild.  It is also the same principle he applied to tie
endpoints earlier the same day: *"Can't work in x,y,z space without using x,y,z
coordinates."*

The two ends are stored as real-world coordinates: x/y from the investigation's
map position, z as the contact's ELEVATION.  x and y therefore identify the
column exactly (a test does not move), and only z needs a tolerance, because a
re-derivation can settle a boundary a few centimetres away from where it was.
"""

from uuid import UUID

from groundmodel.domain.services.geotech_tie_tombstone import (
    TiePoint,
    TieTombstone,
    tie_is_tombstoned,
)

CS1 = UUID(int=1)
CS2 = UUID(int=2)

# His S9↔B3 gap: the clay tie he deleted twice, in map coordinates.
S9_TOP = TiePoint(x=149_100.0, y=200_500.0, z=-2.43)
B3_TOP = TiePoint(x=149_640.0, y=200_480.0, z=-1.50)
DEEPER = TiePoint(x=149_640.0, y=200_480.0, z=-9.00)

TOL = 0.175  # half the default minimum band thickness


def _stone(a: TiePoint, b: TiePoint, section: UUID = CS1) -> TieTombstone:
    return TieTombstone(section_id=section, a=a, b=b)


def test_tb1_the_tie_he_deleted_does_not_come_back() -> None:
    """Same two places, same section: the derivation must not restate it."""
    assert tie_is_tombstoned([_stone(S9_TOP, B3_TOP)], CS1, S9_TOP, B3_TOP, tolerance_m=TOL)


def test_tb2_the_ends_may_arrive_in_either_order() -> None:
    """A tie is one statement however the two writers hold its endpoints."""
    assert tie_is_tombstoned([_stone(S9_TOP, B3_TOP)], CS1, B3_TOP, S9_TOP, tolerance_m=TOL)


def test_tb3_a_boundary_that_settled_a_little_still_matches() -> None:
    """A re-derivation can move a contact centimetres; that is the same tie.

    Without the tolerance the tombstone would silently stop working after any
    re-subdivide, which is the failure it exists to prevent.
    """
    settled = TiePoint(x=B3_TOP.x, y=B3_TOP.y, z=B3_TOP.z - 0.12)
    assert tie_is_tombstoned([_stone(S9_TOP, B3_TOP)], CS1, S9_TOP, settled, tolerance_m=TOL)


def test_tb4_the_next_band_boundary_down_is_a_different_tie() -> None:
    """The tolerance may never reach a neighbouring contact.

    Two boundaries cannot be closer than the model's minimum band thickness, so
    half of it is the widest tolerance that can never be ambiguous.  Any wider
    and deleting one tie would silently suppress its neighbour, with nothing on
    screen to explain why the tie will not draw.
    """
    assert not tie_is_tombstoned([_stone(S9_TOP, B3_TOP)], CS1, S9_TOP, DEEPER, tolerance_m=TOL)


def test_tb5_another_column_at_the_same_elevation_is_a_different_tie() -> None:
    """x/y identify the column, and a test does not move."""
    elsewhere = TiePoint(x=149_900.0, y=200_480.0, z=B3_TOP.z)
    assert not tie_is_tombstoned([_stone(S9_TOP, B3_TOP)], CS1, S9_TOP, elsewhere, tolerance_m=TOL)


def test_tb6_the_section_is_part_of_the_key() -> None:
    """Correlations are section-scoped — *"and the section it was on"*.

    The same two bands may legitimately be tied on one section and not another,
    so a deletion on CS1 must say nothing about CS2.
    """
    assert not tie_is_tombstoned(
        [_stone(S9_TOP, B3_TOP, section=CS2)], CS1, S9_TOP, B3_TOP, tolerance_m=TOL
    )


def test_tb7_no_tombstones_blocks_nothing() -> None:
    """The ordinary case: an untouched model derives exactly as before."""
    assert not tie_is_tombstoned([], CS1, S9_TOP, B3_TOP, tolerance_m=TOL)


def test_tb8_one_end_matching_is_not_a_match() -> None:
    """Half a tie is not the tie — it is the fan beside it."""
    assert not tie_is_tombstoned(
        [_stone(S9_TOP, B3_TOP)],
        CS1,
        S9_TOP,
        TiePoint(149_640.0, 200_480.0, -5.0),
        tolerance_m=TOL,
    )
