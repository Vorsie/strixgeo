"""Axis scale: two anchors on an axis define the page-coordinate -> value mapping.

Owner ask: "an overlay that puts the axis correctly" — the scale must be a plain
pair of anchors a later UI can show and let the user drag.
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale


def test_two_anchors_map_page_coordinates_to_values_both_ways() -> None:
    """Two anchors map page coordinates to values both ways."""
    # 0 MPa sits at x=42, 32 MPa at x=337 -> 16 MPa halfway.
    scale = AxisScale(coord_a=42.0, value_a=0.0, coord_b=337.0, value_b=32.0)
    assert scale.value_at(189.5) == pytest.approx(16.0)
    assert scale.coord_of(16.0) == pytest.approx(189.5)


def test_a_reversed_axis_is_just_a_negative_slope() -> None:
    """A reversed axis is just a negative slope."""
    # Elevation axis: +7 m at the top (y=104), -26 m lower down (y=704).
    scale = AxisScale(coord_a=104.0, value_a=7.0, coord_b=704.0, value_b=-26.0)
    assert scale.value_at(404.0) == pytest.approx(-9.5)
    assert scale.is_decreasing


def test_fit_from_tick_labels_recovers_the_scale_and_reports_the_residual() -> None:
    """Fit from tick labels recovers the scale and reports the residual."""
    coords = [42.1, 60.4, 78.8, 97.0, 115.5]
    values = [0.0, 2.0, 4.0, 6.0, 8.0]
    scale = AxisScale.fit(coords, values)
    assert scale.value_at(42.1) == pytest.approx(0.0, abs=0.05)
    assert scale.value_at(115.5) == pytest.approx(8.0, abs=0.05)
    assert scale.max_residual < 0.05


def test_fit_refuses_fewer_than_two_distinct_ticks() -> None:
    """Fit refuses fewer than two distinct ticks."""
    with pytest.raises(ValueError, match="two"):
        AxisScale.fit([10.0], [1.0])


def test_round_trip_through_a_plain_dict_for_the_ui() -> None:
    """Round trip through a plain dict for the ui."""
    scale = AxisScale(coord_a=1.0, value_a=0.0, coord_b=11.0, value_b=5.0)
    assert AxisScale.from_dict(scale.to_dict()) == scale
