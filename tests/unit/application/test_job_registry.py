"""Unit tests for JobRegistry — in-process background job bookkeeping."""

from __future__ import annotations

import asyncio

import pytest

from groundmodel.application.job_registry import JobRegistry

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _immediate_factory(events: list[dict]) -> callable:
    """Return a factory that puts *events* on the queue then signals done."""

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            for ev in events:
                await queue.put(ev)
            await queue.put(None)  # sentinel

        return run()

    return factory


def _blocking_factory() -> callable:
    """Return a factory whose coroutine sleeps until cancelled."""

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                await queue.put(None)
                raise

        return run()

    return factory


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_returns_uuid_and_registers_job() -> None:
    """start() returns a UUID and the job appears in the registry."""
    registry = JobRegistry()
    job_id = registry.start(_immediate_factory([]))
    assert job_id in registry._jobs  # noqa: SLF001
    assert len(registry) == 1


@pytest.mark.asyncio
async def test_stream_yields_events_in_order() -> None:
    """stream() yields all event dicts in insertion order."""
    registry = JobRegistry()
    events = [{"phase": "wfs", "done": 0, "total": 5}, {"type": "done", "imported": 3}]
    job_id = registry.start(_immediate_factory(events))

    collected: list[dict] = []
    async for ev in registry.stream(job_id):
        collected.append(ev)

    assert collected == events


@pytest.mark.asyncio
async def test_stream_removes_entry_on_completion() -> None:
    """stream() removes the job entry after the sentinel is consumed."""
    registry = JobRegistry()
    job_id = registry.start(_immediate_factory([{"type": "done"}]))

    async for _ in registry.stream(job_id):
        pass

    assert job_id not in registry._jobs  # noqa: SLF001
    assert len(registry) == 0


@pytest.mark.asyncio
async def test_cancel_returns_true_for_known_job() -> None:
    """cancel() returns True and removes the entry for a registered job."""
    registry = JobRegistry()
    job_id = registry.start(_blocking_factory())
    # Give the task a moment to start.
    await asyncio.sleep(0)

    found = registry.cancel(job_id)

    assert found is True
    assert job_id not in registry._jobs  # noqa: SLF001


@pytest.mark.asyncio
async def test_cancel_returns_false_for_unknown_job() -> None:
    """cancel() returns False when the job-id is not registered."""
    import uuid

    registry = JobRegistry()
    found = registry.cancel(uuid.uuid4())
    assert found is False


@pytest.mark.asyncio
async def test_stream_raises_key_error_for_unknown_job() -> None:
    """stream() raises KeyError when no job is registered for the id."""
    import uuid

    registry = JobRegistry()
    with pytest.raises(KeyError):
        async for _ in registry.stream(uuid.uuid4()):
            pass


@pytest.mark.asyncio
async def test_multiple_jobs_are_independent() -> None:
    """Two jobs run concurrently and each streams its own events."""
    registry = JobRegistry()
    id1 = registry.start(_immediate_factory([{"n": 1}]))
    id2 = registry.start(_immediate_factory([{"n": 2}, {"n": 3}]))

    out1: list[dict] = []
    async for ev in registry.stream(id1):
        out1.append(ev)

    out2: list[dict] = []
    async for ev in registry.stream(id2):
        out2.append(ev)

    assert out1 == [{"n": 1}]
    assert out2 == [{"n": 2}, {"n": 3}]
    assert len(registry) == 0
