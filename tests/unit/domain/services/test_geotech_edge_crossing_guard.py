"""Behaviour tests for the geotech crossing guard.

Owner's screenshot (dogfeed 2026-08-15): pressing pipeline step 2 put the
banner *"1 crossing correlation tie — resolve to restore bands"* on the section
and the bands then refused to draw on that gap.  Crossing ties are a HARD
CONFLICT by the owner's own §8 Q4 ruling — neither side bands — so a machine
proposal that crosses is pure friction and kills the fill where it lands.

These pin the arithmetic the derivation rejects on.  The rule is stated in the
section's own terms: *two ties in one gap cross when their endpoint order is
inverted between the two columns*.

    XG1  order held on both columns → no crossing
    XG2  order inverted between the columns → crossing
    XG3  a shared endpoint is a fan, not a crossing
    XG4  the gap key names the same column pair whichever way round it is given
    XG5  the crossing partners are reported, all of them, in registration order
    XG6  depth-space and elevation-space agree on what crosses (the guard works
         in depth below collar; the renderer works in elevation)
"""

from groundmodel.domain.services.geotech_edge_crossing_guard import (
    GapTie,
    crossing_partners,
    gap_key,
    ties_cross,
)


def _tie(first: float, second: float, *, accepted: bool = False) -> GapTie:
    """Build a tie joining ``first`` on the left column to ``second`` on the right."""
    return GapTie(
        depth_first_m=first,
        depth_second_m=second,
        accepted=accepted,
        layer_first_id=f"L{first}",
        layer_second_id=f"R{second}",
    )


def test_xg1_two_ties_that_keep_their_order_on_both_columns_do_not_cross() -> None:
    """A shallow tie stays above a deep tie at both ends — the normal picture."""
    shallow = _tie(1.0, 1.5)
    deep = _tie(4.0, 5.0)
    assert ties_cross(shallow, deep) is False
    assert ties_cross(deep, shallow) is False


def test_xg2_order_inverted_between_the_columns_is_a_crossing() -> None:
    """The owner's defect: the upper tie on the left lands lower on the right."""
    upper_left = _tie(1.0, 6.0)
    lower_left = _tie(4.0, 2.0)
    assert ties_cross(upper_left, lower_left) is True
    assert ties_cross(lower_left, upper_left) is True


def test_xg3_two_ties_sharing_an_endpoint_fan_out_they_do_not_cross() -> None:
    """Several ties may leave one band — that is a fan, and it bands fine."""
    left_shared = _tie(2.0, 1.0)
    also_left_shared = _tie(2.0, 5.0)
    assert ties_cross(left_shared, also_left_shared) is False

    right_shared = _tie(1.0, 3.0)
    also_right_shared = _tie(5.0, 3.0)
    assert ties_cross(right_shared, also_right_shared) is False


def test_xg4_the_gap_key_names_the_same_column_pair_either_way_round() -> None:
    """A tie drawn right-to-left sits in the same gap as one drawn left-to-right."""
    assert gap_key("inv-a", "inv-b") == gap_key("inv-b", "inv-a")


def test_xg5_every_crossing_partner_is_reported_in_registration_order() -> None:
    """The caller has to know WHICH tie it would cross to name it in the log."""
    accepted = _tie(1.0, 6.0, accepted=True)
    parallel = _tie(0.5, 0.4)
    another_crosser = _tie(2.0, 7.0)
    candidate = _tie(4.0, 2.0)

    partners = crossing_partners([accepted, parallel, another_crosser], candidate)

    assert partners == [accepted, another_crosser]
    assert crossing_partners([parallel], candidate) == []


def test_xg6_depth_space_and_elevation_space_agree_on_what_crosses() -> None:
    """The guard reads depths; the renderer reads elevations. They must agree.

    Both endpoint differences are taken WITHIN one column, so converting to
    elevation flips the sign of each difference and leaves their product — the
    crossing test — untouched.  Different collar levels per column therefore
    cannot make the two sides disagree.
    """
    left_collar, right_collar = 5.0, 12.0
    for first_depths, second_depths in (
        ((1.0, 6.0), (4.0, 2.0)),  # crossing
        ((1.0, 1.5), (4.0, 5.0)),  # not crossing
        ((2.0, 1.0), (2.0, 5.0)),  # shared endpoint
    ):
        in_depth = ties_cross(_tie(*first_depths), _tie(*second_depths))
        in_elevation = ties_cross(
            _tie(left_collar - first_depths[0], right_collar - first_depths[1]),
            _tie(left_collar - second_depths[0], right_collar - second_depths[1]),
        )
        assert in_depth == in_elevation
