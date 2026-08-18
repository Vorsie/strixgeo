"""Unit tests for the flanking-donor rule on borehole packing bands.

The owner's ruling (2026-08-04 dogfeed): *a borehole's packing bands must come
from the CPT to the right and to the left on the cross section* — not from a
body-wide surface blended out of every CPT in the body group.

Every case below is phrased in that sentence's vocabulary; none of them reaches
for an internal variable name.  If a comment here cites ``transition_surfaces``
or ``weights[0]``, the test is checking the implementation instead of the rule.

Cases
-----
F1  The borehole takes the CPT to its left and the CPT to its right — a third,
    further CPT on the same section does not get a vote.
F2  A lone flank donates alone.
F3  A borehole on no section falls back to the nearest test by map distance.
F4  When the two flanks describe different packing sequences, the nearer one
    speaks alone.
F5  A borehole drawn on several sections listens to the section whose flanking
    pair is tightest.
F6  A donor's stack is read in thickness-fraction space of its own litho extent
    and re-laid on the borehole's extent.
F7  A gap inside a donor's stack arrives as a gap, so the conservative fill can
    still cover it.
F8  A CPT further away in map distance but immediately beside the borehole on
    the section is preferred over a nearer one that is not a flank.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.borehole_flank_donors import (
    DonorBand,
    DonorStack,
    SectionPlacement,
    confidence_from_donor_distance,
    depth_aware_flanks,
    flank_packing_surfaces,
    flank_packing_surfaces_with_donors,
    select_flank_donors,
)

# Real NAD integers so a mis-wired lookup reads as a wrong class, not as a
# passing tautology. 5 = SAND loose, 6 = SAND moderate, 7 = SAND dense.
_LOOSE, _MODERATE, _DENSE = 5, 6, 7

_BH = "borehole-1"


def _stack(
    investigation_id: str,
    *,
    top: float,
    base: float,
    bands: list[tuple[float, float, int]],
    map_distance_m: float = 100.0,
    name: str | None = None,
) -> DonorStack:
    """Build a donor CPT's in-extent packing stack.

    Parameters
    ----------
    investigation_id : str
        The donor CPT's id.
    top : float
        Top of the donor's own litho extent (m below its collar).
    base : float
        Base of the donor's own litho extent (m below its collar).
    bands : list[tuple[float, float, int]]
        ``(top_m, base_m, nad_class)`` packing bands inside that extent.
    map_distance_m : float, optional
        Straight-line map distance from the borehole.
    name : str | None, optional
        Display name; defaults to ``investigation_id``.

    Returns
    -------
    DonorStack
        The donor stack the rule reads.
    """
    return DonorStack(
        investigation_id=investigation_id,
        name=name or investigation_id,
        extent_top_m=top,
        extent_base_m=base,
        bands=tuple(DonorBand(t, b, c) for t, b, c in bands),
        map_distance_m=map_distance_m,
    )


def test_f1_the_borehole_takes_the_cpt_to_its_left_and_to_its_right() -> None:
    """F1: the two flanking CPTs decide; a further one on the same line does not."""
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    right = _stack("R", top=0.0, base=10.0, bands=[(0.0, 6.0, _LOOSE), (6.0, 10.0, _DENSE)])
    # Same sequence, but its boundary sits far shallower — if it gets a vote the
    # borehole's boundary leaves the 4–6 m window its flanks bracket.
    far = _stack("FAR", top=0.0, base=10.0, bands=[(0.0, 0.5, _LOOSE), (0.5, 10.0, _DENSE)])
    section = SectionPlacement(
        section_id="s1",
        section_name="A-A'",
        along_m={_BH: 200.0, "L": 100.0, "R": 300.0, "FAR": 900.0},
    )

    selection = select_flank_donors(borehole_id=_BH, donors=[left, right, far], sections=[section])

    assert selection.mode == "flank_interpolated"
    assert [d.stack.investigation_id for d in selection.donors] == ["L", "R"]
    assert [d.side for d in selection.donors] == ["left", "right"]
    assert selection.section_name == "A-A'"

    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    boundary = surfaces[0][1]
    assert 4.0 < boundary < 6.0, (
        f"the boundary must sit between the two flanking CPTs' own boundaries, got {boundary}"
    )
    # Equidistant flanks → the halfway blend, untouched by the far CPT.
    assert boundary == pytest.approx(5.0)


def test_f2_a_lone_flank_donates_alone() -> None:
    """F2: with a CPT on one side only, that CPT's stack is what the borehole gets."""
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0}
    )

    selection = select_flank_donors(borehole_id=_BH, donors=[left], sections=[section])

    assert selection.mode == "single_donor"
    assert [d.side for d in selection.donors] == ["left"]

    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    assert surfaces == [(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)]


