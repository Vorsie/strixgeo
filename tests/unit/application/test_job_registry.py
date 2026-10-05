"""Unit tests for JobRegistry — in-process background job bookkeeping."""

from __future__ import annotations

import asyncio
import threading
from uuid import uuid4

import pytest

from groundmodel.application.job_registry import (
    FINISHED_JOB_TTL_SECONDS,
    MAX_JOBS,
    JobRegistry,
    _BoundedJobQueue,
)
from groundmodel.shared.exceptions import DuplicateImportJobError

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


# ---------------------------------------------------------------------------
# Codex 5 — bounded event queue (drop-oldest progress, never the terminal)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bounded_queue_drops_oldest_progress_keeps_terminal() -> None:
    """A full queue drops the OLDEST progress events, never the terminal ones.

    Rule (Codex 5): a job's event queue is bounded (drop-oldest progress events,
    never the terminal event). The done dict + the None sentinel are the terminal
    events and must survive; the oldest progress ticks are the ones sacrificed.
    """
    q = _BoundedJobQueue(maxsize=4)
    for i in range(10):
        await q.put({"phase": "download", "done": i})
    await q.put({"type": "done", "imported": 3})
    await q.put(None)  # terminal sentinel

    drained: list = []
    while q.qsize() > 0:
        drained.append(await q.get())

    # Terminal events survive.
    assert None in drained
    assert {"type": "done", "imported": 3} in drained
    # The newest progress tick is kept, the oldest is gone.
    assert {"phase": "download", "done": 9} in drained
    assert {"phase": "download", "done": 0} not in drained
    # Bounded: no more than maxsize progress + the two terminal events.
    assert len(drained) <= 4 + 2


@pytest.mark.asyncio
async def test_bounded_queue_never_drops_the_sentinel_under_pressure() -> None:
    """Even when the sentinel is enqueued early, later puts never evict it."""
    q = _BoundedJobQueue(maxsize=2)
    await q.put(None)  # terminal arrives, then a flood of progress
    for i in range(10):
        await q.put({"done": i})
    drained: list = []
    while q.qsize() > 0:
        drained.append(await q.get())
    assert None in drained


# ---------------------------------------------------------------------------
# Codex 5 — no-consumer expiry with an injected clock
# ---------------------------------------------------------------------------


async def _settle() -> None:
    """Let a just-started task run to completion and its done-callback fire."""
    for _ in range(5):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_finished_job_with_no_consumer_expires_after_ttl() -> None:
    """A finished job nobody streamed is evicted once TTL elapses (fake clock).

    Rule (Codex 5): a finished job with no consumer expires after N minutes.
    """
    now = {"t": 1000.0}
    registry = JobRegistry(clock=lambda: now["t"])
    job_id = registry.start(_immediate_factory([{"type": "done"}]))
    await _settle()

    # Still registered right after finishing — no consumer has drained it.
    assert job_id in registry._jobs  # noqa: SLF001

    # Advance past the TTL and trigger a sweep by starting another job.
    now["t"] += FINISHED_JOB_TTL_SECONDS + 1
    registry.start(_immediate_factory([]))

    assert job_id not in registry._jobs  # noqa: SLF001


@pytest.mark.asyncio
async def test_finished_job_within_ttl_is_retained() -> None:
    """Before the TTL elapses a finished, unconsumed job is still retained."""
    now = {"t": 1000.0}
    registry = JobRegistry(clock=lambda: now["t"])
    job_id = registry.start(_immediate_factory([{"type": "done"}]))
    await _settle()

    now["t"] += FINISHED_JOB_TTL_SECONDS - 1  # not yet expired
    registry.start(_immediate_factory([]))

    assert job_id in registry._jobs  # noqa: SLF001


# ---------------------------------------------------------------------------
# Codex 5 — the registry never grows past M jobs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registry_never_grows_past_max_jobs() -> None:
    """Starting far more than MAX_JOBS jobs keeps the registry size capped.

    Rule (Codex 5): the registry never grows past M jobs per session.
    """
    registry = JobRegistry()
    for _ in range(MAX_JOBS + 25):
        registry.start(_immediate_factory([{"type": "done"}]))
        # never grows past the cap at any point
        assert len(registry) <= MAX_JOBS
    assert len(registry) <= MAX_JOBS


# ---------------------------------------------------------------------------
# Codex 4 — duplicate guard: same scope while running is refused with the id
# ---------------------------------------------------------------------------


