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
    flank_packing_surfaces,
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