def test_f3_a_borehole_on_no_section_falls_back_to_the_nearest_test() -> None:
    """F3: off every section, the nearest test by map distance donates."""
    near = _stack(
        "NEAR",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)],
        map_distance_m=50.0,
    )
    far = _stack(
        "FAR",
        top=0.0,
        base=10.0,
        bands=[(0.0, 9.0, _LOOSE), (9.0, 10.0, _DENSE)],
        map_distance_m=400.0,
    )

    selection = select_flank_donors(borehole_id=_BH, donors=[far, near], sections=[])

    assert selection.mode == "nearest_fallback"
    assert [d.stack.investigation_id for d in selection.donors] == ["NEAR"]
    assert [d.side for d in selection.donors] == ["nearest"]
    assert selection.section_name is None

    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    assert surfaces == [(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)]


def test_f4_when_the_flanks_disagree_on_the_sequence_the_nearer_one_speaks_alone() -> None:
    """F4: mismatched packing sequences → the nearer flank's stack, verbatim.

    INTERPRETATION (owner veto pending): the rule the owner gave covers the case
    where both flanks tell the same story.  When they do not, this follows his
    earlier "nearest test that does have packing" ruling rather than inventing a
    correspondence between two different sequences.
    """
    # Left is nearer along the section (100 m away vs 300 m).
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    right = _stack(
        "R",
        top=0.0,
        base=10.0,
        bands=[(0.0, 3.0, _LOOSE), (3.0, 6.0, _MODERATE), (6.0, 10.0, _DENSE)],
    )
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0, "R": 500.0}
    )

    selection = select_flank_donors(borehole_id=_BH, donors=[left, right], sections=[section])

    assert selection.mode == "single_donor"
    assert [d.stack.investigation_id for d in selection.donors] == ["L"]

    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    assert [nc for _t, _b, nc in surfaces] == [_LOOSE, _DENSE]


