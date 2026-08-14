"""Owner ruling 2026-08-14 — jump ties are REPLACED by the mediated chain.

The rule, in the owner's words: *"those cpt to cpt ties should be replaced by
cpt to borehole to borehole to cpt ties once i click subdivide boreholes"* and,
on whether hand-drawn ones are spared: *"just delete all, it'll be a real
bother to delete all by hand once the proper chain is there"*.

So: a CPT↔CPT jump tie (an edge whose two investigations have NO direct litho
tie — it was born by bridging over bandless columns) is superseded the moment
the proper chain is there — an ACCEPTED path of direct-litho-backed edges
connecting the SAME two bands through the divided boreholes.  Until that chain
exists, the jump tie is the only carrier of the connection and stays.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from groundmodel.domain.services.geotech_jump_tie_supersession import (
    GeotechEdgeForSupersession,
    superseded_jump_tie_ids,
)


def _edge(
    layer_a: UUID,
    layer_b: UUID,
    inv_a: str,
    inv_b: str,
    *,
    approved: bool = True,
) -> GeotechEdgeForSupersession:
    """Build one edge record with a fresh edge id."""
    return GeotechEdgeForSupersession(
        edge_id=uuid4(),
        layer_a_id=layer_a,
        layer_b_id=layer_b,
        investigation_a=inv_a,
        investigation_b=inv_b,
        user_approved=approved,
    )


def _pair(a: str, b: str) -> tuple[str, str]:
    """Canonical investigation pair."""
    lo, hi = sorted((a, b))
    return (lo, hi)


class TestJumpTieSupersession:
    """The 2026-08-14 replace-the-jump-tie ruling, case by case."""

    def test_jt1_the_proper_chain_replaces_the_jump_tie(self) -> None:
        """The full accepted CPT↔BH↔BH↔CPT chain is there → the jump tie goes."""
        s6, b6, b4, s13 = uuid4(), uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, b4, "B6", "B4"),
            _edge(b4, s13, "B4", "S13"),
        ]
        jump = _edge(s6, s13, "S6", "S13")
        direct = {_pair("S6", "B6"), _pair("B6", "B4"), _pair("B4", "S13")}

        superseded = superseded_jump_tie_ids([*chain, jump], direct)

        assert superseded == [jump.edge_id]

    def test_jt2_no_chain_yet_keeps_the_jump_tie(self) -> None:
        """A borehole got no band there → the jump tie is still the only carrier."""
        s6, b6, b4, s13 = uuid4(), uuid4(), uuid4(), uuid4()
        partial_chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, b4, "B6", "B4"),
            # B4 ↔ S13 never materialised.
        ]
        jump = _edge(s6, s13, "S6", "S13")
        direct = {_pair("S6", "B6"), _pair("B6", "B4"), _pair("B4", "S13")}

        assert superseded_jump_tie_ids([*partial_chain, jump], direct) == []

    def test_jt3_a_pending_chain_hop_keeps_the_jump_tie(self) -> None:
        """The chain does not carry approval until every hop is accepted."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13", approved=False),
        ]
        jump = _edge(s6, s13, "S6", "S13")
        direct = {_pair("S6", "B6"), _pair("B6", "S13")}

        assert superseded_jump_tie_ids([*chain, jump], direct) == []

    def test_jt5_a_chain_between_other_bands_is_not_this_ties_chain(self) -> None:
        """The chain connects the TOP bands; a jump tie between the DEEP bands
        still carries information no chain restated — it stays."""
        s6_top, b6_top, s13_top = uuid4(), uuid4(), uuid4()
        s6_deep, s13_deep = uuid4(), uuid4()
        top_chain = [
            _edge(s6_top, b6_top, "S6", "B6"),
            _edge(b6_top, s13_top, "B6", "S13"),
        ]
        deep_jump = _edge(s6_deep, s13_deep, "S6", "S13")
        direct = {_pair("S6", "B6"), _pair("B6", "S13")}

        assert superseded_jump_tie_ids([*top_chain, deep_jump], direct) == []

    def test_jt6_a_jump_tie_is_never_a_carrier_for_another(self) -> None:
        """A path that itself runs through a jump tie proves nothing — only
        direct-litho-backed hops count as the proper chain."""
        s6, s10, s13 = uuid4(), uuid4(), uuid4()
        # S6↔S10 is itself a jump (no direct litho tie); S10↔S13 is direct.
        jump_hop = _edge(s6, s10, "S6", "S10")
        direct_hop = _edge(s10, s13, "S10", "S13")
        jump = _edge(s6, s13, "S6", "S13")
        direct = {_pair("S10", "S13")}

        superseded = superseded_jump_tie_ids([jump_hop, direct_hop, jump], direct)

        assert superseded == []

    def test_jt7_a_restatement_of_a_direct_litho_tie_is_never_superseded(self) -> None:
        """An edge whose investigations ARE directly litho-tied (the engineer's
        own litho jump tie restated) is not a bridged jump tie — it stays even
        when a parallel chain connects the same bands."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        edges = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13"),
            # The engineer drew a litho tie S6↔S13 directly; this restates it.
            _edge(s6, s13, "S6", "S13"),
        ]
        direct = {_pair("S6", "B6"), _pair("B6", "S13"), _pair("S6", "S13")}

        assert superseded_jump_tie_ids(edges, direct) == []

    def test_jt8_pending_jump_ties_go_too(self) -> None:
        """ "Just delete all" — a still-pending jump proposal is as superseded
        as an accepted one once the chain is there."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13"),
        ]
        pending_jump = _edge(s6, s13, "S6", "S13", approved=False)
        direct = {_pair("S6", "B6"), _pair("B6", "S13")}

        superseded = superseded_jump_tie_ids([*chain, pending_jump], direct)

        assert superseded == [pending_jump.edge_id]
