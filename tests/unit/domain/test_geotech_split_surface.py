"""Tests for the pure geotech split-surface interpolator (spec §0.1 step 3)."""

from groundmodel.domain.services.geotech_split_surface import (
    ColumnXY,
    interpolate_split_elevations,
)


def test_flat_fallback_with_one_cpt_point():
    """One CPT transition at elev 6 gives every column 6.0 (flat surface)."""
    cpts = [ColumnXY("c1", 0.0, 0.0)]
    cols = [ColumnXY("c1", 0.0, 0.0), ColumnXY("b1", 50.0, 0.0)]
    out = interpolate_split_elevations(cpts, [6.0], cols)
    assert out["c1"] == 6.0
    assert out["b1"] == 6.0


def test_two_cpts_flat_mean_fallback():
    """Two CPTs fall back to mean elevation; TIN requires ≥3 points."""
    cpts = [ColumnXY("c1", 0.0, 0.0), ColumnXY("c2", 100.0, 0.0)]
    cols = cpts + [ColumnXY("b1", 50.0, 0.0)]
    out = interpolate_split_elevations(cpts, [6.0, 4.0], cols)
    assert out["b1"] == 5.0  # mean of 6 and 4


def test_three_cpts_tin_interpolates_borehole_between():
    """Three CPTs on a plane; TIN interpolates a borehole inside the footprint."""
    # Plane: elev = 10 - x*0.1; borehole at x=50 -> expected ~5.
    cpts = [ColumnXY("c1", 0.0, 0.0), ColumnXY("c2", 100.0, 0.0), ColumnXY("c3", 50.0, 100.0)]
    elevs = [10.0, 0.0, 5.0]
    cols = cpts + [ColumnXY("b1", 50.0, 0.0)]
    out = interpolate_split_elevations(cpts, elevs, cols)
    assert abs(out["b1"] - 5.0) < 0.5
