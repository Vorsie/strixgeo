"""A litho tie WALKS through bandless columns as a contact, packing-agnostic.

Owner, 2026-08-17 (two corrections in one evening):

* *"the accepted litho ties between two cpt's with two boreholes are missing.
  maybe you can add those, it's easy just walk a tie to the next cpt, if it
  arrives you place a direct connection if not then skip."*
* *"litho ties are packing agnostic which means you are not emitting the litho
  ties but are interpreting and emitting ties based on packing"* — the old
  bridge produced layer PAIRS and handed them to the class-matched aligner, so
  a chained litho tie whose end bands differed in NAD class simply vanished
  (his red line: the sand top S6 9.82 ↔ S13 9.69, chained through B6 and B4).

So the walk carries the CONTACT: each hop is one of his accepted litho ties,
each node is a depth on a column (the xyz ruling — the same physical contact
may be stored as one layer's base and another's top, so identity is by depth,
never by (layer, side)).  A column with geotech bands is a terminal; a column
without any is transit.  Arrive → connect the two terminal contacts; no
arrival → skip.  Packing classes are never consulted.
"""

from uuid import UUID

from groundmodel.domain.services.geotech_edge_bridging import bridged_contact_pairs

S6, B6, B4, S13, S9 = "s6", "b6", "b4", "s13", "s9"

# Layer ids, named for readability.
S6_SAND = UUID(int=1)
B6_MID = UUID(int=2)
B6_ABOVE = UUID(int=3)
B4_MID = UUID(int=4)
S13_SAND = UUID(int=5)
S9_SAND = UUID(int=6)

LAYERS = {
    S6_SAND: (S6, 9.82, 12.42),
    B6_ABOVE: (B6, 6.89, 9.50),
    B6_MID: (B6, 9.50, 12.59),
    B4_MID: (B4, 6.00, 12.52),
    S13_SAND: (S13, 9.69, 12.90),
    S9_SAND: (S9, 9.60, 12.00),
}

# His chain, as stored: note the middle hop names B6's contact 9.50 via the
# layer ABOVE it (side base) while the first hop names it via the layer BELOW
# (side top) — the depth is the same contact, the rows disagree on the label.
CHAIN = {
    (S6_SAND, B6_MID, "top", "top"),  # S6 9.82 <-> B6 9.50
    (B4_MID, B6_ABOVE, "top", "base"),  # B4 6.00 <-> B6 9.50 (via the layer above)
    (S13_SAND, B4_MID, "top", "top"),  # S13 9.69 <-> B4 6.00
}


def _pairs(ties, banded):
    return {
        (a_id, a_side, b_id, b_side)
        for (a_id, a_side), (b_id, b_side) in bridged_contact_pairs(
            litho_sided_ties=ties,
            layer_depths=LAYERS,
            columns_with_bands=banded,
        )
    }


def test_cw1_his_sand_top_chain_arrives_and_connects() -> None:
    """S6 9.82 walks B6 9.50 → B4 6.00 → arrives S13 9.69: one direct connection."""
    out = _pairs(CHAIN, {S6, S13})
    assert (S6_SAND, "top", S13_SAND, "top") in out or (S13_SAND, "top", S6_SAND, "top") in out
    assert len(out) == 1


def test_cw2_contact_identity_is_the_depth_not_the_layer_row() -> None:
    """The chain crosses B6's 9.50 stated as one layer's top AND another's base.

    A (layer, side) node model breaks exactly here — the two hops name
    different rows — and the walk dies at B6.  Depth identity carries it.
    """
    # Same chain, but the first hop ALSO names B6's contact via the layer
    # above (side base): the walk must behave identically.
    rewritten = {
        (S6_SAND, B6_ABOVE, "top", "base"),
        (B4_MID, B6_MID, "top", "top"),
        (S13_SAND, B4_MID, "top", "top"),
    }
    assert len(_pairs(rewritten, {S6, S13})) == 1


def test_cw3_a_chain_that_never_arrives_is_skipped() -> None:
    """*"if it arrives you place a direct connection if not then skip"*."""
    dead_end = {(S6_SAND, B6_MID, "top", "top")}  # B6 bandless, nothing beyond
    assert _pairs(dead_end, {S6, S13}) == set()


def test_cw4_a_direct_tie_between_two_banded_columns_is_not_re_emitted() -> None:
    """Direct ties already restate; the walk only adds what chains."""
    direct = {(S6_SAND, S13_SAND, "top", "top")}
    assert _pairs(direct, {S6, S13}) == set()


def test_cw5_the_walk_does_not_shortcut_past_a_banded_column() -> None:
    """S6 → B6 → S9 (banded) → ...: the walk stops at S9.

    S9 has its own correlations onward; an S6↔S13 shortcut would connect
    contacts the engineer never chained through a bandless stretch.
    """
    ties = {
        (S6_SAND, B6_MID, "top", "top"),
        (S9_SAND, B6_MID, "top", "top"),  # B6 9.50 also ties to S9 (banded)
        (S13_SAND, S9_SAND, "top", "top"),  # S9 onward to S13, directly
    }
    out = _pairs(ties, {S6, S13, S9})
    assert (S6_SAND, "top", S9_SAND, "top") in out or (S9_SAND, "top", S6_SAND, "top") in out
    assert not any({p[0], p[2]} == {S6_SAND, S13_SAND} for p in out)


def test_cw6_two_arrivals_from_one_contact_both_connect() -> None:
    """A transit contact fanning to two banded columns states a wedge — keep both."""
    ties = {
        (S6_SAND, B6_MID, "top", "top"),
        (S13_SAND, B6_MID, "top", "top"),
        (S9_SAND, B6_MID, "top", "top"),
    }
    out = _pairs(ties, {S6, S13, S9})
    assert len(out) == 3  # every pair of the three terminals, through B6


def test_cw7_a_hop_landing_on_a_different_contact_does_not_chain() -> None:
    """Two ties touching the same transit LAYER at different depths are
    different statements — the layer-graph walk chained them; contacts must not.
    """
    ties = {
        (S6_SAND, B6_MID, "top", "top"),  # arrives B6 at 9.50
        (S13_SAND, B6_MID, "top", "base"),  # leaves B6 at 12.59: not the same contact
    }
    assert _pairs(ties, {S6, S13}) == set()
