"""Unit tests for the geology-bounding pick transforms."""

from __future__ import annotations

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
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


def _flat_sampler(boundaries):
    """Return a BoundarySampler yielding fixed (formation_id, elevation) pairs."""
    ordered = sorted(boundaries, key=lambda fe: fe[1], reverse=True)
    return lambda x, y: list(ordered)


def test_straddling_body_is_split_into_two_band_confined_bodies():
    """A body that straddles a geological boundary is divided into two band-confined bodies."""
    # One clay body B1 across two investigations, both straddling a boundary at -3
    # (formation G-MID). No contact within tolerance -> DIVIDE.
    picks = [
        _pick("A", "B1", 0.0, 6.0, x=0.0),
        _pick("B", "B1", 0.0, 6.0, x=10.0),
    ]
    sampler = _flat_sampler([("G-MID", -3.0)])
    out = divide_picks_by_geology(picks, sampler, snap_tolerance_m=0.2)

    # Each pick split into upper (0..3) and lower (3..6); upper halves share a
    # derived id, lower halves share a different derived id; no original id left.
    assert len(out) == 4
    body_ids = {p.body_id for p in out}
    assert "B1" not in body_ids
    assert len(body_ids) == 2  # one band-body above, one below
    # The two halves at A have different bodies but contiguous depths.
    a = sorted((p for p in out if p.investigation_id == "A"), key=lambda p: p.top_depth_m)
    assert (a[0].top_depth_m, a[0].base_depth_m) == (0.0, 3.0)
    assert (a[1].top_depth_m, a[1].base_depth_m) == (3.0, 6.0)
    assert a[0].body_id != a[1].body_id


def test_contact_within_tolerance_snaps_no_split():
    """A boundary within snap_tolerance of an existing contact causes a snap, not a cut."""
    # Boundary at -3; the pick's base contact is at -2.95 (within 0.2) -> SNAP,
    # no cut, body keeps its original id (single band).
    picks = [_pick("A", "B1", 0.0, 2.95)]
    sampler = _flat_sampler([("G-MID", -3.0)])
    out = divide_picks_by_geology(picks, sampler, snap_tolerance_m=0.2)
    assert len(out) == 1
    assert out[0].body_id == "B1"
    assert (out[0].top_depth_m, out[0].base_depth_m) == (0.0, 2.95)


def test_body_entirely_in_one_band_keeps_original_id():
    """A body that sits entirely within one geological band retains its original body_id."""
    # Boundary at -10; the body sits entirely above it.
    picks = [_pick("A", "B1", 0.0, 4.0)]
    sampler = _flat_sampler([("G-MID", -10.0)])
    out = divide_picks_by_geology(picks, sampler, snap_tolerance_m=0.2)
    assert len(out) == 1
    assert out[0].body_id == "B1"
