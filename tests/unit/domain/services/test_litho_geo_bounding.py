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

    Single-hole bodies below that endpoint are dropped and the shallow test is
    marked. Its deep correlated partner reaches below the floor, so the partner
    is valid and untouched (never marked).
    """
    # Boundary at -6. SHALLOW reaches only -4 (above -6) -> marked.
    # Its body B1 spans two investigations (correlated); B2 is single-hole.
    # Lowest correlation = deepest base of a correlated pick = -3.
    picks = [
        _pick("DEEP", "B1", 0.0, 8.0, x=10.0),  # deep partner — reaches -8, below the -6 floor
        _pick("SHALLOW", "B1", 0.0, 3.0),  # correlated, base -3 (the endpoint)
        _pick("SHALLOW", "B2", 3.0, 4.0),  # single-hole, below endpoint -> dropped
    ]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == ["SHALLOW"]
    kept = {(p.investigation_id, p.body_id) for p in result.picks}
    assert ("SHALLOW", "B1") in kept  # correlated, kept
    assert ("SHALLOW", "B2") not in kept  # below the endpoint, dropped
    assert ("DEEP", "B1") in kept  # untouched


def test_shallow_test_is_marked_even_when_nothing_is_truncated():
    """A too-shallow test is flagged even when no pick is dropped or truncated.

    The test's only body is correlated and sits entirely above its own endpoint,
    so the pick list is unchanged — yet the test is above the floor, so it is
    excluded from the model floor and must be marked. This pins the rule that
    marking is unconditional on being above the floor (not gated on a pick change).
    """
    # Boundary at -6. SHALLOW reaches only -3 (above -6); its single pick is the
    # endpoint itself, so nothing is dropped. DEEP is its deep correlated partner.
    picks = [
        _pick("DEEP", "B1", 0.0, 8.0, x=10.0),  # deep partner -> valid, below -6
        _pick("SHALLOW", "B1", 0.0, 3.0),  # correlated, base -3, above the -6 floor
    ]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == ["SHALLOW"]  # marked despite no change
    shallow = [p for p in result.picks if p.investigation_id == "SHALLOW"]
    assert len(shallow) == 1
    assert (shallow[0].top_depth_m, shallow[0].base_depth_m) == (0.0, 3.0)  # unchanged


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
