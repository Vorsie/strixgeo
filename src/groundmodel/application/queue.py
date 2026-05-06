"""Task queue abstraction and synchronous MVP implementation."""
from abc import ABC, abstractmethod
from uuid import UUID

from groundmodel.domain.models.job import Job


class TaskQueue(ABC):
    """Abstract task queue — submit jobs and query their status."""

    @abstractmethod
    async def enqueue(self, job: Job) -> None:
        """Submit a job for execution."""
        ...

    @abstractmethod
    async def get_status(self, job_id: UUID) -> Job:
        """Return the current state of job_id."""
        ...


class SynchronousQueue(TaskQueue):
    """MVP — runs jobs inline, no broker needed."""

    async def enqueue(self, job: Job) -> None:
        """Execute the job inline and await completion."""
        await self._execute(job)

    async def get_status(self, job_id: UUID) -> Job:
        """Not implemented — synchronous queue has no persistent state."""
        raise NotImplementedError

    async def _execute(self, job: Job) -> None:
        ...
