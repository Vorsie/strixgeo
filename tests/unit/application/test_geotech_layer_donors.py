"""A litho layer names its own donors.

The restructure of 2026-08-16.  Donor candidates used to be the CPTs in the
borehole's ``(body, geological band)`` group, which is the wrong unit: a
geological contact can put the two ends of one hand-drawn correlation in
different groups, and can leave a group with no column near enough to say
anything.  Both bit the owner on B4 in one afternoon.

The layer names them instead — the columns its correlations point at, else
the columns sharing its body — under two hard constraints.  A donor must be
the SAME SOIL, because a packing class belongs to a soil column and his litho
ties may legitimately cross facies.  And a donor must be close enough to be
evidence: *"777m is too far anyhow"*.
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


NEAR = {"S13": 90.0, "S6": 5.0, "S11": 777.0, "SILTY": 20.0}


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
            map_distance_m=NEAR,
        )
    ]


def test_ld1_a_correlated_column_donates_however_far_the_grouping_put_it() -> None:
    """His tie names the sheet; the geological banding does not get a veto."""
    assert _donors([_pick("S13", 9.69, 15.16)], []) == ["S13"]


def test_ld2_the_body_answers_where_he_drew_no_tie() -> None:
    """No correlation, so the same body's nearby columns are the evidence."""
    assert _donors([], [_pick("S6", 10.26, 12.42)]) == ["S6"]


def test_ld3_a_column_too_far_away_is_not_evidence() -> None:
    """ "777m is too far anyhow" — S11 never becomes a candidate."""
    assert _donors([], [_pick("S11", 10.0, 12.0)]) == []


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
        map_distance_m=NEAR,
    )
    assert picks == [above_lens]


def test_ld8_a_different_formation_of_the_same_soil_still_donates() -> None:
    """Formation identity is not the test; soil is.

    Two columns can carry different formation rows for the same sand, and
    refusing those would strand a borehole with no donor at all.
    """
    assert _donors([], [_pick("S6", 10.26, 12.42, formation=SAND_ELSEWHERE)]) == ["S6"]


def test_ld7_a_column_with_no_known_distance_is_skipped() -> None:
    """Distance unknowable means the reach rule cannot be applied honestly."""
    assert _donors([], [_pick("NOWHERE", 10.0, 12.0)]) == []
