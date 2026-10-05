"""In-process job registry for long-running background import tasks.

The registry maps a job-id (UUID) to a live ``_JobEntry`` so an SSE
consumer endpoint can drain the event queue for an already-running import
without sharing a DB session with the spawning request.

Lifecycle
---------
1. The spawning endpoint calls ``JobRegistry.start(coro_factory, key=...)`` —
   this creates a bounded event queue, wraps the coroutine so its events land
   on the queue, starts an ``asyncio.Task``, and registers the entry. When a
   ``key`` (a de-duplication scope, e.g. resource-kind + bbox + project) is
   supplied and a job with that key is still running, ``start`` refuses with
   :class:`DuplicateImportJobError` carrying the running job-id.
2. The SSE consumer endpoint calls ``JobRegistry.stream(job_id)`` — this
   is an async generator that drains the queue until the sentinel ``None``
   is received, then removes the entry.
3. When the consumer abandons the stream early (SSE client abort) the
   registry cancels the task.  The import's on-disk XML cache entries
   written before cancellation are preserved (``DovXmlCache`` writes
   atomically per file; partial work is reusable on a future import).

Resource bounds (audit — Codex 5)
---------------------------------
Three unbounded-growth holes are closed here:

* **Per-job event queue** — a consumer that never attaches (or a slow one)
  used to let progress events accumulate without limit. The queue is now a
  :class:`_BoundedJobQueue` that keeps at most ``MAX_JOB_EVENTS`` events by
  dropping the OLDEST progress events; the terminal ``None`` sentinel and the
  final done/error event are never dropped (they are always the newest).
* **Finished-but-unconsumed jobs** — a job whose SSE stream never attaches used
  to sit in the registry forever. Each finished job records ``finished_at`` and
  is swept out ``FINISHED_JOB_TTL_SECONDS`` after finishing if no consumer ever
  drained it. Within that window a late consumer still gets the bounded terminal
  summary the queue retained.
* **Total job count** — the registry never grows past ``MAX_JOBS`` entries; on a
  new ``start`` it evicts the oldest finished (else oldest) entry to stay under
  the cap.

Thread safety
-------------
The registry is a module-level singleton accessed only from asyncio
coroutines on the same event loop — no locking is needed.
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from groundmodel.shared.exceptions import DuplicateImportJobError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Maximum events buffered per job. A progress bar only needs the LATEST tick, so
# dropping the oldest progress events under pressure loses nothing a consumer
# cares about; 256 leaves ample room for the pins event + a long tail of ticks
# while still bounding a never-consumed job's memory to a few dozen KB.
MAX_JOB_EVENTS = 256

# Seconds a FINISHED job with no consumer is retained before the registry sweeps
# it. The renderer attaches its SSE stream within ~1 s of the 202, so a finish
# with no consumer this long after is abnormal (a crashed/closed client); 5
# minutes is a generous reconnect window before eviction.
FINISHED_JOB_TTL_SECONDS = 300.0

# Hard cap on registered jobs per process. A single-user desktop runs one import
# at a time; dozens of live entries means a leak. On a new start the registry
# evicts the oldest finished (else oldest) entry to stay at or under this.
MAX_JOBS = 64


class _BoundedJobQueue:
    """A never-blocking, bounded FIFO event channel for one job.

    Backs the producer -> SSE-consumer handoff. Unlike ``asyncio.Queue`` a
    ``put`` never blocks the producer (the import task must not stall on an
    absent/slow consumer): when the buffer is full a new progress event evicts
    the OLDEST buffered event to make room. The terminal ``None`` sentinel is
    never evicted and never blocks — a full buffer still accepts it.

    Parameters
    ----------
    maxsize : int
        Maximum number of buffered events before drop-oldest kicks in for a
        non-terminal ``put``.
    """

    def __init__(self, maxsize: int) -> None:
        """Initialise an empty bounded queue with the given cap."""
        self._q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._maxsize = maxsize
        # Count of events dropped to stay under the cap — a diagnostic hook so a
        # test (and, if ever needed, a log line) can prove eviction happened.
        self.dropped = 0

    def _make_room(self, item: dict[str, Any] | None) -> None:
        """Evict oldest droppable events until there is room for *item*.

        The terminal sentinel (``None``) is never evicted and never triggers an
        eviction — a full buffer always has room for it. When evicting to make
        room for a progress event, an already-queued sentinel encountered at the
        front is put back rather than dropped (belt and braces; the sentinel is
        normally the last item enqueued and so never reached here).
        """
        if item is None:
            return
        while self._q.qsize() >= self._maxsize:
            try:
                oldest = self._q.get_nowait()
            except asyncio.QueueEmpty:
                return
            if oldest is None:
                # Never drop a terminal sentinel — return it and stop evicting.
                self._q.put_nowait(oldest)
                return
            self.dropped += 1

    async def put(self, item: dict[str, Any] | None) -> None:
        """Enqueue *item*, evicting oldest progress events if the buffer is full."""
        self._make_room(item)
        self._q.put_nowait(item)

    def put_nowait(self, item: dict[str, Any] | None) -> None:
        """Synchronous enqueue used by the done-callback's sentinel injection."""
        self._make_room(item)
        self._q.put_nowait(item)

    async def get(self) -> dict[str, Any] | None:
        """Await and return the next event (or the ``None`` sentinel)."""
        return await self._q.get()

    def qsize(self) -> int:
        """Return the number of currently buffered events."""
        return self._q.qsize()


