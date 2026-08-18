"""The owner's placement rule, case by case.

His words, 2026-08-16, after three of my attempts had failed:

    if a cpt to cpt contact is a litho contact, then you replace it by the
    litho bands ... if it is not a litho band but a packing band, find the
    litho band above it below it, measure it's position relative to those two,
    if the packing band is continuous draw it, if it is a lens or onlap check
    if the boreholes is more than 0.5xD away if it is not draw the lens of
    onlap on the borehole, if it is not then prefer the matrix

    ... then you delete all the bands you checked and replaced by hops

And his correction, 2026-08-18, after B9's committed boundary landed 2.2 m
above the tie line he had drawn: *"go for the mtaw, it'll look better than
the fractional"* — the contact lands where the DRAWN TIE LINE crosses the
borehole's column, in elevation, not at a blended fraction of the unit.

Claims pinned here:
  UB1  A tied (continuous) boundary lands where the tie LINE crosses the
       borehole — elevation interpolated between the two columns' boundary
       elevations — NOT at the blended fraction of the unit.
  UB2  It names the bands on BOTH columns — the thing that makes the chain
       close, and the thing every earlier attempt failed to produce.
  UB3  A lens/onlap within half the gap of its column IS drawn, flat, at its
       own elevation.
  UB4  A lens/onlap beyond half the gap is NOT drawn — the matrix wins — and
       it names only the column that declared it.
  UB5  The unit's own contacts are never redrawn: a boundary landing on one is
       never a band cut.
  UB6  Only re-expressed ties are deleted; an onlap replaced nothing, and a
       tie whose boundary was dropped was not replaced either.
  UB7  A tie line that leaves the borehole's unit is not drawn there — the
       litho contact already bounds the unit, and litho stays authoritative.
       The line is still reported off-log, so the caller can classify the
       clipped unit from the bands that run PAST it (the thin deep body under
       a dense-top line reads dense, not top-of-stack).
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geotech_unit_boundaries import (
    ColumnBoundary,
    interior_boundary_index,
    place_unit_boundaries,
    replaced_tie_indices,
)


def _b(elev_m: float, tag: str) -> ColumnBoundary:
    """A boundary at elevation *elev_m* whose two bands are named after *tag*."""
    return ColumnBoundary(elev_m=elev_m, band_above_id=f"{tag}-above", band_below_id=f"{tag}-below")


class TestContinuous:
    """A boundary a tie declares across the gap."""

    def test_ub1_a_tied_boundary_lands_on_the_drawn_tie_line(self) -> None:
        """UB1: the B9 scene. The tie line runs from −0.78 mTAW on the left
        column to −0.66 mTAW on the right; the borehole stands 93 % of the way
        across. The contact lands where that LINE crosses the column:
        −0.78 + 0.93 · 0.12 = −0.6684 mTAW → 13.5184 m below the 12.85 collar.
        The old fraction blend put it at 11.33 m (+1.52 mTAW) — 2.2 m above
        the line the engineer drew, which is what he rejected."""
        placed = place_unit_boundaries(
            [_b(-0.78, "L")],
            [_b(-0.66, "R")],
            [(0, 0)],
            fraction=0.93,
            unit_top_m=7.5,
            unit_base_m=17.5,
            bh_collar_elev_m=12.85,
        )

        assert len(placed) == 1
        assert placed[0].depth_m == pytest.approx(13.5184)
        assert placed[0].kind == "continuous"
        # The rejected fractional answer, as a negative control.
        assert placed[0].depth_m != pytest.approx(11.33, abs=0.5)

    def test_ub2_a_tied_boundary_names_the_bands_on_both_columns(self) -> None:
        """UB2: THE point of driving this from the tie. A tie names both bands,
        so the hop it licenses reaches both CPTs and the chain
        CPT→BH→BH→CPT closes by construction. Every earlier attempt derived the
        correspondence from a one-sided source — a single-flank donor stack,
        then a region naming only its seed layer — and the chain never closed.
        """
        placed = place_unit_boundaries(
            [_b(6.0, "L")],
            [_b(4.0, "R")],
            [(0, 0)],
            fraction=0.5,
            unit_top_m=0.0,
            unit_base_m=10.0,
            bh_collar_elev_m=10.0,
        )

        assert placed[0].left_band_above_id == "L-above"
        assert placed[0].left_band_below_id == "L-below"
        assert placed[0].right_band_above_id == "R-above"
        assert placed[0].right_band_below_id == "R-below"


class TestOneSided:
    """A lens or an onlap, present on one column only."""

    def test_ub3_within_half_the_gap_it_is_drawn_flat(self) -> None:
        """UB3: the borehole stands 30 % across, inside the left column's
        half-length, so the construct reaches it — at its OWN elevation,
        carried flat, not at a fraction of a differently-framed unit."""
        placed = place_unit_boundaries(
            [_b(5.0, "L")],
            [],
            [],
            fraction=0.3,
            unit_top_m=0.0,
            unit_base_m=10.0,
            bh_collar_elev_m=10.0,
        )

        assert len(placed) == 1
        assert placed[0].kind == "onlap"
        assert placed[0].depth_m == pytest.approx(5.0)

    def test_ub4_beyond_half_the_gap_the_matrix_wins(self) -> None:
        """UB4: at 70 % the borehole is past the left column's reach — the
        construct ended before it, so it simply is not there. Nothing is
        interpolated into the space it would have taken."""
        placed = place_unit_boundaries(
            [_b(5.0, "L")],
            [],
            [],
            fraction=0.7,
            unit_top_m=0.0,
            unit_base_m=10.0,
            bh_collar_elev_m=10.0,
        )

        assert placed == []

    def test_ub4b_a_one_sided_boundary_names_only_its_own_column(self) -> None:
        """UB4b: it corresponds to one CPT because only one declared it —
        claiming the other would invent a correlation."""
        placed = place_unit_boundaries(
            [],
            [_b(5.0, "R")],
            [],
            fraction=0.8,
            unit_top_m=0.0,
            unit_base_m=10.0,
            bh_collar_elev_m=10.0,
        )

        assert placed[0].left_band_above_id is None
        assert placed[0].right_band_above_id == "R-above"


class TestLithoStaysAuthoritative:
    """The unit's own contacts are the litho model's."""

    def test_ub5_a_boundary_on_the_unit_contact_is_dropped(self) -> None:
        """UB5: a boundary landing on the unit's top or base IS the litho
        contact, already on the borehole's log. Placing it again would redraw
        the litho model. Collar 10, unit 0–10 m: lines at +10 and 0 mTAW land
        exactly on the contacts and go; the +5 line lands mid-unit and stays.
        """
        placed = place_unit_boundaries(
            [_b(10.0, "top"), _b(0.0, "base"), _b(5.0, "mid")],
            [_b(10.0, "top"), _b(0.0, "base"), _b(5.0, "mid")],
            [(0, 0), (1, 1), (2, 2)],
            fraction=0.5,
            unit_top_m=0.0,
            unit_base_m=10.0,
            bh_collar_elev_m=10.0,
        )

        assert [p.depth_m for p in placed if p.on_log] == [pytest.approx(5.0)]

    def test_ub7_a_tie_line_that_leaves_the_unit_is_not_drawn(self) -> None:
        """UB7: the tie line sits at +8 mTAW at the borehole, but the
        borehole's own unit only starts at +5 (depth 5, collar 10). The litho
        contact already bounds the unit there; no band cut is drawn and the
        tie is NOT reported as replaced. The line IS reported off-log, with
        its band names, so the caller can read that the unit below it
        continues the line's under-side bands."""
        placed = place_unit_boundaries(
            [_b(8.0, "L")],
            [_b(8.0, "R")],
            [(0, 0)],
            fraction=0.5,
            unit_top_m=5.0,
            unit_base_m=9.0,
            bh_collar_elev_m=10.0,
        )

        assert [p for p in placed if p.on_log] == []
        assert replaced_tie_indices(placed) == []
        assert len(placed) == 1
        assert placed[0].on_log is False
        assert placed[0].left_band_below_id == "L-below"

    def test_ub7b_a_one_sided_construct_outside_the_unit_is_absent(self) -> None:
        """UB7b: an onlap above the unit is not context — one column declared
        it and the matrix rule already answers; nothing is reported."""
        placed = place_unit_boundaries(
            [_b(8.0, "L")],
            [],
            [],
            fraction=0.3,
            unit_top_m=5.0,
            unit_base_m=9.0,
            bh_collar_elev_m=10.0,
        )

        assert placed == []


