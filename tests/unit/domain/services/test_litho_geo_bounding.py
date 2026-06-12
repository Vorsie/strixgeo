"""Unit tests for the geology-bounding pick transforms."""

from __future__ import annotations

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    mark_and_truncate_shallow_tests,
)


def _pick(
    inv: str,
    body: str,
    top: float,
    base: float,
    *,
    x: float = 0.0,
    y: float = 0.0,
    surface: float = 0.0,
    formation: str = "F-CLAY",
) -> BodyLayerPick:
    """Build a pick with depths below ``surface`` (elevation = surface - depth)."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=x,
        y_m=y,
        surface_elev_m=surface,
        body_id=body,
        formation_id=formation,
        top_depth_m=top,
        base_depth_m=base,
    )


def test_deep_test_is_kept_unchanged():
    """A test whose base elevation reaches the lowest geological boundary is not marked."""
    # Lowest geological boundary at elevation -6. A test reaching -8 is valid.
    picks = [_pick("DEEP", "B1", 0.0, 8.0)]  # base elevation -8 <= -6
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == []
    assert result.picks == picks


def test_shallow_correlated_test_truncates_at_lowest_correlation():
    """A shallow test with correlated picks is truncated at the deepest correlated base.

    Single-hole bodies below that endpoint are dropped; the test is marked.
    A correlated partner that is technically above the floor but not actually
    truncated is NOT listed in marked_investigation_ids.
    """
    # Boundary at -6. SHALLOW reaches only -4 (above -6) -> marked.
    # Its body B1 spans two investigations (correlated); B2 is single-hole.
    # Lowest correlation = deepest base of a correlated pick = -3.
    picks = [
        _pick("DEEP", "B1", 0.0, 3.0, x=10.0),  # correlated partner of SHALLOW's B1
        _pick("SHALLOW", "B1", 0.0, 3.0),  # correlated, base -3 (the endpoint)
        _pick("SHALLOW", "B2", 3.0, 4.0),  # single-hole, below endpoint -> dropped
    ]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == ["SHALLOW"]
    kept = {(p.investigation_id, p.body_id) for p in result.picks}
    assert ("SHALLOW", "B1") in kept  # correlated, kept
    assert ("SHALLOW", "B2") not in kept  # below the endpoint, dropped
    assert ("DEEP", "B1") in kept  # untouched


def test_shallow_test_with_no_correlation_is_excluded_entirely():
    """A shallow test with only single-hole bodies is excluded entirely and marked."""
    # SHALLOW's only body B9 is single-hole (uncorrelated) -> nothing tied -> drop all.
    picks = [_pick("SHALLOW", "B9", 0.0, 4.0)]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == ["SHALLOW"]
    assert result.picks == []


def test_no_boundary_at_location_keeps_the_test():
    """When the sampler returns None (no geological surface at this location), keep the test."""
    picks = [_pick("EDGE", "B1", 0.0, 4.0)]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: None)
    assert result.marked_investigation_ids == []
    assert result.picks == picks