@dataclass
class _JobEntry:
    """Internal bookkeeping for one background job.

    Attributes
    ----------
    task : asyncio.Task[None]
        The running background coroutine.
    queue : _BoundedJobQueue
        Bounded event channel shared between the producer task and the SSE
        consumer.  ``None`` is the sentinel that signals stream end.
    key : str | None
        De-duplication scope key (resource-kind + bbox + project). ``None`` for
        jobs that opt out of the duplicate guard.
    created_at : float
        Registry clock reading when the job was registered (eviction ordering).
    finished_at : float | None
        Registry clock reading when the task completed; ``None`` while running.
    consumed : bool
        Set once an SSE consumer attaches to ``stream()``. Only jobs that were
        never consumed are subject to the finished-job TTL sweep.
    cancel_event : threading.Event | None
        Cooperative-cancel flag for a job whose work runs in a worker thread
        (the voxel build's CPU phases). ``request_cancel`` sets it; the worker
        checks it between columns and phases. ``None`` for jobs that cannot be
        cancelled (e.g. the DOV import path, which is stopped by disconnecting
        the SSE stream instead). A ``threading.Event`` rather than an asyncio
        one because the reader lives on a different thread from the setter.
    """

    task: asyncio.Task[None]
    queue: _BoundedJobQueue
    key: str | None = None
    created_at: float = 0.0
    finished_at: float | None = None
    consumed: bool = field(default=False)
    cancel_event: threading.Event | None = None


