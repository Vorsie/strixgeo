"""Only a real correspondence earns a correlation.

Owner, 2026-08-17: *"those hops are then from the fallbacks? Don't hop those?
The ties from the litho are good, your hops are the issue."*

A hop is a claim that two bands are the same packing surface.  A band the donor
rule could not answer has no such partner — it carries a conservative class
taken from its own column — so writing a correlation from it dresses a guess as
a correspondence, and the fill then bands that guess laterally across the gap.
His B4 grew a dense sheet nobody drew for exactly this reason.
"""

from groundmodel.application.divide_boreholes import band_may_carry_a_hop


def test_he1_a_cpt_resolved_band_may_carry_a_hop() -> None:
    """A band a flanking column actually resolved has a real partner."""
    assert band_may_carry_a_hop("cpt_interpolated") is True


def test_he2_a_column_floor_band_may_not() -> None:
    """The class came from this column's own other bands, not from a partner."""
    assert band_may_carry_a_hop("column_min") is False


def test_he3_the_table_floor_may_not() -> None:
    """No evidence at all, so nothing to correlate with."""
    assert band_may_carry_a_hop("absolute_min") is False


def test_he4_the_body_minimum_may_not() -> None:
    """A body-wide weakest class is a guess about the body, not a surface."""
    assert band_may_carry_a_hop("body_min") is False


def test_he5_an_unknown_token_may_not() -> None:
    """Default closed: a provenance nobody has ruled on does not get to claim."""
    assert band_may_carry_a_hop("something_new") is False
