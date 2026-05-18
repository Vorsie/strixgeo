"""Unit tests for the pure pinch-out crossing geometry.

``compute_pinch_tip`` is the geometric core of the pinch-out
extrapolation tool: it extrapolates a pinching formation's top along
its local dip and finds where it crosses the deeper target formation.
Pure function, no I/O — exhaustively testable in isolation.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.pinch_out_geometry import compute_pinch_tip


def test_flat_surfaces_converging_right():
    """Pinching top dips down-right toward a flat target → crosses at the
    along where ray elevation meets the target elevation."""
    # Pinching top: from (0, 10) to (10, 5) → gradient -0.5 m/m to the right.
    # Target: flat at elevation 0.
    # Ray beyond x=10: elev = 5 - 0.5*(x-10). Meets 0 at x = 20.
    tip = compute_pinch_tip(
        pinching_polyline=[(0.0, 10.0), (10.0, 5.0)],
        target_polyline=[(0.0, 0.0), (40.0, 0.0)],
        direction="right",
    )
    assert tip is not None
    along, elev = tip
    assert along == pytest.approx(20.0, abs=1e-6)
    assert elev == pytest.approx(0.0, abs=1e-6)


def test_dipping_target():
    """Both surfaces dip; crossing is where the two lines intersect."""
    # Pinching: (0,10)->(10,8), gradient -0.2/m right. Ray: 8 - 0.2*(x-10).
    # Target: (0,0)->(40,4), gradient +0.1/m. Target(x) = 0.1*x.
    # 8 - 0.2(x-10) = 0.1x → 8 +2 -0.2x = 0.1x → 10 = 0.3x → x≈33.33, elev≈3.33
    tip = compute_pinch_tip(
        pinching_polyline=[(0.0, 10.0), (10.0, 8.0)],
        target_polyline=[(0.0, 0.0), (40.0, 4.0)],
        direction="right",
    )
    assert tip is not None
    along, elev = tip
    assert along == pytest.approx(33.3333, abs=1e-3)
    assert elev == pytest.approx(3.3333, abs=1e-3)


def test_diverging_returns_none():
    """Pinching top rises away from a deeper target → never crosses → None."""
    # Pinching dips UP to the right (gradient +1), target far below and flat.
    tip = compute_pinch_tip(
        pinching_polyline=[(0.0, 5.0), (10.0, 15.0)],
        target_polyline=[(0.0, -50.0), (40.0, -50.0)],
        direction="right",
    )
    assert tip is None


def test_single_point_without_override_returns_none():
    """A one-point pinching polyline has no gradient → None unless override."""
    tip = compute_pinch_tip(
        pinching_polyline=[(5.0, 10.0)],
        target_polyline=[(0.0, 0.0), (40.0, 0.0)],
        direction="right",
        dip_override_m_per_m=None,
    )
    assert tip is None


def test_single_point_with_override_resolves():
    """With a dip override, a one-point polyline can still pinch out."""
    # Origin (5,10), gradient -0.5 → meets flat 0 at x = 5 + 10/0.5 = 25.
    tip = compute_pinch_tip(
        pinching_polyline=[(5.0, 10.0)],
        target_polyline=[(0.0, 0.0), (40.0, 0.0)],
        direction="right",
        dip_override_m_per_m=-0.5,
    )
    assert tip is not None
    along, elev = tip
    assert along == pytest.approx(25.0, abs=1e-6)
    assert elev == pytest.approx(0.0, abs=1e-6)


def test_override_supersedes_computed_gradient():
    """An explicit dip override replaces the segment-derived gradient."""
    # Segment gradient would be -0.5 (→ crossing at x=20). Override -1.0
    # → ray: 5 - 1.0*(x-10), meets 0 at x = 15.
    tip = compute_pinch_tip(
        pinching_polyline=[(0.0, 10.0), (10.0, 5.0)],
        target_polyline=[(0.0, 0.0), (40.0, 0.0)],
        direction="right",
        dip_override_m_per_m=-1.0,
    )
    assert tip is not None
    along, _elev = tip
    assert along == pytest.approx(15.0, abs=1e-6)


def test_direction_left_crosses():
    """Pinching toward smaller along_m: ray fires left from the leftmost
    point and crosses a flat target to the left."""
    # Points ascending by along. Left branch uses p0=pts[1]=(20,8),
    # p1=pts[0]=(10,5): gradient = (5-8)/(10-20) = 0.3 per +along.
    # Origin = leftmost point (10, 5). Going left, elev(a) = 5 + 0.3*(a-10).
    # Meets flat target 0 at a = 10 + (-5/0.3) ≈ -6.667 (left of origin ✓).
    tip = compute_pinch_tip(
        pinching_polyline=[(10.0, 5.0), (20.0, 8.0)],
        target_polyline=[(-40.0, 0.0), (30.0, 0.0)],
        direction="left",
    )
    assert tip is not None
    along, elev = tip
    assert along == pytest.approx(-6.6667, abs=1e-3)
    assert along < 10.0  # strictly left of the ray origin
    assert elev == pytest.approx(0.0, abs=1e-6)


def test_crossing_at_exact_rightmost_target_endpoint():
    """B1 regression: the ray crosses exactly at the LAST target point.

    The double-count guard defers an exact right-endpoint hit to the
    next segment's left endpoint — but the last segment has no next, so
    pre-fix this returned None on a geometrically valid pinch-out."""
    # Pinching (0,10)->(10,5), gradient -0.5 right. Ray=0 at along=20.
    # Target's LAST point is exactly (20, 0).
    tip = compute_pinch_tip(
        pinching_polyline=[(0.0, 10.0), (10.0, 5.0)],
        target_polyline=[(0.0, 0.0), (20.0, 0.0)],
        direction="right",
    )
    assert tip is not None
    assert tip[0] == pytest.approx(20.0, abs=1e-6)
    assert tip[1] == pytest.approx(0.0, abs=1e-6)


def test_crossing_at_exact_leftmost_target_endpoint():
    """B1 regression, symmetric left-direction case."""
    # Left branch: pts ascending; origin = leftmost (10,5); gradient from
    # (pts[1]->pts[0]) = (5-8)/(10-20)=0.3. Going left elev decreases;
    # meets flat 0 at along = 10 + (-5/0.3) ≈ -6.667. Make that the
    # target's LAST point in the left-filtered segment list.
    tip = compute_pinch_tip(
        pinching_polyline=[(10.0, 5.0), (20.0, 8.0)],
        target_polyline=[(-6.6667, 0.0), (30.0, 0.0)],
        direction="left",
    )
    assert tip is not None
    assert tip[0] == pytest.approx(-6.6667, abs=1e-3)
    assert tip[1] == pytest.approx(0.0, abs=1e-6)


def test_bad_direction_raises():
    """An invalid direction is a programming error, not a data case."""
    with pytest.raises(ValueError, match="direction"):
        compute_pinch_tip(
            pinching_polyline=[(0.0, 10.0), (10.0, 5.0)],
            target_polyline=[(0.0, 0.0), (40.0, 0.0)],
            direction="up",
        )


def test_empty_target_returns_none():
    """No target segment to cross → None, never raises."""
    assert (
        compute_pinch_tip(
            pinching_polyline=[(0.0, 10.0), (10.0, 5.0)],
            target_polyline=[(0.0, 0.0)],
            direction="right",
        )
        is None
    )
