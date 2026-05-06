"""Job management API route handlers."""

from __future__ import annotations

import tempfile
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel

from groundmodel.application.synchronous_queue import SynchronousQueue
from groundmodel.domain.models.job import Job
from groundmodel.infrastructure.db.session import get_queue

router = APIRouter(prefix="/jobs", tags=["jobs"])


class ImportCptJobResponse(BaseModel):
    """Response returned by POST /jobs/import-cpt.

    Parameters
    ----------
    job_id:
        UUID of the created job.
    job_status:
        Final status of the job (always ``DONE`` for the synchronous queue).
    cpt_id:
        UUID of the imported CPT, present when ``job_status`` is ``DONE``.
    error:
        Error message when ``job_status`` is ``FAILED``.
    """

    job_id: UUID
    job_status: str
    cpt_id: UUID | None = None
    error: str | None = None


@router.post(
    "/import-cpt",
    response_model=ImportCptJobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_cpt_job(
    file: UploadFile,
    queue: SynchronousQueue = Depends(get_queue),
) -> ImportCptJobResponse:
    """Enqueue a CPT import job and return once it completes.

    With ``SynchronousQueue``, the job executes inline and the response carries
    the final result.  When the queue is swapped for an async broker, this
    endpoint will return immediately with ``job_status=PENDING`` and the caller
    should poll ``GET /jobs/{job_id}``.

    Parameters
    ----------
    file:
        Uploaded CPT file.  GEF format is supported in Phase 2.
    queue:
        Task queue injected by FastAPI dependency injection.

    Returns
    -------
    ImportCptJobResponse
        Job ID, final status, and the UUID of the created CPT.

    Raises
    ------
    HTTPException(400)
        When the file extension is not supported.
    HTTPException(500)
        When the job fails during execution.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".gef"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Supported: .gef",
        )

    content = await file.read()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    job = Job(type="import_cpt", payload={"file_path": str(tmp_path)})

    try:
        await queue.enqueue(job)
    finally:
        tmp_path.unlink(missing_ok=True)

    if job.status.value == "FAILED":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=job.result.get("error", "Job failed") if job.result else "Job failed",
        )

    cpt_id = UUID(job.result["cpt_id"]) if job.result else None
    return ImportCptJobResponse(
        job_id=job.id,
        job_status=job.status.value,
        cpt_id=cpt_id,
    )


@router.get("/{job_id}", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def get_job_status(job_id: UUID) -> None:
    """Return the current status of a job.

    Not implemented for ``SynchronousQueue`` — jobs complete synchronously
    and have no persistent state.  Will be implemented when an async broker
    is introduced.

    Raises
    ------
    HTTPException(501)
        Always, until a persistent job store is added.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Job status polling is not available with the synchronous queue.",
    )
