"""In-process job registry for long-running background import tasks.

The registry maps a job-id (UUID) to a live ``_JobEntry`` so an SSE
consumer endpoint can drain the event queue for an already-running import
without sharing a DB session with the spawning request.

Lifecycle
---------
1. The spawning endpoint calls ``JobRegistry.start(job_id, coro)`` — this
   creates an ``asyncio.Queue``, wraps the coroutine so its events land on
   the queue, starts an ``asyncio.Task``, and registers the entry.
2. The SSE consumer endpoint calls ``JobRegistry.stream(job_id)`` — this
   is an async generator that drains the queue until the sentinel ``None``
   is received, then removes the entry.
3. When the consumer abandons the stream early (SSE client abort) the
   registry cancels the task.  The import's on-disk XML cache entries
   written before cancellation are preserved (``DovXmlCache`` writes
   atomically per file; partial work is reusable on a future import).

Thread safety
-------------
The registry is a module-level singleton accessed only from asyncio
coroutines on the same event loop — no locking is needed.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class _JobEntry:
    """Internal bookkeeping for one background job.

    Attributes
    ----------
    task : asyncio.Task[None]
        The running background coroutine.
    queue : asyncio.Queue[dict[str, Any] | None]
        Event channel shared between the producer task and the SSE
        consumer.  ``None`` is the sentinel that signals stream end.
    """

    task: asyncio.Task[None]
    queue: asyncio.Queue[dict[str, Any] | None] = field(default_factory=asyncio.Queue)


class JobRegistry(GroundModelLogger):
    """In-process registry for background import jobs.

    A singleton instance is held at module level so any router function
    can resolve it via ``get_job_registry()``.

    Methods
    -------
    start(coro_factory) -> UUID
        Allocate a job-id, create a Queue, wrap the coroutine so it puts
        events on the queue, start the task, and return the job-id.
    stream(job_id) -> AsyncGenerator
        Drain the job's queue as an async generator of event dicts.
        Removes the entry when the sentinel is received or on disconnect;
        cancels the task when the consumer disconnected mid-stream.
    """

    def __init__(self) -> None:
        super().__init__(__name__)
        self._jobs: dict[UUID, _JobEntry] = {}

    def start(
        self,
        coro_factory: Any,  # Callable[asyncio.Queue, Coroutine]
    ) -> UUID:
        """Allocate a job-id, create the queue, and launch the background task.

        The caller supplies a *factory* (not a coroutine directly) so the
        queue can be created first and then threaded into the coroutine.

        Parameters
        ----------
        coro_factory : Callable[[asyncio.Queue], Coroutine[None]]
            A callable that accepts the queue and returns a coroutine that
            puts ``dict`` progress events + a terminal ``None`` sentinel on
            the queue when finished (success or error).

        Returns
        -------
        UUID
            The new job-id.  Pass to ``stream()``.
        """
        job_id = uuid4()
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        coro = coro_factory(queue)
        task = asyncio.create_task(coro)
        self._jobs[job_id] = _JobEntry(task=task, queue=queue)

        # Guard against a background coroutine that raises before enqueuing the
        # None sentinel: without this callback the SSE consumer would await
        # queue.get() forever (frozen progress bar, no error feedback).
        # The callback fires on the event loop after the task finishes, so it
        # always runs after the coro body — it only puts the sentinel when the
        # task raised (i.e. was not cancelled and did not finish cleanly).
        def _sentinel_on_exception(t: asyncio.Task[None]) -> None:
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

        task.add_done_callback(_sentinel_on_exception)
        return job_id

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
            # Consumer bailed early (SSE client abort) while the producer is
            # still running → cancel the import.  Gated on task-not-done so
            # the happy path where the client closes the stream right after
            # the final "done" event (task already finished, sentinel still
            # unread) never cancels a completed task.
            if not finished and not entry.task.done():
                entry.task.cancel()
                self.info(
                    f"job {job_id}: SSE consumer disconnected before the stream "
                    "finished — background task cancelled"
                )

    def __len__(self) -> int:
        """Return the number of currently registered jobs."""
        return len(self._jobs)


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
