"""A litho layer names its own donors.

The restructure of 2026-08-16.  Donor candidates used to be the CPTs in the
borehole's ``(body, geological band)`` group, which is the wrong unit: a
geological contact can put the two ends of one hand-drawn correlation in
different groups, and can leave a group with no column near enough to say
anything.  Both bit the owner on B4 in one afternoon.

The layer names them instead — the columns its correlations point at, else
the columns sharing its body — under THREE hard constraints.  A donor must be
the SAME LITHO UNIT — the same ``source_litho_formation_id`` (soil AND
admixtures), not merely the same soil (owner ruling 2026-09-14, borehole
GEO-07/182-B2: *"i redivided B2 but there is still a dense sand, while there is
no dense sand in that litho unit on each adjacent test"*).  A donor must FLANK
the borehole on a section — *"only left and right test on section can be
donor"*, reaffirmed the night B4's sand borrowed from a test 623 m away.  And
within those, elevation picks the sheet.
"""

from groundmodel.application.divide_boreholes import layer_donor_picks
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

# The receiver is a clean ``ZAND`` unit; the donor gate is the litho FORMATION.
SAND = "zand-formation"
SILT = "silt-formation"
# A DIFFERENT litho unit of the same soil — the glauconitic ``ZAND (GL:|KL:)``
# that the resolver welds into the same sand body.  Its class is never lent to
# the clean sand (owner 2026-09-14).
SAND_GLAUCONITIC = "zand-glauconitic-formation"


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
    """Investigation ids of the chosen donors, for a clean sand layer at 9.07-12.52 m."""
    return [
        pick.investigation_id
        for pick in layer_donor_picks(
            correlated,
            body,
            receiver_formation_id=SAND,
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
        receiver_formation_id=SAND,
        layer_top_elev_m=13.0 - 9.07,
        layer_base_elev_m=13.0 - 12.52,
        flanking_investigations=FLANKS,
    )
    assert picks == [above_lens]


def test_ld8_a_neighbouring_unit_of_the_same_soil_does_not_donate() -> None:
    """RETARGETED 2026-09-14 (was "a different formation of the same soil still
    donates").  The owner's B2: *"there is no dense sand in that litho unit on
    each adjacent test"*.  A DIFFERENT litho unit of the same soil — the
    glauconitic ``ZAND (GL:|KL:)`` welded into the same sand body — is not the
    receiver's unit, so its class is never lent, whatever the body welding says.
    The receiver then falls to the conservative floor rather than borrowing the
    neighbour's dense sand.

    Litho formations are find-or-created per ``(soil, admixtures)``, so the same
    clean sand shares ONE formation across columns (``test_ld2`` /
    ``test_ld7``); a different formation of the same soil is a genuinely
    different unit, which is exactly the case this refuses.
    """
    assert _donors([], [_pick("S6", 10.26, 12.42, formation=SAND_GLAUCONITIC)]) == []


def test_ld7_a_flank_donates_however_far_along_the_section_it_sits() -> None:
    """Nothing stands between a flank and the borehole, so distance is not a gate."""
    assert _donors([], [_pick("NOWHERE", 10.26, 12.42)]) == ["NOWHERE"]


# ---------------------------------------------------------------------------
# Owner ruling 2026-09-14 (borehole GEO-07/182-B2): a borehole band is lent
# ONLY from the same litho unit on the adjacent tests.  A neighbouring unit's
# class is never lent, whatever the body welding says.
# ---------------------------------------------------------------------------


def _picks(body: list[BodyLayerPick], *, top_elev: float, base_elev: float) -> list[BodyLayerPick]:
    """The chosen donor picks for a clean-sand receiver between the given elevations."""
    return layer_donor_picks(
        [],
        body,
        receiver_formation_id=SAND,
        layer_top_elev_m=top_elev,
        layer_base_elev_m=base_elev,
        flanking_investigations=FLANKS,
    )


def test_a_borehole_band_is_lent_only_from_the_same_litho_unit_on_the_adjacent_tests() -> None:
    """The B2 shape, both flanks: *"there is no dense sand in that litho unit on
    each adjacent test"*.

    On each flank the clean ``ZAND`` sits above the glauconitic
    ``ZAND (GL:|KL:)`` welded into the same sand body; the borehole's own clean
    sand reaches DEEPER than the flank clean sand, so the glauconitic pick
    overlaps the receiver's extent more.  The old soil test picked the
    glauconitic band (and lent its dense class); only the clean unit may
    donate, so BOTH flanks contribute their clean sand and neither lends the
    glauconitic band.

    Elevations mirror B2 on S2: clean sand -3.33..-4.17, glauconitic sand
    -4.17..-11.83; the receiver clean sand runs -3.52..-5.52, so the glauconitic
    pick overlaps 1.35 m and the clean pick only 0.65 m.
    """
    left_clean = _pick("S13", 10.86, 11.70, formation=SAND, surface=7.53)
    left_glauc = _pick("S13", 11.70, 19.36, formation=SAND_GLAUCONITIC, surface=7.53)
    right_clean = _pick("S6", 10.86, 11.70, formation=SAND, surface=7.53)
    right_glauc = _pick("S6", 11.70, 19.36, formation=SAND_GLAUCONITIC, surface=7.53)

    chosen = _picks(
        [left_clean, left_glauc, right_clean, right_glauc],
        top_elev=-3.52,
        base_elev=-5.52,
    )

    assert {p.formation_id for p in chosen} == {SAND}, (
        "a neighbouring glauconitic unit was lent to the clean sand: "
        f"{[(p.investigation_id, p.formation_id) for p in chosen]}"
    )
    assert {p.investigation_id for p in chosen} == {"S13", "S6"}


def test_a_neighbouring_units_class_is_never_lent_whatever_the_body_welding_says() -> None:
    """The neighbour overlaps MORE, yet is refused — the body weld gives no licence.

    A single flank carrying both units: the glauconitic pick overlaps the
    receiver's extent more than the clean pick, so before the unit gate it won
    ``flank_pick_for_unit`` and its dense class was laid onto the clean sand.
    """
    clean = _pick("S6", 10.86, 11.70, formation=SAND, surface=7.53)
    glauconitic = _pick("S6", 11.70, 19.36, formation=SAND_GLAUCONITIC, surface=7.53)

    chosen = _picks([clean, glauconitic], top_elev=-3.52, base_elev=-5.52)

    assert [p.formation_id for p in chosen] == [SAND]


def test_the_same_unit_donates_even_where_it_sits_at_a_different_elevation() -> None:
    """*"Take the same unit's nearest band in elevation on that flank."*

    The flank's clean sand overlaps the receiver only partly (it sits higher),
    but it is the receiver's own unit, so it still donates — the fraction
    rescale then lays its packing across the receiver's extent.
    """
    higher_clean = _pick("S6", 9.00, 10.00, formation=SAND, surface=13.0)  # elev 4.0..3.0

    chosen = _picks([higher_clean], top_elev=13.0 - 9.07, base_elev=13.0 - 12.52)

    assert [p.investigation_id for p in chosen] == ["S6"]


def test_when_neither_flank_carries_that_unit_the_receiver_falls_to_the_floor() -> None:
    """*"When a flank has no band of that unit at all, that flank contributes
    nothing; when neither flank contributes, the floor."*

    Both flanks carry only the glauconitic unit here, so no donor is selected;
    ``layer_donor_picks`` returns nothing and the planner falls back to
    ``apply_column_floor`` (the loosest class the column measured for the
    receiver's own unit, §8-0b).
    """
    left_glauc = _pick("S13", 11.70, 19.36, formation=SAND_GLAUCONITIC)
    right_glauc = _pick("S6", 11.70, 19.36, formation=SAND_GLAUCONITIC)

    assert _picks([left_glauc, right_glauc], top_elev=-3.52, base_elev=-5.52) == []
