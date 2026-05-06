"""Synchronous (inline) task queue — MVP implementation, no broker required."""
from uuid import UUID

from groundmodel.application.task_queue import TaskQueue
from groundmodel.domain.models.job import Job


class SynchronousQueue(TaskQueue):
    """MVP — runs jobs inline, no broker needed."""

    def __init__(self) -> None:
        super().__init__(__name__)

    async def enqueue(self, job: Job) -> None:
        """Execute the job inline and await completion."""
        await self._execute(job)

    async def get_status(self, job_id: UUID) -> Job:
        """Not implemented — synchronous queue has no persistent state."""
        raise NotImplementedError

    async def _execute(self, job: Job) -> None:
        ...