class TestDeletion:
    """What gets deleted once the hops are written."""

    def test_ub6_only_re_expressed_ties_are_deleted(self) -> None:
        """UB6: *"delete all the bands you checked and replaced by hops"* — so
        a tie whose boundary landed is deleted, and one whose boundary was
        dropped onto the unit contact was never replaced and survives. A
        one-sided construct replaced no tie at all."""
        placed = place_unit_boundaries(
            [_b(5.0, "L"), _b(0.0, "onContact"), _b(7.5, "lensL")],
            [_b(5.0, "R"), _b(0.0, "onContact")],
            [(0, 0), (1, 1)],
            fraction=0.3,
            unit_top_m=0.0,
            unit_base_m=10.0,
            bh_collar_elev_m=10.0,
        )

        kinds = sorted(p.kind for p in placed if p.on_log)
        assert kinds == ["continuous", "onlap"], kinds
        # Tie 0 was drawn; tie 1 fell on the unit's base contact and was not.
        assert replaced_tie_indices(placed) == [0]


# --- endpoint side → interior boundary index (audit P1-2, 2026-08-18) --------
#
# A tie names a band AND a side. The side decides WHICH boundary the tie
# declares: 'top' is the seam above the band, 'base' the seam below it. The
# placement used to assume 'top' for every endpoint, so a base↔base tie (the
# bottom-tie spec — how the deepest band bands at all) was applied one seam
# too high, and a base tie on the deepest band was silently dropped by the
# li == 0 guard written for tops.


def test_sd1_a_top_side_names_the_seam_above() -> None:
    """Band 1's top = interior seam 0 (between bands 0 and 1)."""
    assert interior_boundary_index(1, "top", 3) == 0


def test_sd2_a_base_side_names_the_seam_below() -> None:
    """Band 1's base = interior seam 1 (between bands 1 and 2)."""
    assert interior_boundary_index(1, "base", 3) == 1


def test_sd3_the_topmost_top_is_the_litho_contact() -> None:
    """The unit's own top belongs to the litho model — not placeable here."""
    assert interior_boundary_index(0, "top", 3) is None


def test_sd4_the_deepest_base_is_the_litho_contact() -> None:
    """The unit's own base belongs to the litho model — not placeable here."""
    assert interior_boundary_index(2, "base", 3) is None


def test_sd5_the_same_seam_by_either_name() -> None:
    """Band 0's base and band 1's top are ONE physical seam — one index."""
    assert interior_boundary_index(0, "base", 2) == interior_boundary_index(1, "top", 2) == 0


def test_sd6_a_single_band_unit_has_no_interior_seam() -> None:
    """Both surfaces of a lone band are the unit's own litho contacts."""
    assert interior_boundary_index(0, "top", 1) is None
    assert interior_boundary_index(0, "base", 1) is None
