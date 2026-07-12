"""Job management API route handlers."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_job(
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> None:
    """Cancel a running background import job and clean up its registry entry.

    The cancellation is cooperative: ``asyncio.Task.cancel()`` is called,
    which raises ``CancelledError`` in the task at the next ``await``.
    Any XML files already written to the on-disk DOV cache are preserved
    so a subsequent import of the same bbox benefits from them.

    Parameters
    ----------
    job_id : UUID
        Job-id returned by the spawning endpoint
        (``POST /cpt/import-dov/stream`` or the borehole equivalent).

    Raises
    ------
    HTTPException(404)
        When no job with that id is registered (already finished and
        cleaned up, or never existed).
    """
    found = registry.cancel(job_id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active job with id {job_id}",
        )
    logger.info(f"Job {job_id} cancelled by client request")
