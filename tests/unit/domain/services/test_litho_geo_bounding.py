"""Unit tests for the shallow-test flag on the litho pick list.

The geology-CUTTING transform this module used to carry
(``divide_picks_by_geology``) was deleted on 2026-08-26 with the geological
wall it implemented — owner: *"just drop the wall everywhere, user wil have
to manually do it"*. Its eight tests went with it; the rule they encoded is
now pinned inversely, as "the machine never makes this cut", in
``tests/unit/application/test_geotech_no_geo_cut.py``.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import mark_and_truncate_shallow_tests


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


def test_shallow_test_keeps_all_picks_including_uncorrelated_deep():
    """A too-shallow test is flagged but KEEPS all its litho (owner directive 2026-06-25).

    A geological boundary is a TOP, so the deepest geological unit a test reaches
    owns everything from its top down to TD. Even an uncorrelated single-hole pick
    below the deepest correlated contact is kept — it is geo-assigned to the
    deepest unit by the builders' grouping pass, never dropped.
    """
    # Boundary at -6. SHALLOW reaches only -4 (above -6) -> marked, but kept.
    picks = [
        _pick("DEEP", "B1", 0.0, 8.0, x=10.0),  # deep partner — reaches -8, below the -6 floor
        _pick("SHALLOW", "B1", 0.0, 3.0),  # correlated
        _pick("SHALLOW", "B2", 3.0, 4.0),  # single-hole, below — now KEPT, not dropped
    ]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == ["SHALLOW"]
    kept = {(p.investigation_id, p.body_id) for p in result.picks}
    assert ("SHALLOW", "B1") in kept
    assert ("SHALLOW", "B2") in kept  # KEPT (was dropped before the 2026-06-25 fix)
    assert ("DEEP", "B1") in kept


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


def test_shallow_test_with_no_correlation_is_kept_and_marked():
    """A too-shallow test with only single-hole bodies is flagged but KEPT (not excluded).

    Owner directive 2026-06-25: its litho is real single-test data and belongs to
    the deepest geological unit it reaches — never dropped, only flagged.
    """
    picks = [_pick("SHALLOW", "B9", 0.0, 4.0)]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: -6.0)
    assert result.marked_investigation_ids == ["SHALLOW"]
    assert result.picks == picks  # kept, not excluded


def test_no_boundary_at_location_keeps_the_test():
    """When the sampler returns None (no geological surface at this location), keep the test."""
    picks = [_pick("EDGE", "B1", 0.0, 4.0)]
    result = mark_and_truncate_shallow_tests(picks, lambda x, y: None)
    assert result.marked_investigation_ids == []
    assert result.picks == picks
