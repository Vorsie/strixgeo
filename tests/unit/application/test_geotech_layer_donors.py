"""A litho layer names its own donors.

The restructure of 2026-08-16.  Donor candidates used to be the CPTs in the
borehole's ``(body, geological band)`` group, which is the wrong unit: a
geological contact can put the two ends of one hand-drawn correlation in
different groups, and can leave a group with no column near enough to say
anything.  Both bit the owner on B4 in one afternoon.

The layer names them instead — the columns its correlations point at, else
the columns sharing its body — under THREE hard constraints.  A donor must be
the SAME SOIL, because a packing class belongs to a soil column and his litho
ties may legitimately cross facies.  A donor must FLANK the borehole on a
section — *"only left and right test on section can be donor"*, reaffirmed the
night B4's sand borrowed from a test 623 m away.  And within those, elevation
picks the sheet.
"""

from groundmodel.application.divide_boreholes import layer_donor_picks
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

SAND = "zand-formation"
SILT = "silt-formation"
# Two formation rows may carry the same soil; the rule compares SOIL.
SAND_ELSEWHERE = "zand-formation-other-column"
SOIL = {SAND: "ZAND", SAND_ELSEWHERE: "ZAND", SILT: "SILT"}


def _pick(
    inv: str, top: float, base: float, formation: str = SAND, surface: float = 13.0
) -> BodyLayerPick:
    """One column's litho layer."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=surface,
        body_id="body",
        formation_id=formation,
        top_depth_m=top,
        base_depth_m=base,
        kind="cpt",
    )


# Owner ruling 2026-08-17: the flanking tests on the section, and only those.
FLANKS = {"S13", "S6", "SILTY", "NOWHERE"}


def _donors(correlated: list[BodyLayerPick], body: list[BodyLayerPick]) -> list[str]:
    """Investigation ids of the chosen donors, for a sand layer at 9.07-12.52 m."""
    return [
        pick.investigation_id
        for pick in layer_donor_picks(
            correlated,
            body,
            own_soil_code="ZAND",
            soil_by_formation=SOIL,
            layer_top_elev_m=13.0 - 9.07,
            layer_base_elev_m=13.0 - 12.52,
            flanking_investigations=FLANKS,
        )
    ]


def test_ld1_a_correlated_flank_donates_whatever_the_grouping_said() -> None:
    """His tie names the sheet; the geological banding does not get a veto."""
    assert _donors([_pick("S13", 9.69, 15.16)], []) == ["S13"]


def test_ld2_the_body_answers_where_he_drew_no_tie() -> None:
    """No correlation, so the same body's nearby columns are the evidence."""
    assert _donors([], [_pick("S6", 10.26, 12.42)]) == ["S6"]


def test_ld3_a_non_flank_is_refused_even_when_it_carries_the_soil() -> None:
    """Owner, twice: *"donor reach is obsolete, only left and right test on
    section can be donor"* (2026-08-17 midday) and — after I kept the wider
    pool because filtering measured as starving the model — *"the fallback
    stopped working, the sand on B4 has no neighbours so it should default to
    the lowest packing class on B4"* (2026-08-17 night, when B4's sand took
    its packing from a test 623 m away).

    The starvation trade-off was HIS to make, not mine, and he made it: an
    honest conservative floor beats a confident answer from a test that is
    nowhere near.  S11 carries the sand but does not flank the borehole — no
    donation.
    """
    assert _donors([], [_pick("S11", 10.26, 12.42)]) == []


def test_ld9_a_correlated_non_flank_is_refused_too() -> None:
    """The B4 case verbatim: a litho tie pointed 623 m away, and the tie was
    treated as a licence past the flank rule.  It is not — the tie stays a
    correlation, the donor pool stays the flanks."""
    assert _donors([_pick("FARAWAY", 9.0, 12.5)], []) == []


def test_ld4_a_donor_of_another_soil_is_refused() -> None:
    """A cross-facies litho tie must not put a SILT class inside a ZAND unit.

    The regression this caught for real: B6's sand layer took NAD 15 off a
    silt column his litho tie legitimately pointed at.
    """
    assert _donors([_pick("SILTY", 9.0, 12.0, formation=SILT)], []) == []


def test_ld5_a_correlated_column_is_not_also_offered_by_the_body() -> None:
    """The tie already said WHICH of that column's layers this one continues."""
    tied = _pick("S13", 9.69, 15.16)
    other_layer_same_column = _pick("S13", 30.0, 35.0)
    assert _donors([tied], [other_layer_same_column]) == ["S13"]


def test_ld6_one_layer_per_column_chosen_by_elevation() -> None:
    """A body split by an enclosed lens owns several layers on one column."""
    above_lens = _pick("S6", 10.26, 12.42)
    below_lens = _pick("S6", 13.00, 15.48)
    assert _donors([], [below_lens, above_lens]) == ["S6"]
    picks = layer_donor_picks(
        [],
        [below_lens, above_lens],
        own_soil_code="ZAND",
        soil_by_formation=SOIL,
        layer_top_elev_m=13.0 - 9.07,
        layer_base_elev_m=13.0 - 12.52,
        flanking_investigations=FLANKS,
    )
    assert picks == [above_lens]


def test_ld8_a_different_formation_of_the_same_soil_still_donates() -> None:
    """Formation identity is not the test; soil is.

    Two columns can carry different formation rows for the same sand, and
    refusing those would strand a borehole with no donor at all.
    """
    assert _donors([], [_pick("S6", 10.26, 12.42, formation=SAND_ELSEWHERE)]) == ["S6"]


def test_ld7_a_flank_donates_however_far_along_the_section_it_sits() -> None:
    """Nothing stands between a flank and the borehole, so distance is not a gate."""
    assert _donors([], [_pick("NOWHERE", 10.26, 12.42)]) == ["NOWHERE"]
