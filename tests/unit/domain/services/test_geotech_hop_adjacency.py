"""A hop crosses ONE gap: it may not skip a column that carries the body.

Owner, 2026-08-17, on a red correlation running the width of the section:
*"especially when you look at the clay tie crossing a cpt, i didn't do that"*.

Measured on his model: exactly one tie exceeded 200 m — B4's clay top to
GEO-10/170-S7 at **284 m** — and five nearer columns carry that same clay (B6
at 2 m, S6 at 5 m, S10 at 78 m, S13 at 90 m).  No litho tie joins B4 and S7, so
nothing was being restated: the geotech stage invented it, because the donor
search rejected the near columns on elevation overlap and kept looking.

A hop asserts that two bands are the same surface across ONE gap.  With a
column carrying that body in between, the assertion is not the engine's to
make — the intervening column is evidence and it was not consulted.
"""

from groundmodel.domain.services.geotech_edge_dedup import hop_skips_a_column


def test_ha1_his_284_m_clay_tie_skips_columns() -> None:
    """B4 at 0 m to S7 at 284 m, with four banded columns in between."""
    assert hop_skips_a_column(0.0, 284.0, (2.0, 5.0, 78.0, 90.0)) is True


def test_ha2_an_adjacent_pair_is_fine() -> None:
    """Nothing between them, so the hop crosses exactly one gap."""
    assert hop_skips_a_column(0.0, 90.0, ()) is False


def test_ha3_a_column_outside_the_span_does_not_count() -> None:
    """Only what lies BETWEEN the two columns matters."""
    assert hop_skips_a_column(0.0, 90.0, (-20.0, 150.0)) is False


def test_ha4_the_endpoints_themselves_do_not_count() -> None:
    """A column at either end is one of the two being joined."""
    assert hop_skips_a_column(0.0, 90.0, (0.0, 90.0)) is False


def test_ha5_direction_does_not_matter() -> None:
    """The same pair, given right-to-left, answers the same."""
    assert hop_skips_a_column(284.0, 0.0, (78.0,)) is True


def test_ha6_a_column_a_millimetre_inside_still_counts() -> None:
    """No tolerance games: a column between them is between them."""
    assert hop_skips_a_column(0.0, 90.0, (89.999,)) is True
