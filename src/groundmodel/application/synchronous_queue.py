"""Synchronous (inline) task queue — MVP implementation, no broker required."""

from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.task_queue import TaskQueue
from groundmodel.domain.models.job import Job
from groundmodel.domain.models.job_status import JobStatus


class SynchronousQueue(TaskQueue):
    """MVP task queue — executes jobs inline, no broker or worker process needed.

    All work happens synchronously inside ``enqueue``, so the caller blocks until
    the job finishes.  This is intentional for Phase 2: it keeps the architecture
    queue-shaped (swappable for RQ or Celery later) without adding operational
    complexity before it is needed.

    When a real broker is introduced, replace this class with ``RQQueue`` or
    ``CeleryQueue`` — nothing outside this file changes.

    Parameters
    ----------
    session_factory:
        SQLAlchemy async session factory.  Each job execution opens its own
        session and commits independently, matching the one-session-per-use-case
        rule.
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        """Initialise with a session factory used to create per-job sessions."""
        super().__init__(__name__)
        self._session_factory = session_factory

    async def enqueue(self, job: Job) -> None:
        """Execute *job* inline and block until it completes.

        Parameters
        ----------
        job:
            Job to execute.  ``job.status``, ``job.result``, and
            ``job.finished_at`` are mutated in place.
        """
        job.status = JobStatus.RUNNING
        self.info(f"Starting job {job.id} type={job.type!r}")
        try:
            await self._execute(job)
            job.status = JobStatus.DONE
            self.success(f"Job {job.id} completed")
        except Exception as exc:
            job.status = JobStatus.FAILED
            job.result = {"error": str(exc)}
            self.error(f"Job {job.id} failed: {exc}")
            raise

    async def get_status(self, job_id: UUID) -> Job:
        """Not implemented — synchronous queue has no persistent job store."""
        raise NotImplementedError(
            "SynchronousQueue has no persistent state. "
            "Job results are returned directly from enqueue()."
        )

    async def _execute(self, job: Job) -> None:
        """Dispatch to the correct use case based on ``job.type``."""
        if job.type == "import_cpt":
            await self._run_import_cpt(job)
        else:
            raise ValueError(f"Unknown job type: {job.type!r}")

    async def _run_import_cpt(self, job: Job) -> None:
        """Execute an import_cpt job.

        Expects ``job.payload["file_path"]`` to be an absolute path string
        pointing to a GEF file that still exists on disk.
        """
        file_path = Path(job.payload["file_path"])
        async with self._session_factory() as session:
            result = await ImportCpt(session).execute(file_path)
        job.result = {"cpt_id": str(result.cpt_id)}
