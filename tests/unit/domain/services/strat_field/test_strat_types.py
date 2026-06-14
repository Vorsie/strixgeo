"""Behavioural tests for the ``strat_types`` value objects.

Comments are phrased in the spec's vocabulary (rank, iso_value, horizon,
control point) rather than in implementation terms, so a regression reads
as a clear contract break.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    ContactSurface,  # noqa: F401
    ControlPoint,
    Horizon,
    OrientationConstraint,  # noqa: F401
    StratColumn,
    StratControlData,  # noqa: F401
    SurfaceBound,
)


def test_horizon_is_frozen_and_ordered():
    """A Horizon is frozen (immutable) and exposes its rank and formation names."""
    h = Horizon(
        rank=0, iso_value=0.0, above_formation="SAND", below_formation="CLAY", contact_ids=("c1",)
    )
    assert h.rank == 0 and h.above_formation == "SAND"
    # frozen: rebinding any field must raise rather than silently mutate
    with pytest.raises(FrozenInstanceError):
        h.rank = 99  # type: ignore[misc]


def test_strat_column_exposes_horizons_top_down():
    """StratColumn preserves horizon order top-down (ascending rank)."""
    col = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "SAND", ("c0",)),  # surface (no above)
            Horizon(1, 1.0, "SAND", "CLAY", ("c1",)),
        )
    )
    assert [h.rank for h in col.horizons] == [0, 1]


def test_strat_column_iso_value_returns_the_horizons_iso_value():
    """``iso_value(rank)`` returns the iso-value of the horizon at that rank."""
    col = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "SAND", ("c0",)),
            Horizon(1, 1.0, "SAND", "CLAY", ("c1",)),
            Horizon(2, 2.0, "CLAY", None, ()),
        )
    )
    assert col.iso_value(0) == 0.0
    assert col.iso_value(1) == 1.0
    assert col.iso_value(2) == 2.0


def test_strat_column_iso_value_raises_for_an_absent_rank():
    """``iso_value`` raises ValueError when no horizon has the requested rank."""
    col = StratColumn(horizons=(Horizon(0, 0.0, None, "SAND", ("c0",)),))
    with pytest.raises(ValueError, match="rank"):
        col.iso_value(7)


def test_control_point_carries_horizon_rank():
    """ControlPoint stores the horizon_rank that the solver will constrain."""
    p = ControlPoint(x=1.0, y=2.0, z=-3.0, horizon_rank=1)
    assert p.horizon_rank == 1


def _flat_surface_bound(elevation: float) -> SurfaceBound:
    """Build a SurfaceBound that is a flat horizontal plane at ``elevation``.

    A single triangle covering a large footprint so any in-range sample
    returns ``elevation``.
    """
    return SurfaceBound(
        vertices=[(0.0, 0.0, elevation), (100.0, 0.0, elevation), (0.0, 100.0, elevation)],
        triangles=[(0, 1, 2)],
    )


def test_surface_bound_evaluates_inside_footprint():
    """SurfaceBound.evaluate returns the interpolated elevation inside the TIN."""
    bound = _flat_surface_bound(12.5)
    # A point inside the triangle returns the plane's elevation.
    assert bound.evaluate(10.0, 10.0) == pytest.approx(12.5)


def test_surface_bound_evaluates_off_footprint_via_nearest_vertex():
    """Off-footprint, SurfaceBound.evaluate falls back to the nearest vertex's z."""
    bound = SurfaceBound(
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (0.0, 10.0, 5.0)],
        triangles=[(0, 1, 2)],
    )
    # A point far outside the triangle has no containing simplex; the nearest
    # vertex (any of the three at z=5.0) supplies the fallback elevation.
    assert bound.evaluate(1000.0, 1000.0) == pytest.approx(5.0)


def test_block_defaults_to_no_curved_bounds():
    """A Block with no surface bounds keeps the existing flat z_min/z_max behaviour."""
    block = Block(polygon=((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)), z_min=-10.0, z_max=2.0)
    assert block.top_surface is None
    assert block.base_surface is None


def test_block_carries_optional_surface_bounds():
    """A Block can carry curved top/base surface bounds alongside the flat z range."""
    top = _flat_surface_bound(2.0)
    base = _flat_surface_bound(-10.0)
    block = Block(
        polygon=((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)),
        z_min=-10.0,
        z_max=2.0,
        top_surface=top,
        base_surface=base,
    )
    assert block.top_surface is top
    assert block.base_surface is base
    assert block.top_surface.evaluate(0.2, 0.2) == pytest.approx(2.0)
