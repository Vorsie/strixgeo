"""Abstract task queue interface."""

from abc import ABC, abstractmethod
from uuid import UUID

from groundmodel.domain.models.job import Job
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class TaskQueue(GroundModelLogger, ABC):
    """Abstract task queue — submit jobs and query their status."""

    @abstractmethod
    async def enqueue(self, job: Job) -> None:
        """Submit a job for execution."""
        ...

    @abstractmethod
    async def get_status(self, job_id: UUID) -> Job:
        """Return the current state of job_id."""
        ...
