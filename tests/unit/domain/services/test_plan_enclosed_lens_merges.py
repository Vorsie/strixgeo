"""Unit tests for the enclosed-lens merge planner."""

from __future__ import annotations

from uuid import UUID, uuid4

from groundmodel.domain.services.plan_enclosed_lens_merges import (
    MergeLayer,
    plan_enclosed_lens_merges,
)


def _layer(inv: UUID, top: float, base: float, soil: str) -> MergeLayer:
    return MergeLayer(layer_id=uuid4(), inv_id=inv, top_elev=top, base_elev=base, soil=soil)


def test_silt_lens_absent_on_neighbour_merges_both_host_sands() -> None:
    """A sand split by a silt that is ABSENT on the neighbour → both sand halves
    correlate to the neighbour's continuous sand (a true pinch-out)."""
    s1, b4 = uuid4(), uuid4()
    sand_top = _layer(s1, 8, 2, "ZAND")
    silt = _layer(s1, 2, 1, "SILT")  # the lens
    sand_bot = _layer(s1, 1, -4, "ZAND")
    b4_sand = _layer(b4, 7, -5, "ZAND")  # continuous, silt absent
    stacks = {s1: [sand_top, silt, sand_bot], b4: [b4_sand]}
    along = {s1: 0.0, b4: 1.0}

    edges = plan_enclosed_lens_merges(stacks, along)

    pairs = {(e.host_layer_id, e.neighbour_layer_id) for e in edges}
    assert pairs == {
        (sand_top.layer_id, b4_sand.layer_id),
        (sand_bot.layer_id, b4_sand.layer_id),
    }


def test_lens_present_on_neighbour_is_not_merged() -> None:
    """A clay present on the neighbour over the lens band is a continuous
    interbed, NOT a pinch — the bracketing sands must stay separate."""
    s1, b4 = uuid4(), uuid4()
    stacks = {
        s1: [_layer(s1, 8, 2, "ZAND"), _layer(s1, 2, 1, "KLEI"), _layer(s1, 1, -4, "ZAND")],
        b4: [
            _layer(b4, 7, 2, "ZAND"),
            _layer(b4, 2, 1, "KLEI"),  # clay present here → continuous interbed
            _layer(b4, 1, -5, "ZAND"),
        ],
    }
    along = {s1: 0.0, b4: 1.0}

    assert plan_enclosed_lens_merges(stacks, along) == []


def test_two_lenses_chain_all_three_sand_halves_to_one_body() -> None:
    """sand · clay · sand · silt · sand with both lenses absent on the neighbour
    → all three sand halves correlate to the neighbour's continuous sand."""
    s1, b4 = uuid4(), uuid4()
    sand0 = _layer(s1, 10, 5, "ZAND")
    clay = _layer(s1, 5, 4, "KLEI")
    sand2 = _layer(s1, 4, 2, "ZAND")
    silt = _layer(s1, 2, 1, "SILT")
    sand4 = _layer(s1, 1, -3, "ZAND")
    b4_sand = _layer(b4, 9, -4, "ZAND")
    stacks = {s1: [sand0, clay, sand2, silt, sand4], b4: [b4_sand]}
    along = {s1: 0.0, b4: 1.0}

    edges = plan_enclosed_lens_merges(stacks, along)

    hosts = {e.host_layer_id for e in edges}
    assert hosts == {sand0.layer_id, sand2.layer_id, sand4.layer_id}
    assert all(e.neighbour_layer_id == b4_sand.layer_id for e in edges)


def test_no_enclosed_lens_plans_nothing() -> None:
    """A plain sand-over-clay stack has no host·lens·host triple → no edges."""
    s1, b4 = uuid4(), uuid4()
    stacks = {
        s1: [_layer(s1, 8, 2, "ZAND"), _layer(s1, 2, -4, "KLEI")],
        b4: [_layer(b4, 7, 2, "ZAND"), _layer(b4, 2, -5, "KLEI")],
    }
    along = {s1: 0.0, b4: 1.0}

    assert plan_enclosed_lens_merges(stacks, along) == []
