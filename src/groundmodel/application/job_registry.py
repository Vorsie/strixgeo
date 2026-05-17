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
3. ``JobRegistry.cancel(job_id)`` cancels the task and removes the entry.
   The import's on-disk XML cache entries written before cancellation are
   preserved (``DovXmlCache`` writes atomically per file; partial work is
   reusable on a future import).

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


class JobRegistry:
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
        Removes the entry when the sentinel is received or on disconnect.
    cancel(job_id) -> bool
        Cancel the background task.  Returns ``True`` if the job existed,
        ``False`` if it was already finished or never registered.
    """

    def __init__(self) -> None:
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
            The new job-id.  Pass to ``stream()`` or ``cancel()``.
        """
        job_id = uuid4()
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        coro = coro_factory(queue)
        task = asyncio.create_task(coro)
        self._jobs[job_id] = _JobEntry(task=task, queue=queue)
        return job_id

    async def stream(self, job_id: UUID) -> AsyncIterator[dict[str, Any]]:
        """Drain a job's event queue as an async generator.

        Yields each event dict in order.  Returns when the sentinel
        ``None`` is received (the task finished) or when the caller
        abandons the generator (SSE client disconnect).

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
        try:
            while True:
                event = await entry.queue.get()
                if event is None:
                    break
                yield event
        finally:
            # Clean up regardless of normal exit or client disconnect.
            self._jobs.pop(job_id, None)

    def cancel(self, job_id: UUID) -> bool:
        """Cancel a background task and remove it from the registry.

        Parameters
        ----------
        job_id : UUID
            Job-id to cancel.

        Returns
        -------
        bool
            ``True`` if the job existed and was cancelled (or already
            finished), ``False`` if no such job-id was registered.
        """
        entry = self._jobs.pop(job_id, None)
        if entry is None:
            return False
        entry.task.cancel()
        return True

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
