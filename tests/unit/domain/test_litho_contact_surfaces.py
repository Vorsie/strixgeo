"""Unit tests for build_columns / LayerSpan (no DB, no I/O)."""

from __future__ import annotations

from groundmodel.domain.services.litho_contact_surfaces import build_columns
from groundmodel.domain.services.litho_solid_builder import BodyLayerPick


def _pick(inv, x, y, body, top_d, base_d, surf=0.0, fm="f"):
    return BodyLayerPick(
        investigation_id=inv,
        x_m=x,
        y_m=y,
        surface_elev_m=surf,
        body_id=body,
        formation_id=fm,
        top_depth_m=top_d,
        base_depth_m=base_d,
    )


def test_build_columns_sorts_shallow_to_deep_and_keeps_coords():
    """Single investigation: spans sorted shallowest-first; coords and elevations correct."""
    picks = [
        _pick("A", 1.0, 2.0, "CLAY", 4.0, 14.0),
        _pick("A", 1.0, 2.0, "SAND", 0.0, 4.0),  # shallower, given out of order
    ]
    columns, coords = build_columns(picks)
    assert coords["A"] == (1.0, 2.0)
    spans = columns["A"]
    assert [s.body_id for s in spans] == ["SAND", "CLAY"]  # shallow first
    # elevation = surface_elev - depth
    assert spans[0].top_elev == 0.0 and spans[0].base_elev == -4.0
    assert spans[1].top_elev == -4.0 and spans[1].base_elev == -14.0


def test_build_columns_groups_multiple_investigations_independently():
    """Two investigations produce two separate, correctly-sorted column lists."""
    picks = [
        _pick("A", 1.0, 2.0, "CLAY", 4.0, 14.0),
        _pick("A", 1.0, 2.0, "SAND", 0.0, 4.0),
        _pick("B", 5.0, 6.0, "PEAT", 2.0, 5.0),
        _pick("B", 5.0, 6.0, "SAND", 0.0, 2.0),
    ]
    columns, coords = build_columns(picks)

    # Both investigations present with correct coords
    assert set(columns.keys()) == {"A", "B"}
    assert coords["A"] == (1.0, 2.0)
    assert coords["B"] == (5.0, 6.0)

    # Investigation A: SAND (shallower) before CLAY (deeper)
    a_bodies = [s.body_id for s in columns["A"]]
    assert a_bodies == ["SAND", "CLAY"]

    # Investigation B: SAND (0–2 m) before PEAT (2–5 m), shallowest first
    b_bodies = [s.body_id for s in columns["B"]]
    assert b_bodies == ["SAND", "PEAT"]
    assert columns["B"][0].top_elev == 0.0 and columns["B"][0].base_elev == -2.0
    assert columns["B"][1].top_elev == -2.0 and columns["B"][1].base_elev == -5.0