def test_f5_the_section_with_the_tightest_flanking_pair_wins() -> None:
    """F5: on several sections, the one whose flanks hug the borehole decides.

    INTERPRETATION (owner veto pending): the owner did not say which section
    speaks when a borehole is drawn on two.  Tightest pair = least extrapolation.
    """
    tight_l = _stack("TL", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    tight_r = _stack("TR", top=0.0, base=10.0, bands=[(0.0, 6.0, _LOOSE), (6.0, 10.0, _DENSE)])
    wide_l = _stack("WL", top=0.0, base=10.0, bands=[(0.0, 1.0, _LOOSE), (1.0, 10.0, _DENSE)])
    wide_r = _stack("WR", top=0.0, base=10.0, bands=[(0.0, 9.0, _LOOSE), (9.0, 10.0, _DENSE)])

    tight = SectionPlacement(
        section_id="s-tight",
        section_name="Tight",
        along_m={_BH: 200.0, "TL": 190.0, "TR": 210.0},
    )
    wide = SectionPlacement(
        section_id="s-wide",
        section_name="Wide",
        along_m={_BH: 200.0, "WL": 0.0, "WR": 900.0},
    )

    selection = select_flank_donors(
        borehole_id=_BH,
        donors=[tight_l, tight_r, wide_l, wide_r],
        sections=[wide, tight],
    )

    assert selection.section_name == "Tight"
    assert [d.stack.investigation_id for d in selection.donors] == ["TL", "TR"]


def test_f11_the_section_the_engineer_is_editing_wins() -> None:
    """F11: owner ruling 2026-08-18 — *"the section you are editing wins"*.

    A scoped divide names the open section; the classes the borehole takes
    must come from the flanks the engineer is LOOKING at, even when another
    section holds a tighter pair — *"if the user edits TS11 he will notice
    and change it"*.  Tightest-pair (F5) stays the rule only when no section
    is being edited (the unscoped, all-sections press).
    """
    edit_l = _stack("EL", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    edit_r = _stack("ER", top=0.0, base=10.0, bands=[(0.0, 6.0, _LOOSE), (6.0, 10.0, _DENSE)])
    tight_l = _stack("TL", top=0.0, base=10.0, bands=[(0.0, 1.0, _LOOSE), (1.0, 10.0, _DENSE)])
    tight_r = _stack("TR", top=0.0, base=10.0, bands=[(0.0, 9.0, _LOOSE), (9.0, 10.0, _DENSE)])

    editing = SectionPlacement(
        section_id="s-editing",
        section_name="Editing",
        along_m={_BH: 200.0, "EL": 100.0, "ER": 300.0},
    )
    tight = SectionPlacement(
        section_id="s-tight",
        section_name="Tight",
        along_m={_BH: 200.0, "TL": 190.0, "TR": 210.0},
    )

    selection = select_flank_donors(
        borehole_id=_BH,
        donors=[edit_l, edit_r, tight_l, tight_r],
        sections=[tight, editing],
        preferred_section_id="s-editing",
    )

    assert selection.section_name == "Editing"
    assert [d.stack.investigation_id for d in selection.donors] == ["EL", "ER"]


def test_f12_a_preferred_section_that_does_not_draw_the_borehole_falls_back() -> None:
    """F12: the editing preference never invents flanks.

    When the open section does not place the borehole beside any donor, the
    normal ranking (F5) answers — the preference only reorders sections that
    can actually speak.
    """
    tight_l = _stack("TL", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    tight_r = _stack("TR", top=0.0, base=10.0, bands=[(0.0, 6.0, _LOOSE), (6.0, 10.0, _DENSE)])

    empty = SectionPlacement(
        section_id="s-empty",
        section_name="Empty",
        along_m={_BH: 200.0},
    )
    tight = SectionPlacement(
        section_id="s-tight",
        section_name="Tight",
        along_m={_BH: 200.0, "TL": 190.0, "TR": 210.0},
    )

    selection = select_flank_donors(
        borehole_id=_BH,
        donors=[tight_l, tight_r],
        sections=[empty, tight],
        preferred_section_id="s-empty",
    )

    assert selection.section_name == "Tight"
    assert [d.stack.investigation_id for d in selection.donors] == ["TL", "TR"]


def test_f6_a_donor_stack_is_re_laid_in_thickness_fraction_space() -> None:
    """F6: the donor's boundary keeps its position WITHIN the unit, not its depth."""
    # Boundary 4 m into a 10 m extent = 40 % down the unit.
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0}
    )
    selection = select_flank_donors(borehole_id=_BH, donors=[left], sections=[section])

    # The borehole's own extent is 5–15 m: 40 % down lands at 9 m, not at 4 m.
    surfaces = flank_packing_surfaces(selection, extent_top_m=5.0, extent_base_m=15.0)
    assert surfaces[0][0] == pytest.approx(5.0)
    assert surfaces[0][1] == pytest.approx(9.0)
    assert surfaces[-1][1] == pytest.approx(15.0)


def test_f7_a_gap_inside_the_donor_stack_arrives_as_a_gap() -> None:
    """F7: unclassified depth on the donor stays unclassified on the borehole."""
    # The donor reads packing over 0–2 m and 6–10 m; 2–6 m is unclassified.
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 2.0, _LOOSE), (6.0, 10.0, _DENSE)])
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0}
    )
    selection = select_flank_donors(borehole_id=_BH, donors=[left], sections=[section])

    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    assert surfaces == [(0.0, 2.0, _LOOSE), (6.0, 10.0, _DENSE)], (
        "the middle of the donor's extent carries no packing, so the borehole "
        "must be left uncovered there for the conservative fill to claim"
    )


