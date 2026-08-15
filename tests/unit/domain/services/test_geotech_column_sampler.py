"""A borehole column reads the partition it stands in.

Owner ruling 2026-08-15, after two failed attempts to rebuild the correlation
from donor bookkeeping: *"the borehole thing is really a geometry problem, we
draw half length lenses between two cpts same for onlaps. you just need to
check if a borehole column intersects a lens or onlap"*, and then *"can't you
just warp the geometry layer with the 0-1 rescale within it's litho?"* — with
*"litho is authoritative still"* / *"we don't need to invent those, only invent
inside existing litho at boreholes"*.

Claims pinned here:
  CS1  A band spanning the gap is cut wherever the column stands.
  CS2  A lens that pinches out BEFORE the column is not cut — the column
       simply does not have it.
  CS3  A lens the column does stand in IS cut, and covers the matrix it
       overlays, top and bottom of which survive.
  CS4  The cut names the layers the region belongs to, so the ties are read
       off rather than inferred — and two columns in the same region name the
       same layers, which is the borehole↔borehole link no donor rule made.
  CS5  A vertical line that misses every region cuts nothing.
  PL1  A cut is re-laid at the same fraction of the column's OWN litho layer,
       whatever that layer's thickness — the 0→1 rescale.
  PL2  The litho layer's top and base are never moved: bands land inside it.
  PL3  A degenerate frame or a zero-thickness layer places nothing.
  PL4  Sampling then warping equals warping then sampling — at a fixed
       fraction the warp is affine in elevation, which is what makes reading
       the geometry exact rather than approximate.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geotech_column_sampler import (
    LithoFrame,
    place_bands_in_litho_layer,
    sample_regions_at_fraction,
)
from groundmodel.domain.services.voxel_litho.voxel_types import RegionInput


def _region(
    polygon: list[tuple[float, float]],
    *,
    formation_id: str = "F",
    layer_ids: tuple[str, ...] = (),
    gap_index: int = 0,
    kind: str | None = "quad",
    overlay_tier: str | None = None,
) -> RegionInput:
    """Build one partition region in ``(fraction, elevation)`` space."""
    return RegionInput(
        formation_id=formation_id,
        body_id=None,
        polygon=tuple(polygon),
        gap_index=gap_index,
        kind=kind,  # type: ignore[arg-type]
        overlay_tier=overlay_tier,  # type: ignore[arg-type]
        layer_ids=layer_ids,
    )


# A band spanning the whole gap, 10 m thick, sloping 2 m down to the right.
_BAND = _region(
    [(0.0, 20.0), (1.0, 18.0), (1.0, 8.0), (0.0, 10.0)],
    formation_id="NAD6",
    layer_ids=("L-left", "L-right"),
)


class TestSampling:
    """What the column's vertical line cuts."""

    def test_cs1_a_band_spanning_the_gap_is_cut_wherever_the_column_stands(self) -> None:
        """CS1: the band is there at every fraction, at the sloping elevation."""
        bands = sample_regions_at_fraction([_BAND], gap_index=0, fraction=0.5)

        assert len(bands) == 1
        assert bands[0].top_elev_m == pytest.approx(19.0)
        assert bands[0].base_elev_m == pytest.approx(9.0)

    def test_cs2_a_lens_that_pinched_out_before_the_column_is_not_cut(self) -> None:
        """CS2: *"we draw half length lenses between two cpts"* — a column past
        the lens's end simply does not have it. Nothing is interpolated into
        the gap it leaves."""
        lens = _region(
            [(0.0, 16.0), (0.4, 15.0), (0.0, 14.0)],
            formation_id="SILT",
            kind="lens",
            overlay_tier="lens",
        )

        cut_inside = sample_regions_at_fraction([lens], gap_index=0, fraction=0.2)
        cut_beyond = sample_regions_at_fraction([lens], gap_index=0, fraction=0.7)

        assert len(cut_inside) == 1
        assert cut_beyond == [], "the column stands past the lens's end — it has no lens"

    def test_cs3_a_lens_covers_its_matrix_and_the_matrix_survives_around_it(self) -> None:
        """CS3: the overlay wins where it sits, exactly as the section draws it,
        and the matrix above and below it is still there."""
        lens = _region(
            [(0.0, 16.0), (0.8, 16.0), (0.8, 14.0), (0.0, 14.0)],
            formation_id="SILT",
            kind="lens",
            overlay_tier="lens",
        )

        bands = sample_regions_at_fraction([_BAND, lens], gap_index=0, fraction=0.5)

        assert [b.formation_id for b in bands] == ["NAD6", "SILT", "NAD6"]
        assert bands[0].base_elev_m == pytest.approx(16.0)
        assert bands[2].top_elev_m == pytest.approx(14.0)

    def test_cs4_the_cut_names_the_layers_the_region_belongs_to(self) -> None:
        """CS4: the region NAMES its layers, so the tie endpoints are read off.
        Two columns in the same region name the same layers — which is exactly
        the borehole↔borehole correspondence no donor rule could produce."""
        near = sample_regions_at_fraction([_BAND], gap_index=0, fraction=0.25)
        far = sample_regions_at_fraction([_BAND], gap_index=0, fraction=0.75)

        assert near[0].layer_ids == ("L-left", "L-right")
        assert far[0].layer_ids == near[0].layer_ids

    def test_cs5_a_line_outside_every_region_cuts_nothing(self) -> None:
        """CS5: a gap with no partition, or a column beyond it, gets nothing —
        not a guess."""
        assert sample_regions_at_fraction([_BAND], gap_index=1, fraction=0.5) == []


