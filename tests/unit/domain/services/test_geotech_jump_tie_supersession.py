"""Owner ruling — jump ties are REPLACED by the mediated chain.

The rule, in the owner's words (2026-08-14): *"those cpt to cpt ties should be
replaced by cpt to borehole to borehole to cpt ties once i click subdivide
boreholes"* and, on whether hand-drawn ones are spared: *"just delete all,
it'll be a real bother to delete all by hand once the proper chain is there"*.

Refined 2026-08-15, after the first dogfeed of the rule: *"clicked divide
boreholes, the ties that jump over boreholes still stay and the chain isn't
made from cpt to borehole to borehole to cpt"*.  The first implementation
keyed supersession on PROVENANCE — an edge whose two investigations carried a
direct litho tie was read as a restatement and spared.  On his model that
spared 93 of 103, because correlating CPT→CPT **across** the boreholes at the
litho stage is his normal way of working: the tie he wants replaced is exactly
the one the provenance carve-out protected.

So supersession now keys on the GEOMETRY: a tie is superseded when the
accepted ties INSIDE its own along-section span already connect its two
endpoint bands, which means the connection runs through at least one
intervening column.  Hand-drawn or machine, restatement or not — this module
is not told which, and that is the point.
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


# CPT — borehole — borehole — CPT, in the order the section draws them.
_ALONG = {"S6": 0.0, "B6": 100.0, "B4": 200.0, "S13": 300.0}


class TestJumpTieSupersession:
    """The replace-the-jump-tie ruling, case by case."""

    def test_jt1_the_proper_chain_replaces_the_jump_tie(self) -> None:
        """The full accepted CPT↔BH↔BH↔CPT chain is there → the jump tie goes."""
        s6, b6, b4, s13 = uuid4(), uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, b4, "B6", "B4"),
            _edge(b4, s13, "B4", "S13"),
        ]
        jump = _edge(s6, s13, "S6", "S13")

        superseded = superseded_jump_tie_ids([*chain, jump], _ALONG)

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

        assert superseded_jump_tie_ids([*partial_chain, jump], _ALONG) == []

    def test_jt3_a_pending_chain_hop_keeps_the_jump_tie(self) -> None:
        """The chain does not carry approval until every hop is accepted."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13", approved=False),
        ]
        jump = _edge(s6, s13, "S6", "S13")

        assert superseded_jump_tie_ids([*chain, jump], _ALONG) == []

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

        assert superseded_jump_tie_ids([*top_chain, deep_jump], _ALONG) == []

    def test_jt6_a_second_tie_on_the_same_column_pair_is_not_a_chain(self) -> None:
        """ "the chain isn't made from cpt to borehole to borehole to cpt" — a
        path that never leaves the two columns passes through no intervening
        column, so it replaces nothing however many ties it strings together."""
        s6_top, s13_top = uuid4(), uuid4()
        s6_deep, s13_deep = uuid4(), uuid4()
        # Three accepted S6↔S13 ties string the candidate's two bands together
        # by transitivity (s6_top → s13_deep → s6_deep → s13_top), but every
        # hop still flies straight over B6 and B4.
        candidate = _edge(s6_top, s13_top, "S6", "S13")
        same_pair = [
            _edge(s6_top, s13_deep, "S6", "S13"),
            _edge(s6_deep, s13_deep, "S6", "S13"),
            _edge(s6_deep, s13_top, "S6", "S13"),
        ]

        assert superseded_jump_tie_ids([candidate, *same_pair], _ALONG) == []

    def test_jt6b_a_detour_outside_the_span_is_not_the_chain(self) -> None:
        """The replacement must run BETWEEN the two columns.  A path that steps
        off to a column the tie never flew over is a correlation to somewhere
        else, not "cpt to borehole to borehole to cpt"."""
        # S6 —— B6 —— S13 with an off-span column OUT to the left of S6.
        along = {"OUT": -40.0, "S6": 0.0, "B6": 50.0, "S13": 100.0}
        s6, out, b6, s13 = uuid4(), uuid4(), uuid4(), uuid4()
        # Every hop is shorter than the 100 m jump, so only the span rule can
        # refuse this path — and it must, because OUT is not between S6 and S13.
        detour = [
            _edge(s6, out, "S6", "OUT"),  # 40 m
            _edge(out, b6, "OUT", "B6"),  # 90 m
            _edge(b6, s13, "B6", "S13"),  # 50 m
        ]
        jump = _edge(s6, s13, "S6", "S13")

        assert jump.edge_id not in superseded_jump_tie_ids([*detour, jump], along)

    def test_jt7_a_restatement_of_a_direct_litho_tie_is_superseded_too(self) -> None:
        """THE 2026-08-15 CHANGE.  The owner correlates CPT→CPT across the
        boreholes at the litho stage, so the tie he wants replaced is a
        restatement of a direct litho tie.  "just delete all" — provenance is
        not an input to this judgment at all, so the chain deletes it exactly
        like any other jump tie."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13"),
        ]
        # The engineer drew a litho tie S6↔S13 directly; this restates it.
        restatement = _edge(s6, s13, "S6", "S13")

        superseded = superseded_jump_tie_ids([*chain, restatement], _ALONG)

        assert superseded == [restatement.edge_id]

    def test_jt8_pending_jump_ties_go_too(self) -> None:
        """ "Just delete all" — a still-pending jump proposal is as superseded
        as an accepted one once the chain is there."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13"),
        ]
        pending_jump = _edge(s6, s13, "S6", "S13", approved=False)

        superseded = superseded_jump_tie_ids([*chain, pending_jump], _ALONG)

        assert superseded == [pending_jump.edge_id]

    def test_jt9_neighbouring_columns_are_never_superseded(self) -> None:
        """Nothing stands between two adjacent columns, so their tie jumps
        nothing and no chain can replace it — the hop IS the chain."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        edges = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13"),
            _edge(s6, s13, "S6", "S13"),
        ]

        superseded = superseded_jump_tie_ids(edges, {"S6": 0.0, "B6": 100.0, "S13": 200.0})

        # Only the S6↔S13 span carries an intervening column; the two hops stay.
        assert superseded == [edges[2].edge_id]

    def test_jt10_a_column_the_section_does_not_draw_is_never_judged(self) -> None:
        """An endpoint with no along-position is not on this section, so its
        span is unknown — nothing is deleted on a guess."""
        s6, b6, ghost = uuid4(), uuid4(), uuid4()
        edges = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, ghost, "B6", "OFF-SECTION"),
            _edge(s6, ghost, "S6", "OFF-SECTION"),
        ]

        assert superseded_jump_tie_ids(edges, _ALONG) == []

    def test_jt11_the_deleted_ids_come_back_in_input_order(self) -> None:
        """The caller logs each doomed edge by name, so the order must be the
        one it handed in — not a set's."""
        s6, b6, s13 = uuid4(), uuid4(), uuid4()
        s6_deep, s13_deep = uuid4(), uuid4()
        first_jump = _edge(s6, s13, "S6", "S13")
        chain = [
            _edge(s6, b6, "S6", "B6"),
            _edge(b6, s13, "B6", "S13"),
            _edge(s6_deep, b6, "S6", "B6"),
            _edge(b6, s13_deep, "B6", "S13"),
        ]
        second_jump = _edge(s6_deep, s13_deep, "S6", "S13")

        superseded = superseded_jump_tie_ids([first_jump, *chain, second_jump], _ALONG)

        assert superseded == [first_jump.edge_id, second_jump.edge_id]
