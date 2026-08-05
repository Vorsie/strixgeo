"""Unit tests for the tie-informed donor rule on borehole packing bands.

Owner ruling (2026-08-04 late evening), in his words:

    when an accepted tie's span crosses the borehole's column on a section and
    both tie endpoints are CPTs in the borehole's body group, THAT tied pair
    becomes the donor pair

and, for what the tied surface is allowed to do once it arrives:

    check if the ties stay in the litho body otherwise rescale based on the
    litho thickness at that location

The flanking rule (``borehole_flank_donors``) stays as the fallback wherever no
tie spans the borehole.

Every case below is phrased in that vocabulary.  A comment here citing
``weights[0]`` or ``_MIN_BLEND_WEIGHT`` would mean the test is checking the
implementation instead of the ruling.

Cases
-----
T1  An accepted tie spanning the borehole becomes the donor pair, even when a
    tighter untied flank pair exists.
T2  With no tie spanning the borehole, the flanking rule still decides.
T3  A tie whose two endpoints sit on the same side of the borehole does not
    span it and does not become the donor pair.
T4  A tie with a borehole endpoint is not a CPT pair and is ignored.
T5  A tied surface stays inside the borehole's litho body: where the body thins
    at the borehole, the surface is rescaled by the litho thickness there
    instead of keeping the donors' absolute depth.
T6  Only the TIED bands correspond — two donors whose full packing sequences
    differ can still pair on the bands the engineer tied.
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
from groundmodel.domain.services.geotech_tie_donors import (
    MODE_TIE_INTERPOLATED,
    AcceptedTie,
    select_tie_informed_donors,
)

# Real NAD integers so a mis-wired lookup reads as a wrong class, not as a
# passing tautology. 5 = SAND loose, 6 = SAND moderate, 7 = SAND dense.
_LOOSE, _MODERATE, _DENSE = 5, 6, 7

_BH = "borehole-1"
_SECTION_ID = "s1"


def _stack(
    investigation_id: str,
    *,
    top: float,
    base: float,
    bands: list[tuple[float, float, int, str]],
    map_distance_m: float = 100.0,
) -> DonorStack:
    """Build a donor CPT's in-extent packing stack, with band layer ids.

    Parameters
    ----------
    investigation_id : str
        The donor CPT's id.
    top : float
        Top of the donor's own litho extent (m below its collar).
    base : float
        Base of that extent (m below its collar).
    bands : list[tuple[float, float, int, str]]
        ``(top_m, base_m, nad_class, layer_id)`` packing bands inside the
        extent.  The layer id is what an accepted tie names.
    map_distance_m : float, optional
        Straight-line map distance from the borehole.

    Returns
    -------
    DonorStack
        The donor stack the rule reads.
    """
    return DonorStack(
        investigation_id=investigation_id,
        name=investigation_id,
        extent_top_m=top,
        extent_base_m=base,
        bands=tuple(DonorBand(t, b, c, layer_id) for t, b, c, layer_id in bands),
        map_distance_m=map_distance_m,
    )


def _section(**along: float) -> SectionPlacement:
    """Build a one-section placement from ``investigation_id=along_m`` pairs.

    Parameters
    ----------
    **along : float
        Along-section position per investigation id.

    Returns
    -------
    SectionPlacement
        The section the rule looks along.
    """
    return SectionPlacement(section_id=_SECTION_ID, section_name="A-A'", along_m=dict(along))


def test_t1_a_tie_spanning_the_borehole_becomes_the_donor_pair() -> None:
    """T1: the tied pair wins over the untied flanks the borehole sits between."""
    # The tie runs from L (far left) to R (far right), across the borehole.
    left = _stack(
        "L",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE, "L-top"), (4.0, 10.0, _DENSE, "L-bot")],
    )
    right = _stack(
        "R",
        top=0.0,
        base=10.0,
        bands=[(0.0, 6.0, _LOOSE, "R-top"), (6.0, 10.0, _DENSE, "R-bot")],
    )
    # The nearest columns either side of the borehole — the flanking rule's
    # answer — carry no tie at all.
    near_left = _stack(
        "NL",
        top=0.0,
        base=10.0,
        bands=[(0.0, 1.0, _LOOSE, "NL-top"), (1.0, 10.0, _DENSE, "NL-bot")],
    )
    near_right = _stack(
        "NR",
        top=0.0,
        base=10.0,
        bands=[(0.0, 1.0, _LOOSE, "NR-top"), (1.0, 10.0, _DENSE, "NR-bot")],
    )
    section = _section(**{_BH: 200.0, "L": 0.0, "NL": 190.0, "NR": 210.0, "R": 400.0})
    ties = [
        AcceptedTie(
            investigation_a="L",
            layer_a_id="L-bot",
            investigation_b="R",
            layer_b_id="R-bot",
            section_id=_SECTION_ID,
        )
    ]

    selection = select_tie_informed_donors(
        borehole_id=_BH,
        donors=[left, right, near_left, near_right],
        sections=[section],
        ties=ties,
    )

    assert selection is not None, "an accepted tie spans this borehole"
    assert selection.mode == MODE_TIE_INTERPOLATED
    assert [d.stack.investigation_id for d in selection.donors] == ["L", "R"]
    assert selection.section_name == "A-A'"

    # Equidistant tied donors → the tied surface lands halfway between the two
    # tied bands' tops (4 m and 6 m).
    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    assert [nad for _t, _b, nad in surfaces] == [_DENSE]
    assert surfaces[0][0] == pytest.approx(5.0)


def test_t2_with_no_tie_spanning_it_the_flanking_rule_still_decides() -> None:
    """T2: no tie → the shipped flanking rule is what answers."""
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 4.0, _DENSE, "L1")])
    right = _stack("R", top=0.0, base=10.0, bands=[(0.0, 6.0, _DENSE, "R1")])
    section = _section(**{_BH: 200.0, "L": 100.0, "R": 300.0})

    assert (
        select_tie_informed_donors(
            borehole_id=_BH, donors=[left, right], sections=[section], ties=[]
        )
        is None
    )
    # And the fallback still produces the flanking answer it always did.
    fallback = select_flank_donors(borehole_id=_BH, donors=[left, right], sections=[section])
    assert fallback.mode == "flank_interpolated"


def test_t3_a_tie_that_does_not_cross_the_borehole_is_not_the_donor_pair() -> None:
    """T3: both tie endpoints left of the borehole → the tie spans nothing here."""
    a = _stack("A", top=0.0, base=10.0, bands=[(0.0, 4.0, _DENSE, "A1")])
    b = _stack("B", top=0.0, base=10.0, bands=[(0.0, 6.0, _DENSE, "B1")])
    section = _section(**{_BH: 500.0, "A": 100.0, "B": 200.0})
    ties = [
        AcceptedTie(
            investigation_a="A",
            layer_a_id="A1",
            investigation_b="B",
            layer_b_id="B1",
            section_id=_SECTION_ID,
        )
    ]

    assert (
        select_tie_informed_donors(borehole_id=_BH, donors=[a, b], sections=[section], ties=ties)
        is None
    )


def test_t4_a_tie_with_a_borehole_endpoint_is_not_a_cpt_pair() -> None:
    """T4: the rule needs both endpoints to be CPTs in the borehole's body group."""
    left = _stack("L", top=0.0, base=10.0, bands=[(0.0, 4.0, _DENSE, "L1")])
    right = _stack("R", top=0.0, base=10.0, bands=[(0.0, 6.0, _DENSE, "R1")])
    section = _section(**{_BH: 200.0, "L": 100.0, "R": 300.0})
    # The engineer tied the left CPT straight to the borehole column.
    ties = [
        AcceptedTie(
            investigation_a="L",
            layer_a_id="L1",
            investigation_b=_BH,
            layer_b_id="BH1",
            section_id=_SECTION_ID,
        )
    ]

    assert (
        select_tie_informed_donors(
            borehole_id=_BH, donors=[left, right], sections=[section], ties=ties
        )
        is None
    )


