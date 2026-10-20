"""The cache key changes when a pick moves and not when the order changes."""

from __future__ import annotations

from groundmodel.application.pick_observation_digest import pick_observation_digest
from groundmodel.domain.value_objects.pick_observation import PickObservation


def _pick(cid: str, z: float) -> PickObservation:
    return PickObservation(cid, cid, "cpt", cid, 0.0, 0.0, z, 0.10)


def test_order_does_not_matter_but_a_moved_pick_does() -> None:
    """Same picks in another order → same digest; one pick moved 1 cm → new digest."""
    a = pick_observation_digest([_pick("a", -4.0), _pick("b", -3.0)])
    b = pick_observation_digest([_pick("b", -3.0), _pick("a", -4.0)])
    c = pick_observation_digest([_pick("a", -4.01), _pick("b", -3.0)])
    assert a == b
    assert a != c
