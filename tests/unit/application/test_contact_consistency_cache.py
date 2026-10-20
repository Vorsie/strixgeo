"""Always on, never blocking: first ask schedules, a later ask returns the result.

``asyncio_mode = "auto"`` (pyproject) runs the async tests without a marker.
"""

from __future__ import annotations

import asyncio
from collections.abc import Hashable, Sequence

from groundmodel.application.contact_consistency_cache import ContactConsistencyCache
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_observation import PickObservation


def _picks(n: int, shift: float = 0.0) -> tuple[PickObservation, ...]:
    return tuple(
        PickObservation(f"c{i}", f"i{i}", "cpt", f"T{i}", i * 50.0, 0.0, -4.0 + shift, 0.1)
        for i in range(n)
    )


class _CountingCompute:
    """Stand-in check that counts how often it ran."""

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, picks: Sequence[PickObservation]) -> FormationPickCheck:
        self.calls += 1
        return FormationPickCheck("checked", len(picks), None, 1.0, ())


async def _wait_ready(
    cache: ContactConsistencyCache, key: Hashable, picks: Sequence[PickObservation]
) -> FormationPickCheck:
    for _ in range(200):
        result = cache.lookup_or_schedule(key, picks)
        if result is not None:
            return result
        await asyncio.sleep(0.01)
    raise AssertionError("never became ready")


async def test_first_lookup_schedules_then_returns_the_result() -> None:
    """None while computing, then the result; one computation for unchanged picks."""
    compute = _CountingCompute()
    cache = ContactConsistencyCache(compute=compute)
    picks = _picks(8)
    assert cache.lookup_or_schedule(("m", "f"), picks) is None
    result = await _wait_ready(cache, ("m", "f"), picks)
    assert result.n_picks == 8
    assert cache.lookup_or_schedule(("m", "f"), picks) is result
    assert compute.calls == 1


async def test_a_changed_pick_recomputes() -> None:
    """Moving one pick invalidates the formation's result."""
    compute = _CountingCompute()
    cache = ContactConsistencyCache(compute=compute)
    await _wait_ready(cache, ("m", "f"), _picks(8))
    assert cache.lookup_or_schedule(("m", "f"), _picks(8, shift=0.5)) is None
    await _wait_ready(cache, ("m", "f"), _picks(8, shift=0.5))
    assert compute.calls == 2


async def test_too_few_picks_answer_at_once() -> None:
    """Below MIN_PICKS nothing is fitted, so there is nothing to wait for."""
    compute = _CountingCompute()
    cache = ContactConsistencyCache(compute=compute)
    assert cache.lookup_or_schedule(("m", "f"), _picks(3)) is not None
