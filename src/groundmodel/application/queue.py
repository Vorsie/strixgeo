from abc import ABC, abstractmethod
from uuid import UUID

from groundmodel.domain.models.job import Job


class TaskQueue(ABC):
    @abstractmethod
    async def enqueue(self, job: Job) -> None: ...

    @abstractmethod
    async def get_status(self, job_id: UUID) -> Job: ...


class SynchronousQueue(TaskQueue):
    """MVP — runs jobs inline, no broker needed."""

    async def enqueue(self, job: Job) -> None:
        await self._execute(job)

    async def get_status(self, job_id: UUID) -> Job:
        raise NotImplementedError

    async def _execute(self, job: Job) -> None:
        ...