class TestPlacing:
    """How a cut is re-laid inside the column's own litho layer."""

    # The unit is 10 m thick on the left column and 10 m on the right, so the
    # frame is flat and the arithmetic is readable.
    _FRAME = LithoFrame(
        left_top_elev_m=20.0,
        left_base_elev_m=10.0,
        right_top_elev_m=18.0,
        right_base_elev_m=8.0,
    )

    def test_pl1_a_cut_is_re_laid_at_the_same_fraction_of_the_column_s_own_unit(
        self,
    ) -> None:
        """PL1: *"take top as 0 an bottom as 1 and rescale them"* — a boundary
        40 % down the unit stays 40 % down the unit, whatever the borehole's
        own unit thickness is."""
        bands = sample_regions_at_fraction([_BAND], gap_index=0, fraction=0.5)
        # Split the sampled band at 40 % so there is a boundary to check.
        upper = sample_regions_at_fraction(
            [
                _region(
                    [(0.0, 20.0), (1.0, 18.0), (1.0, 14.0), (0.0, 16.0)],
                    formation_id="NAD6",
                )
            ],
            gap_index=0,
            fraction=0.5,
        )
        assert bands and upper

        placed = place_bands_in_litho_layer(
            upper,
            fraction=0.5,
            frame=self._FRAME,
            # The borehole's OWN unit is only 5 m thick, and starts at 2 m.
            layer_top_m=2.0,
            layer_base_m=7.0,
        )

        assert len(placed) == 1
        # The cut runs from the unit top down to 4 m of the unit's 10 m at this
        # fraction → 0 % to 40 % → 2.00 m to 4.00 m in a 5 m-thick unit.
        assert placed[0].depth_top_m == pytest.approx(2.0)
        assert placed[0].depth_base_m == pytest.approx(4.0)

    def test_pl2_the_litho_layer_s_own_top_and_base_are_never_moved(self) -> None:
        """PL2: *"litho is authoritative still"*. A cut that overshoots the unit
        is clipped to it — the geotech geometry subdivides the litho layer, it
        never redraws it."""
        overshooting = sample_regions_at_fraction(
            [_region([(0.0, 40.0), (1.0, 40.0), (1.0, -5.0), (0.0, -5.0)])],
            gap_index=0,
            fraction=0.5,
        )

        placed = place_bands_in_litho_layer(
            overshooting,
            fraction=0.5,
            frame=self._FRAME,
            layer_top_m=2.0,
            layer_base_m=7.0,
        )

        assert len(placed) == 1
        assert placed[0].depth_top_m == pytest.approx(2.0)
        assert placed[0].depth_base_m == pytest.approx(7.0)

    def test_pl3_a_degenerate_frame_or_layer_places_nothing(self) -> None:
        """PL3: no thickness, no rescale — and no invented band."""
        bands = sample_regions_at_fraction([_BAND], gap_index=0, fraction=0.5)
        flat_frame = LithoFrame(
            left_top_elev_m=10.0,
            left_base_elev_m=10.0,
            right_top_elev_m=10.0,
            right_base_elev_m=10.0,
        )

        assert (
            place_bands_in_litho_layer(
                bands, fraction=0.5, frame=flat_frame, layer_top_m=2.0, layer_base_m=7.0
            )
            == []
        )
        assert (
            place_bands_in_litho_layer(
                bands, fraction=0.5, frame=self._FRAME, layer_top_m=5.0, layer_base_m=5.0
            )
            == []
        )

    def test_pl4_sampling_then_warping_equals_warping_then_sampling(self) -> None:
        """PL4: at a fixed fraction the warp is affine in elevation, so the two
        orders agree. That equivalence is what makes reading the section
        geometry EXACT rather than an approximation of it — and it is the
        reason the polygon does not have to be warped edge by edge.
        """
        fraction = 0.37
        bands = sample_regions_at_fraction([_BAND], gap_index=0, fraction=fraction)
        placed = place_bands_in_litho_layer(
            bands,
            fraction=fraction,
            frame=self._FRAME,
            layer_top_m=0.0,
            layer_base_m=1.0,
        )

        # Warp first: convert the polygon's own corners at this fraction.
        unit_top, unit_base = self._FRAME.bounds_at(fraction)
        band_top = 20.0 + fraction * (18.0 - 20.0)
        band_base = 10.0 + fraction * (8.0 - 10.0)
        expected_top_u = (unit_top - band_top) / (unit_top - unit_base)
        expected_base_u = (unit_top - band_base) / (unit_top - unit_base)

        assert placed[0].depth_top_m == pytest.approx(expected_top_u)
        assert placed[0].depth_base_m == pytest.approx(expected_base_u)
