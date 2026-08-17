"""Who may donate packing to a borehole unit.

Owner, 2026-08-16, on B4's top sand reading loose: *"777m is too far anyhow,
in this case, the sand is connected to 2 md sands, just make it md"*.

Two rules, from that one sentence.  A column the engineer's own litho
correlation names is a donor whatever geological band it sits in — the tie
IS the statement that these are the same sheet.  And a column three-quarters
of a kilometre away is not evidence about this borehole at all.

His scene: B4's sand at 6.00-8.43 m is tied by hand to S13's at 9.69-15.16 m
and B6's at 9.50-12.59 m, both medium dense.  The planner grouped donors by
(body, geological band), which put S13 in a different group, found one
candidate 777 m away, and copied its loose sand onto the borehole.
"""

from uuid import UUID

from groundmodel.application.divide_boreholes import correlated_donor_picks
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

B4_UPPER_SAND = UUID("00000000-0000-0000-0000-0000000000b4")
B4_LOWER_SAND = UUID("00000000-0000-0000-0000-0000000000b5")
S13_SAND = UUID("00000000-0000-0000-0000-000000000013")
B6_SAND = UUID("00000000-0000-0000-0000-000000000006")


def _pick(inv: str, top: float, base: float) -> BodyLayerPick:
    """One column's litho member-layer, as the planner sees it."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=13.0,
        body_id="sand-body",
        formation_id="zand",
        top_depth_m=top,
        base_depth_m=base,
        kind="cpt",
    )


BOREHOLE_LAYERS = [
    (B4_UPPER_SAND, 6.00, 8.43),
    (B4_LOWER_SAND, 9.07, 12.52),
]
# Geological bounding cuts a layer into several picks; S13's is cut in two.
PICKS_BY_LAYER = {
    S13_SAND: [_pick("S13", 9.69, 13.56), _pick("S13", 13.56, 15.16)],
    B6_SAND: [_pick("B6", 9.50, 12.59)],
}


def test_cd1_a_hand_drawn_litho_tie_names_the_donor() -> None:
    """B4's 6.00-8.43 sand borrows from the columns he tied it to.

    Neither is in its (body, geological band) group; the tie outranks the
    grouping, which is what he means by "the sand is connected to 2 md sands".
    """
    picks = correlated_donor_picks(
        unit_top_m=6.00,
        unit_base_m=8.43,
        borehole_layers=BOREHOLE_LAYERS,
        partners_by_layer={B4_UPPER_SAND: frozenset({S13_SAND, B6_SAND})},
        picks_by_layer=PICKS_BY_LAYER,
    )
    assert {p.investigation_id for p in picks} == {"S13", "B6"}


def test_cd2_a_geo_bounded_slice_still_finds_its_layer_s_partners() -> None:
    """A geological contact cuts a litho layer into several planning units.

    9.07-9.50 is a 0.43 m slice of the 9.07-12.52 layer; it inherits that
    layer's correlations rather than losing them to the cut.
    """
    picks = correlated_donor_picks(
        unit_top_m=9.07,
        unit_base_m=9.50,
        borehole_layers=BOREHOLE_LAYERS,
        partners_by_layer={B4_LOWER_SAND: frozenset({S13_SAND})},
        picks_by_layer=PICKS_BY_LAYER,
    )
    assert [p.investigation_id for p in picks] == ["S13", "S13"]


def test_cd3_an_uncorrelated_unit_gets_nothing() -> None:
    """No tie, no claim — the ordinary donor search still answers."""
    assert (
        correlated_donor_picks(
            unit_top_m=9.07,
            unit_base_m=12.52,
            borehole_layers=BOREHOLE_LAYERS,
            partners_by_layer={B4_UPPER_SAND: frozenset({S13_SAND})},
            picks_by_layer=PICKS_BY_LAYER,
        )
        == []
    )


def test_cd4_a_partner_with_no_pick_is_skipped() -> None:
    """A correlated layer outside every body group cannot donate a stack."""
    assert (
        correlated_donor_picks(
            unit_top_m=6.00,
            unit_base_m=8.43,
            borehole_layers=BOREHOLE_LAYERS,
            partners_by_layer={B4_UPPER_SAND: frozenset({UUID(int=999)})},
            picks_by_layer=PICKS_BY_LAYER,
        )
        == []
    )


# CD5/CD6 pinned the 500 m reach cap, deleted 2026-08-17: *"donor reach is
# obsolete, only left and right test on section can be donor"*.  Adjacency is
# the gate now and it lives in ``layer_donor_picks`` — see LD3 there.