def test_f8_being_beside_the_borehole_on_the_section_beats_being_near_on_the_map() -> None:
    """F8: the rule is about the section line, not about map proximity."""
    # 'BESIDE' is 400 m away on the map but is the immediate right-hand column;
    # 'OFFLINE' is 10 m away on the map but does not appear on this section.
    beside = _stack(
        "BESIDE",
        top=0.0,
        base=10.0,
        bands=[(0.0, 6.0, _LOOSE), (6.0, 10.0, _DENSE)],
        map_distance_m=400.0,
    )
    offline = _stack(
        "OFFLINE",
        top=0.0,
        base=10.0,
        bands=[(0.0, 1.0, _LOOSE), (1.0, 10.0, _DENSE)],
        map_distance_m=10.0,
    )
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "BESIDE": 260.0}
    )

    selection = select_flank_donors(borehole_id=_BH, donors=[beside, offline], sections=[section])

    assert selection.mode == "single_donor"
    assert [d.stack.investigation_id for d in selection.donors] == ["BESIDE"]


def test_f9_a_hairline_offset_on_the_donor_does_not_become_a_hairline_band() -> None:
    """F9: sub-millimetre slack at an extent edge is slack, not geology.

    The donor's first band starts a fraction of a micron below its extent top
    and its last ends the same distance above the base.  Re-laid on a borehole
    of a different thickness that becomes a sub-mm sliver at each end, and
    ``litho_layer`` stores intervals at mm grain — so a band would be written
    that renders as a zero-thickness line and reads as a packing change that
    never happened.
    """
    donor = _stack(
        "L",
        top=0.0,
        base=3.0,
        bands=[(1e-7, 1.5, _LOOSE), (1.5, 3.0 - 1e-7, _DENSE)],
    )
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0}
    )
    selection = select_flank_donors(borehole_id=_BH, donors=[donor], sections=[section])

    surfaces = flank_packing_surfaces(selection, extent_top_m=6.0, extent_base_m=8.43)

    assert [nc for _t, _b, nc in surfaces] == [_LOOSE, _DENSE]
    assert surfaces[0][0] == 6.0, "the first band must start at the extent top, not a hair below it"
    assert surfaces[-1][1] == 8.43, "the last band must reach the extent base"
    for top, base, nad_class in surfaces:
        assert base - top >= 0.001, (
            f"band {nad_class} is {base - top:.9f} m thick — below the mm grain it is stored at"
        )


def test_f10_a_vanishing_weight_is_a_single_donor_not_a_pretend_blend() -> None:
    """F10: a flank whose say rounds to nothing must not appear as a co-author.

    A 0.3 m flank against a 100 m flank gives the far one ~0.3 % of the blend —
    provenance reading "interpolated between A and B" would claim a two-CPT
    consensus that numerically does not exist. Below half a percent the near
    flank speaks alone and the mode says so.
    """
    near = _stack("NEAR", top=0.0, base=10.0, bands=[(0.0, 4.0, _LOOSE), (4.0, 10.0, _DENSE)])
    far = _stack("FAR", top=0.0, base=10.0, bands=[(0.0, 6.0, _LOOSE), (6.0, 10.0, _DENSE)])
    section = SectionPlacement(
        section_id="s1",
        section_name="A-A'",
        along_m={_BH: 100.0, "NEAR": 99.7, "FAR": 200.0},
    )

    selection = select_flank_donors(borehole_id=_BH, donors=[near, far], sections=[section])

    assert selection.mode == "single_donor"
    assert [d.stack.investigation_id for d in selection.donors] == ["NEAR"]
    assert selection.donors[0].weight == 1.0


class TestConfidenceFromDonorDistance:
    """DC — confidence follows the distance to the nearest donor (owner, F08).

    Ruling 2026-08-11, verbatim: *"map the confidence honestly, just take
    distance to nearest cpt as a measure for now"*. Every committed borehole
    band used to say ``high`` — tie-backed, lone flank 623 m out, or the
    map-distance last resort, all indistinguishable rows after commit.
    """

    def test_dc1_the_three_rungs(self) -> None:
        assert confidence_from_donor_distance(0.0) == "high"
        assert confidence_from_donor_distance(50.0) == "high"
        assert confidence_from_donor_distance(50.1) == "medium"
        assert confidence_from_donor_distance(200.0) == "medium"
        assert confidence_from_donor_distance(200.1) == "low"
        assert confidence_from_donor_distance(623.0) == "low"

    def test_dc2_no_donor_is_the_floor(self) -> None:
        # The conservative fallbacks (body_min / absolute_min) have no donor at
        # all; ``None`` must never read better than the farthest real one.
        assert confidence_from_donor_distance(None) == "low"


