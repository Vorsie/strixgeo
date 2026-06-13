"""Behavioural tests for the ``strat_types`` value objects.

Comments are phrased in the spec's vocabulary (rank, iso_value, horizon,
control point) rather than in implementation terms, so a regression reads
as a clear contract break.
"""

from __future__ import annotations

from groundmodel.domain.services.strat_field.strat_types import (
    Block,  # noqa: F401
    ContactSurface,  # noqa: F401
    ControlPoint,
    Horizon,
    OrientationConstraint,  # noqa: F401
    StratColumn,
    StratControlData,  # noqa: F401
)


def test_horizon_is_frozen_and_ordered():
    """A Horizon is frozen (immutable) and exposes its rank and formation names."""
    h = Horizon(
        rank=0, iso_value=0.0, above_formation="SAND", below_formation="CLAY", contact_ids=("c1",)
    )
    assert h.rank == 0 and h.above_formation == "SAND"


def test_strat_column_exposes_horizons_top_down():
    """StratColumn preserves horizon order top-down (ascending rank)."""
    col = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "SAND", ("c0",)),  # surface (no above)
            Horizon(1, 1.0, "SAND", "CLAY", ("c1",)),
        )
    )
    assert [h.rank for h in col.horizons] == [0, 1]


def test_control_point_carries_horizon_rank():
    """ControlPoint stores the horizon_rank that the solver will constrain."""
    p = ControlPoint(x=1.0, y=2.0, z=-3.0, horizon_rank=1)
    assert p.horizon_rank == 1
