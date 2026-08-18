"""The owner's placement rule, case by case.

His words, 2026-08-16, after three of my attempts had failed:

    if a cpt to cpt contact is a litho contact, then you replace it by the
    litho bands ... if it is not a litho band but a packing band, find the
    litho band above it below it, measure it's position relative to those two,
    if the packing band is continuous draw it, if it is a lens or onlap check
    if the boreholes is more than 0.5xD away if it is not draw the lens of
    onlap on the borehole, if it is not then prefer the matrix

    ... then you delete all the bands you checked and replaced by hops

Claims pinned here:
  UB1  A tied (continuous) boundary is drawn, at the blended fraction of the
       borehole's OWN unit.
  UB2  It names the bands on BOTH columns — the thing that makes the chain
       close, and the thing every earlier attempt failed to produce.
  UB3  A lens/onlap within half the gap of its column IS drawn.
  UB4  A lens/onlap beyond half the gap is NOT drawn — the matrix wins — and
       it names only the column that declared it.
  UB5  The unit's own contacts are never redrawn: a boundary landing on one is
       dropped.
  UB6  Only re-expressed ties are deleted; an onlap replaced nothing, and a
       tie whose boundary was dropped was not replaced either.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geotech_unit_boundaries import (
    ColumnBoundary,
    place_unit_boundaries,
    replaced_tie_indices,
)


def _b(fraction: float, tag: str) -> ColumnBoundary:
    """A boundary at *fraction* whose two bands are named after *tag*."""
    return ColumnBoundary(
        fraction=fraction, band_above_id=f"{tag}-above", band_below_id=f"{tag}-below"
    )


class TestContinuous:
    """A boundary a tie declares across the gap."""

    def test_ub1_a_tied_boundary_lands_at_the_blended_fraction(self) -> None:
        """UB1: 40 % down on the left, 60 % on the right, borehole half-way →
        50 % down the borehole's own unit, whatever that unit's thickness."""
        placed = place_unit_boundaries(
            [_b(0.4, "L")],
            [_b(0.6, "R")],
            [(0, 0)],
            fraction=0.5,
            # The borehole's unit is 4 m thick and starts at 2 m.
            unit_top_m=2.0,
            unit_base_m=6.0,
        )

        assert len(placed) == 1
        assert placed[0].fraction == pytest.approx(0.5)
        assert placed[0].depth_m == pytest.approx(4.0)
        assert placed[0].kind == "continuous"

    def test_ub2_a_tied_boundary_names_the_bands_on_both_columns(self) -> None:
        """UB2: THE point of driving this from the tie. A tie names both bands,
        so the hop it licenses reaches both CPTs and the chain
        CPT→BH→BH→CPT closes by construction. Every earlier attempt derived the
        correspondence from a one-sided source — a single-flank donor stack,
        then a region naming only its seed layer — and the chain never closed.
        """
        placed = place_unit_boundaries(
            [_b(0.4, "L")],
            [_b(0.6, "R")],
            [(0, 0)],
            fraction=0.5,
            unit_top_m=0.0,
            unit_base_m=10.0,
        )

        assert placed[0].left_band_above_id == "L-above"
        assert placed[0].left_band_below_id == "L-below"
        assert placed[0].right_band_above_id == "R-above"
        assert placed[0].right_band_below_id == "R-below"


class TestOneSided:
    """A lens or an onlap, present on one column only."""

    def test_ub3_within_half_the_gap_it_is_drawn(self) -> None:
        """UB3: the borehole stands 30 % across, inside the left column's
        half-length, so the construct reaches it."""
        placed = place_unit_boundaries(
            [_b(0.5, "L")], [], [], fraction=0.3, unit_top_m=0.0, unit_base_m=10.0
        )

        assert len(placed) == 1
        assert placed[0].kind == "onlap"
        assert placed[0].depth_m == pytest.approx(5.0)

    def test_ub4_beyond_half_the_gap_the_matrix_wins(self) -> None:
        """UB4: at 70 % the borehole is past the left column's reach — the
        construct ended before it, so it simply is not there. Nothing is
        interpolated into the space it would have taken."""
        placed = place_unit_boundaries(
            [_b(0.5, "L")], [], [], fraction=0.7, unit_top_m=0.0, unit_base_m=10.0
        )

        assert placed == []

    def test_ub4b_a_one_sided_boundary_names_only_its_own_column(self) -> None:
        """UB4b: it corresponds to one CPT because only one declared it —
        claiming the other would invent a correlation."""
        placed = place_unit_boundaries(
            [], [_b(0.5, "R")], [], fraction=0.8, unit_top_m=0.0, unit_base_m=10.0
        )

        assert placed[0].left_band_above_id is None
        assert placed[0].right_band_above_id == "R-above"


class TestLithoStaysAuthoritative:
    """The unit's own contacts are the litho model's."""

    def test_ub5_a_boundary_on_the_unit_contact_is_dropped(self) -> None:
        """UB5: a boundary at fraction 0 or 1 IS the litho contact, already on
        the borehole's log. Placing it again would redraw the litho model."""
        placed = place_unit_boundaries(
            [_b(0.0, "top"), _b(1.0, "base"), _b(0.5, "mid")],
            [_b(0.0, "top"), _b(1.0, "base"), _b(0.5, "mid")],
            [(0, 0), (1, 1), (2, 2)],
            fraction=0.5,
            unit_top_m=0.0,
            unit_base_m=10.0,
        )

        assert [p.fraction for p in placed] == [pytest.approx(0.5)]


class TestDeletion:
    """What gets deleted once the hops are written."""

    def test_ub6_only_re_expressed_ties_are_deleted(self) -> None:
        """UB6: *"delete all the bands you checked and replaced by hops"* — so
        a tie whose boundary landed is deleted, and one whose boundary was
        dropped onto the unit contact was never replaced and survives. A
        one-sided construct replaced no tie at all."""
        placed = place_unit_boundaries(
            [_b(0.5, "L"), _b(1.0, "onContact"), _b(0.25, "lensL")],
            [_b(0.5, "R"), _b(1.0, "onContact")],
            [(0, 0), (1, 1)],
            fraction=0.3,
            unit_top_m=0.0,
            unit_base_m=10.0,
        )

        kinds = sorted(p.kind for p in placed)
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

from groundmodel.domain.services.geotech_unit_boundaries import interior_boundary_index


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
    assert interior_boundary_index(0, "top", 1) is None
    assert interior_boundary_index(0, "base", 1) is None