def _stack_with_ids(
    investigation_id: str,
    *,
    top: float,
    base: float,
    bands: list[tuple[float, float, int, str]],
) -> DonorStack:
    """Like ``_stack`` but each band carries the ``litho_layer`` id it came from."""
    return DonorStack(
        investigation_id=investigation_id,
        name=investigation_id,
        extent_top_m=top,
        extent_base_m=base,
        bands=tuple(DonorBand(t, b, c, lid) for t, b, c, lid in bands),
        map_distance_m=100.0,
    )


def test_fd1_a_blended_surface_names_the_donor_band_on_each_flank() -> None:
    """Owner, 2026-08-15: *"take the litho and check if new subdivisions are
    there, then take top as 0 an bottom as 1 and rescale them on a borehole"*.

    The rescale ALREADY pairs band i on the left with band i on the right — the
    zip in ``flank_packing_surfaces`` is exactly that correspondence. What was
    missing is that the surface it produces did not say which two donor bands
    it stands between, so "Divide boreholes" had to guess the pairing back with
    a per-gap alignment, and the left gap and the right gap guessed differently.
    Carrying the ids makes the borehole chain complete by construction.
    """
    left = _stack_with_ids(
        "L",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE, "L-loose"), (4.0, 10.0, _DENSE, "L-dense")],
    )
    right = _stack_with_ids(
        "R",
        top=0.0,
        base=10.0,
        bands=[(0.0, 6.0, _LOOSE, "R-loose"), (6.0, 10.0, _DENSE, "R-dense")],
    )
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0, "R": 300.0}
    )
    selection = select_flank_donors(borehole_id=_BH, donors=[left, right], sections=[section])

    surfaces = flank_packing_surfaces_with_donors(selection, extent_top_m=0.0, extent_base_m=10.0)

    assert [s.donor_layer_ids for s in surfaces] == [
        ("L-loose", "R-loose"),
        ("L-dense", "R-dense"),
    ], "each blended band stands between the two flank bands it was blended from"
    assert surfaces[0].base == pytest.approx(5.0)


def test_fd2_a_single_donor_surface_names_its_one_band() -> None:
    """One flank donates alone, so the correspondence is one-sided — the hop it
    licenses is borehole↔that CPT and nothing else."""
    left = _stack_with_ids(
        "L",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE, "L-loose"), (4.0, 10.0, _DENSE, "L-dense")],
    )
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0}
    )
    selection = select_flank_donors(borehole_id=_BH, donors=[left], sections=[section])

    surfaces = flank_packing_surfaces_with_donors(selection, extent_top_m=0.0, extent_base_m=10.0)

    assert [s.donor_layer_ids for s in surfaces] == [("L-loose",), ("L-dense",)]


def test_fd3_the_tuple_form_is_a_projection_of_the_donor_form() -> None:
    """The old three-tuple caller must see byte-identical output — every other
    test in this file is the regression net for the geometry, and it stays
    valid only while the two functions cannot drift."""
    left = _stack_with_ids(
        "L",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE, "L-loose"), (4.0, 10.0, _DENSE, "L-dense")],
    )
    right = _stack_with_ids(
        "R",
        top=0.0,
        base=10.0,
        bands=[(0.0, 6.0, _LOOSE, "R-loose"), (6.0, 10.0, _DENSE, "R-dense")],
    )
    section = SectionPlacement(
        section_id="s1", section_name="A-A'", along_m={_BH: 200.0, "L": 100.0, "R": 300.0}
    )
    selection = select_flank_donors(borehole_id=_BH, donors=[left, right], sections=[section])

    tuples = flank_packing_surfaces(selection, extent_top_m=1.0, extent_base_m=9.0)
    rich = flank_packing_surfaces_with_donors(selection, extent_top_m=1.0, extent_base_m=9.0)

    assert tuples == [(s.top, s.base, s.nad_class) for s in rich]


# --- depth-aware flank walk (owner ruling 2026-08-18, the B2 dogfeed) --------
#
# His words: "If there are no cpt data below TD, then you look to the next cpt
# over ofcourse. Close cpt where there is data, further away below TD."
# B2's right-hand neighbour S7A is a short CPT whose bands end far above B2's
# sand, so the walk stepped nowhere and B2's 8.7 m sand came back as ONE band
# from the left donor alone.