def test_t5_a_tied_surface_is_rescaled_to_the_litho_thickness_at_the_borehole() -> None:
    """T5: the tied surface stays inside a litho body that thins at the borehole."""
    # Both donors read the same sand, 10 m thick, with the dense top at 4 m —
    # i.e. 40 % down the unit.
    left = _stack(
        "L",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE, "L-top"), (4.0, 10.0, _DENSE, "L-bot")],
    )
    right = _stack(
        "R",
        top=0.0,
        base=10.0,
        bands=[(0.0, 4.0, _LOOSE, "R-top"), (4.0, 10.0, _DENSE, "R-bot")],
    )
    section = _section(**{_BH: 200.0, "L": 100.0, "R": 300.0})
    ties = [
        AcceptedTie(
            investigation_a="L",
            layer_a_id="L-top",
            investigation_b="R",
            layer_b_id="R-top",
            section_id=_SECTION_ID,
        ),
        AcceptedTie(
            investigation_a="L",
            layer_a_id="L-bot",
            investigation_b="R",
            layer_b_id="R-bot",
            section_id=_SECTION_ID,
        ),
    ]

    selection = select_tie_informed_donors(
        borehole_id=_BH, donors=[left, right], sections=[section], ties=ties
    )
    assert selection is not None

    # At the borehole the same sand is only 2 m thick (3.0-5.0 m).  Keeping the
    # donors' absolute 4 m would put the tied surface a metre BELOW the body.
    surfaces = flank_packing_surfaces(selection, extent_top_m=3.0, extent_base_m=5.0)

    assert [nad for _t, _b, nad in surfaces] == [_LOOSE, _DENSE]
    boundary = surfaces[0][1]
    assert 3.0 <= boundary <= 5.0, (
        f"the tied surface must stay inside the borehole's litho body, got {boundary}"
    )
    # 40 % down a 2 m unit starting at 3.0 m.
    assert boundary == pytest.approx(3.8)
    assert surfaces[-1][1] == pytest.approx(5.0)