def _blocking_factory() -> callable:
    """Return a factory whose coroutine emits one event then blocks forever."""

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            await queue.put({"phase": "wfs", "done": 0, "total": 1})
            await asyncio.sleep(3600)

        return run()

    return factory


@pytest.mark.asyncio
async def test_duplicate_key_while_running_is_refused_with_job_id() -> None:
    """A second start() with the same key while the first runs raises with its id.

    Rule (Codex 4): the same bbox submitted again while its import job is still
    running is refused with the running job id.
    """
    registry = JobRegistry()
    job_id = registry.start(_blocking_factory(), key="cpt:bbox-1")

    with pytest.raises(DuplicateImportJobError) as excinfo:
        registry.start(_blocking_factory(), key="cpt:bbox-1")
    assert excinfo.value.job_id == job_id

    # A different scope key is not blocked.
    other = registry.start(_blocking_factory(), key="cpt:bbox-2")
    assert other != job_id

    # Cleanup the blocking tasks.
    for entry in list(registry._jobs.values()):  # noqa: SLF001
        entry.task.cancel()


@pytest.mark.asyncio
async def test_same_key_allowed_again_once_prior_job_finished() -> None:
    """Once the first job for a key finishes, the same key may be started again."""
    registry = JobRegistry()
    job1 = registry.start(_immediate_factory([{"type": "done"}]), key="k")
    await _settle()

    job2 = registry.start(_immediate_factory([{"type": "done"}]), key="k")
    assert job2 != job1


# ---------------------------------------------------------------------------
# Cooperative cancel (debt #282 — the voxel build's Cancel button)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_request_cancel_sets_the_jobs_cancel_event() -> None:
    """A job started with a cancel_event has that event set by request_cancel().

    The Cancel button (``POST .../jobs/{id}/cancel``) reaches the running worker
    thread ONLY through this event — the CPU phases run in a thread Python cannot
    kill, so the flag is the whole cancel mechanism. ``request_cancel`` returns
    ``True`` to say a live job's flag was set.
    """
    registry = JobRegistry()
    cancel_event = threading.Event()
    job_id = registry.start(_blocking_factory(), cancel_event=cancel_event)

    assert cancel_event.is_set() is False
    assert registry.request_cancel(job_id) is True
    assert cancel_event.is_set() is True

    for entry in list(registry._jobs.values()):  # noqa: SLF001
        entry.task.cancel()


@pytest.mark.asyncio
async def test_request_cancel_unknown_job_returns_false() -> None:
    """Cancelling a job id that was never registered (or already finished) is a no-op."""
    registry = JobRegistry()
    assert registry.request_cancel(uuid4()) is False


@pytest.mark.asyncio
async def test_request_cancel_job_without_a_cancel_event_returns_false() -> None:
    """A job started without a cancel_event cannot be cancelled — returns False.

    The DOV import path passes no cancel_event; asking to cancel it must report
    honestly that there was nothing to set rather than pretending it worked.
    """
    registry = JobRegistry()
    job_id = registry.start(_blocking_factory())  # no cancel_event
    assert registry.request_cancel(job_id) is False

    for entry in list(registry._jobs.values()):  # noqa: SLF001
        entry.task.cancel()


@pytest.mark.asyncio
async def test_consumer_disconnect_sets_the_cooperative_cancel_flag() -> None:
    """Closing the dialog stops a worker thread too, not only the awaiting task.

    Owner finding 2026-10-05: the PDF triage kept OCR'ing page after page in its
    worker thread after "SSE consumer disconnected ... background task
    cancelled". Cancelling the asyncio task cannot stop a thread, so the
    disconnect path must also raise the job's cooperative cancel flag.
    """
    registry = JobRegistry()
    flag = threading.Event()

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            await queue.put({"phase": "classify", "done": 1, "total": 97})
            await asyncio.sleep(3600)

        return run()

    job_id = registry.start(factory, cancel_event=flag)
    stream = registry.stream(job_id)
    await stream.__anext__()
    await stream.aclose()
    assert flag.is_set()


@pytest.mark.asyncio
async def test_evicting_a_running_job_sets_its_cancel_flag() -> None:
    """A running job evicted at capacity stops its worker thread as well."""
    registry = JobRegistry()
    flag = threading.Event()

    def factory(queue: asyncio.Queue) -> object:
        async def run() -> None:
            await asyncio.sleep(3600)

        return run()

    job_id = registry.start(factory, cancel_event=flag)
    registry._evict(job_id, reason="test")  # noqa: SLF001
    assert flag.is_set()