def test_fw1_the_close_cpt_with_data_is_the_flank() -> None:
    """FW1: 'close cpt where there is data' — the walk stops at it; the
    farther CPT never enters."""
    flanks = depth_aware_flanks(
        "BH",
        ordered_columns=["NEAR-L", "BH", "NEAR-R", "FAR-R"],
        kind_of={"NEAR-L": "cpt", "BH": "borehole", "NEAR-R": "cpt", "FAR-R": "cpt"},
        banded_extent_by_inv={
            "NEAR-L": (5.0, -5.0),
            "NEAR-R": (5.0, -5.0),
            "FAR-R": (5.0, -5.0),
        },
        window_top_elev_m=4.0,
        window_base_elev_m=-4.0,
        min_data_m=0.35,
    )

    assert flanks == {"NEAR-L", "NEAR-R"}


def test_fw2_a_cpt_silent_at_this_depth_is_stepped_over() -> None:
    """FW2: B2 in miniature — 'no cpt data below TD → the next cpt over'. The
    near-right CPT's bands end at +10.4 while the window is +4.25 to −4.45, so
    the walk continues to the CPT that HAS data there. The next CPT over grazes
    the window by 5 cm — less than one writable band — and is silent too."""
    flanks = depth_aware_flanks(
        "B2",
        ordered_columns=["S10", "B2", "S7A", "S7", "S6"],
        kind_of={"S10": "cpt", "B2": "borehole", "S7A": "cpt", "S7": "cpt", "S6": "cpt"},
        banded_extent_by_inv={
            "S10": (11.4, -3.2),
            "S7A": (11.5, 10.4),
            "S7": (11.9, 4.2),
            "S6": (10.7, -3.3),
        },
        window_top_elev_m=4.25,
        window_base_elev_m=-4.45,
        min_data_m=0.35,
    )

    assert flanks == {"S10", "S6"}


def test_fw3_a_cpt_that_disagrees_still_blocks_the_walk() -> None:
    """FW3: data that DISAGREES is still data. A CPT whose bands cover the
    window blocks the walk even if none of them are the layer's soil — the
    soil gate downstream may refuse it as donor, but walking past it would
    fake continuity through ground the CPT says is something else."""
    flanks = depth_aware_flanks(
        "BH",
        ordered_columns=["L", "BH", "CLAY-R", "SAND-R"],
        kind_of={"L": "cpt", "BH": "borehole", "CLAY-R": "cpt", "SAND-R": "cpt"},
        banded_extent_by_inv={
            "L": (5.0, -5.0),
            "CLAY-R": (5.0, -5.0),
            "SAND-R": (5.0, -5.0),
        },
        window_top_elev_m=4.0,
        window_base_elev_m=-4.0,
        min_data_m=0.35,
    )

    assert flanks == {"L", "CLAY-R"}


def test_fw4_boreholes_are_stepped_over() -> None:
    """FW4: a borehole has no qc and cannot donate, so the walk passes it
    (pre-existing rule, kept)."""
    flanks = depth_aware_flanks(
        "BH",
        ordered_columns=["CPT-L", "OTHER-BH", "BH"],
        kind_of={"CPT-L": "cpt", "OTHER-BH": "borehole", "BH": "borehole"},
        banded_extent_by_inv={"CPT-L": (5.0, -5.0)},
        window_top_elev_m=4.0,
        window_base_elev_m=-4.0,
        min_data_m=0.35,
    )

    assert flanks == {"CPT-L"}


def test_fw5_a_grazing_extent_does_not_count_as_data() -> None:
    """FW5: bands that END at the window's top never enter it — that column is
    below-TD for this layer and the walk continues."""
    flanks = depth_aware_flanks(
        "BH",
        ordered_columns=["BH", "GRAZE-R", "DEEP-R"],
        kind_of={"BH": "borehole", "GRAZE-R": "cpt", "DEEP-R": "cpt"},
        banded_extent_by_inv={"GRAZE-R": (10.0, 4.0), "DEEP-R": (10.0, -5.0)},
        window_top_elev_m=4.0,
        window_base_elev_m=-4.0,
        min_data_m=0.35,
    )

    assert flanks == {"DEEP-R"}