class JobRegistry(GroundModelLogger):
    """In-process registry for background import jobs.

    A singleton instance is held at module level so any router function
    can resolve it via ``get_job_registry()``.

    Parameters
    ----------
    clock : Callable[[], float]
        Monotonic time source, injectable so tests can drive the finished-job
        TTL sweep with a fake clock. Defaults to ``time.monotonic``.

    Methods
    -------
    start(coro_factory, key=None) -> UUID
        Allocate a job-id, create a bounded Queue, wrap the coroutine so it puts
        events on the queue, start the task, and return the job-id. Refuses a
        duplicate ``key`` that is still running.
    stream(job_id) -> AsyncGenerator
        Drain the job's queue as an async generator of event dicts.
        Removes the entry when the sentinel is received or on disconnect;
        cancels the task when the consumer disconnected mid-stream.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        """Initialise an empty registry with the given time source."""
        super().__init__(__name__)
        self._jobs: dict[UUID, _JobEntry] = {}
        # Reverse index: active de-dup key -> job-id. Kept in step with
        # ``_jobs`` — a key is removed the moment its job finishes or is evicted.
        self._active_keys: dict[str, UUID] = {}
        self._clock = clock

    def start(
        self,
        coro_factory: Any,  # Callable[asyncio.Queue, Coroutine]
        *,
        key: str | None = None,
        cancel_event: threading.Event | None = None,
    ) -> UUID:
        """Allocate a job-id, create the queue, and launch the background task.

        The caller supplies a *factory* (not a coroutine directly) so the
        queue can be created first and then threaded into the coroutine.

        Parameters
        ----------
        coro_factory : Callable[[_BoundedJobQueue], Coroutine[None]]
            A callable that accepts the queue and returns a coroutine that
            puts ``dict`` progress events + a terminal ``None`` sentinel on
            the queue when finished (success or error).
        key : str | None
            Optional de-duplication scope. When supplied and a job with the same
            key is still running, this raises :class:`DuplicateImportJobError`
            instead of starting a second identical import.
        cancel_event : threading.Event | None
            Optional cooperative-cancel flag stored on the entry so
            :meth:`request_cancel` can set it. The caller both passes it here AND
            wires its ``.is_set`` into the worker (e.g. the voxel build's
            ``should_cancel``). ``None`` (the default) makes the job
            un-cancellable — the DOV import path, which is stopped by
            disconnecting its SSE stream, passes none.

        Returns
        -------
        UUID
            The new job-id.  Pass to ``stream()``.

        Raises
        ------
        DuplicateImportJobError
            When ``key`` names a scope whose import job is still running.
        """
        # Sweep expired finished jobs first so a stale key or a full registry
        # doesn't refuse/evict a live job in favour of a dead one.
        self._sweep_expired()

        if key is not None:
            existing = self._active_keys.get(key)
            if existing is not None:
                entry = self._jobs.get(existing)
                if entry is not None and not entry.task.done():
                    # Still running — refuse and hand back the running job-id so
                    # the caller can attach to the existing stream.
                    raise DuplicateImportJobError(existing)
                # Stale mapping (job finished or was evicted) — drop it.
                self._active_keys.pop(key, None)

        self._enforce_job_cap()

        job_id = uuid4()
        queue = _BoundedJobQueue(MAX_JOB_EVENTS)
        coro = coro_factory(queue)
        task = asyncio.create_task(coro)
        self._jobs[job_id] = _JobEntry(
            task=task,
            queue=queue,
            key=key,
            created_at=self._clock(),
            cancel_event=cancel_event,
        )
        if key is not None:
            self._active_keys[key] = job_id

        # Fires on the event loop after the task finishes (success, error, or
        # cancel). It stamps ``finished_at`` for the TTL sweep, releases the
        # de-dup key so a re-submit of the same scope is allowed once done, and
        # — for a task that raised before enqueuing the sentinel — injects the
        # ``None`` sentinel so the SSE consumer is not left awaiting forever.
        def _on_done(t: asyncio.Task[None]) -> None:
            entry = self._jobs.get(job_id)
            if entry is not None:
                entry.finished_at = self._clock()
            if key is not None and self._active_keys.get(key) == job_id:
                self._active_keys.pop(key, None)
            if t.cancelled():
                # CancelledError is expected; the disconnect path removes the entry.
                return
            exc = t.exception()
            if exc is not None:
                self.error(
                    f"background job {job_id} raised an unhandled exception — "
                    f"enqueuing sentinel so the SSE consumer is not left hanging: "
                    f"{type(exc).__name__}: {exc}"
                )
                queue.put_nowait(None)

        task.add_done_callback(_on_done)
        return job_id

    def request_cancel(self, job_id: UUID) -> bool:
        """Set a running job's cooperative-cancel flag.

        The worker thread (the voxel build's CPU phases) cannot be forcibly
        killed, so this is the ONLY way to stop it: it sets the
        :class:`threading.Event` the worker polls between columns and phases.
        The worker then raises ``BuildCancelled``, the use case rolls back, and
        the background coroutine emits a terminal ``build_cancelled`` event.

        Best-effort and idempotent: cancelling an unknown / already-finished job,
        or one with no cancel flag (e.g. a DOV import), is a no-op that returns
        ``False`` rather than raising, so a double-click on Cancel is harmless.

        Parameters
        ----------
        job_id : UUID
            The job to cancel (as returned by ``start()``).

        Returns
        -------
        bool
            ``True`` when a live job's cancel flag was set; ``False`` when no
            such job exists or it carries no cancel flag.
        """
        entry = self._jobs.get(job_id)
        if entry is None or entry.cancel_event is None:
            self.info(f"job {job_id}: cancel requested but no cancellable job found")
            return False
        entry.cancel_event.set()
        self.info(f"job {job_id}: cancel requested — cooperative flag set")
        return True

    def _sweep_expired(self) -> None:
        """Evict finished, never-consumed jobs older than the TTL.

        A job whose SSE stream never attached would otherwise sit in the
        registry forever. Only jobs that finished AND were never consumed are
        swept — a consumed job is removed by ``stream()`` itself on completion
        or disconnect.
        """
        now = self._clock()
        expired = [
            jid
            for jid, e in self._jobs.items()
            if e.finished_at is not None
            and not e.consumed
            and (now - e.finished_at) > FINISHED_JOB_TTL_SECONDS
        ]
        for jid in expired:
            self._evict(
                jid, reason=f"no consumer within {FINISHED_JOB_TTL_SECONDS:.0f}s of finishing"
            )

    def _enforce_job_cap(self) -> None:
        """Evict oldest entries until the registry has room below ``MAX_JOBS``.

        Called before registering a new job so the registry never grows past the
        cap. Finished entries are preferred as victims (their work is done);
        only when all entries are still running is the oldest running one
        cancelled and evicted — a last-resort guard against an unbounded leak.
        """
        while len(self._jobs) >= MAX_JOBS:
            victim = self._pick_eviction_victim()
            if victim is None:
                return
            self._evict(victim, reason="registry at capacity")

    def _pick_eviction_victim(self) -> UUID | None:
        """Return the id of the best entry to evict, or ``None`` when empty.

        Prefers the oldest FINISHED entry; falls back to the oldest entry of any
        kind when none has finished.
        """
        if not self._jobs:
            return None
        finished = [(jid, e) for jid, e in self._jobs.items() if e.finished_at is not None]
        pool = finished or list(self._jobs.items())
        return min(pool, key=lambda pair: pair[1].created_at)[0]

    def _evict(self, job_id: UUID, *, reason: str) -> None:
        """Remove a job, cancelling its task if still running, releasing its key."""
        entry = self._jobs.pop(job_id, None)
        if entry is None:
            return
        if entry.key is not None and self._active_keys.get(entry.key) == job_id:
            self._active_keys.pop(entry.key, None)
        if not entry.task.done():
            entry.task.cancel()
            _raise_cancel_flag(entry)
        self.info(f"job {job_id}: evicted ({reason})")

    async def stream(self, job_id: UUID) -> AsyncIterator[dict[str, Any]]:
        """Drain a job's event queue as an async generator.

        Yields each event dict in order.  Returns when the sentinel
        ``None`` is received (the task finished) or when the caller
        abandons the generator (SSE client disconnect).  On the disconnect
        path the still-running background task is CANCELLED — an abandoned
        stream must not leave a ~60 s cold-cache import running to
        completion server-side (#237.3).  XML files already written to the
        on-disk DOV cache are preserved, so a re-import is cache-warm.

        Parameters
        ----------
        job_id : UUID
            Job-id returned by ``start()``.

        Yields
        ------
        dict[str, Any]
            Progress event dicts (same shapes as the inline SSE generator).

        Raises
        ------
        KeyError
            If no job with that id exists.
        """
        entry = self._jobs[job_id]
        # Mark consumed so the finished-job TTL sweep never targets it — a
        # consumed job is cleaned up by this generator's own finally block.
        entry.consumed = True
        finished = False
        try:
            while True:
                event = await entry.queue.get()
                if event is None:
                    finished = True
                    break
                yield event
        finally:
            # Clean up regardless of normal exit or client disconnect.
            self._jobs.pop(job_id, None)
            if entry.key is not None and self._active_keys.get(entry.key) == job_id:
                self._active_keys.pop(entry.key, None)
            # Consumer bailed early (SSE client abort) while the producer is
            # still running → cancel the import.  Gated on task-not-done so
            # the happy path where the client closes the stream right after
            # the final "done" event (task already finished, sentinel still
            # unread) never cancels a completed task.
            if not finished and not entry.task.done():
                entry.task.cancel()
                # Cancelling the task does not stop a worker thread it awaits
                # (the PDF triage OCR'd on for minutes after the dialog closed,
                # owner's log 2026-10-05): raise the cooperative flag as well.
                flagged = _raise_cancel_flag(entry)
                self.info(
                    f"job {job_id}: SSE consumer disconnected before the stream "
                    "finished — background task cancelled"
                    + (", worker stop flag raised" if flagged else "")
                )

    def __len__(self) -> int:
        """Return the number of currently registered jobs."""
        return len(self._jobs)


def _raise_cancel_flag(entry: _JobEntry) -> bool:
    """Set a job's cooperative cancel flag, when it has one; return whether it did."""
    if entry.cancel_event is None:
        return False
    entry.cancel_event.set()
    return True


# Module-level singleton — shared by all router functions on the same
# event loop.  A new instance per process; tests that need isolation
# replace it via dependency override.
_registry = JobRegistry()


def get_job_registry() -> JobRegistry:
    """Return the module-level ``JobRegistry`` singleton.

    Provided as a FastAPI dependency via ``Depends(get_job_registry)``.

    Returns
    -------
    JobRegistry
        The shared in-process registry.
    """
    return _registry
