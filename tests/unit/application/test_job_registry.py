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


@pytest.mark.asyncio
async def test_consumer_disconnect_cancels_running_task() -> None:
    """Abandoning the stream mid-import cancels the background task.

    Rule (#237.3): when the SSE consumer disconnects before the stream is
    finished, the import must NOT keep running to completion server-side —
    the registry cancels the job's task on the disconnect path.
    """
    registry = JobRegistry()
    cancelled = asyncio.Event()

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            try:
                await queue.put({"phase": "wfs", "done": 0, "total": 5})
                await asyncio.sleep(3600)  # the long-running import body
            except asyncio.CancelledError:
                cancelled.set()
                raise

        return run()

    job_id = registry.start(factory)

    stream = registry.stream(job_id)
    first = await stream.__anext__()
    assert first == {"phase": "wfs", "done": 0, "total": 5}

    # Consumer bails early — aclose() throws GeneratorExit into the
    # generator at its suspension point, the same path an SSE client
    # abort takes through StreamingResponse.
    await stream.aclose()

    # The still-running task must be cancelled, not left running.
    await asyncio.wait_for(cancelled.wait(), timeout=1.0)
    assert job_id not in registry._jobs  # noqa: SLF001


@pytest.mark.asyncio
async def test_normal_completion_does_not_cancel_task() -> None:
    """Draining the stream to the sentinel leaves the finished task alone.

    Rule (#237.3): the disconnect-cancel must not fire on the happy path —
    the stream ended because the task itself completed (sentinel received),
    so no cancellation is issued.
    """
    registry = JobRegistry()
    tasks: list[asyncio.Task] = []

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            tasks.append(asyncio.current_task())
            await queue.put({"type": "done", "imported": 1})
            await queue.put(None)  # sentinel

        return run()

    job_id = registry.start(factory)

    collected: list[dict] = []
    async for ev in registry.stream(job_id):
        collected.append(ev)

    # Let the task run to completion after the sentinel was consumed.
    await asyncio.sleep(0)

    assert collected == [{"type": "done", "imported": 1}]
    assert tasks[0].done()
    assert tasks[0].cancelled() is False


def _raising_factory(exc: Exception) -> callable:
    """Return a factory whose coroutine raises *exc* without emitting a sentinel."""

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            # Intentionally raises without putting None on the queue.
            raise exc

        return run()

    return factory


@pytest.mark.asyncio
async def test_stream_does_not_hang_when_background_coro_raises() -> None:
    """A background coroutine that raises must still deliver the None sentinel.

    If the task raises before enqueuing None, a consumer awaiting queue.get()
    would block forever — the done-callback must guarantee sentinel delivery
    regardless of whether the task succeeds or fails.

    We assert "does not hang" by wrapping stream() in asyncio.wait_for with a
    short timeout: if it does not complete within 1 second, the test fails with
    TimeoutError rather than blocking the suite indefinitely.
    """
    registry = JobRegistry()
    job_id = registry.start(_raising_factory(RuntimeError("boom")))

    # Allow the task to run and raise before streaming.
    await asyncio.sleep(0)

    collected: list[dict] = []

    async def drain() -> None:
        async for ev in registry.stream(job_id):
            collected.append(ev)

    # Must resolve (sentinel received) within 1 second — hangs indefinitely
    # without the done-callback fix.
    await asyncio.wait_for(drain(), timeout=1.0)

    # No events were emitted before the raise, so the stream is empty.
    assert collected == []