def test_t6_only_the_tied_bands_correspond() -> None:
    """T6: donors whose full sequences differ still pair on the tied bands."""
    # L reads loose-moderate-dense; R reads only loose-dense.  The flanking rule
    # refuses to pair those sequences; the engineer's tie says which bands match.
    left = _stack(
        "L",
        top=0.0,
        base=10.0,
        bands=[
            (0.0, 2.0, _LOOSE, "L1"),
            (2.0, 4.0, _MODERATE, "L2"),
            (4.0, 10.0, _DENSE, "L3"),
        ],
    )
    right = _stack(
        "R",
        top=0.0,
        base=10.0,
        bands=[(0.0, 6.0, _LOOSE, "R1"), (6.0, 10.0, _DENSE, "R2")],
    )
    section = _section(**{_BH: 200.0, "L": 100.0, "R": 300.0})
    ties = [
        AcceptedTie(
            investigation_a="L",
            layer_a_id="L3",
            investigation_b="R",
            layer_b_id="R2",
            section_id=_SECTION_ID,
        )
    ]

    selection = select_tie_informed_donors(
        borehole_id=_BH, donors=[left, right], sections=[section], ties=ties
    )

    assert selection is not None
    assert selection.mode == MODE_TIE_INTERPOLATED
    # Only the tied dense band is laid down; the rest of the extent is left for
    # the conservative fill rather than invented.
    surfaces = flank_packing_surfaces(selection, extent_top_m=0.0, extent_base_m=10.0)
    assert [nad for _t, _b, nad in surfaces] == [_DENSE]
    assert surfaces[0][0] == pytest.approx(5.0)
