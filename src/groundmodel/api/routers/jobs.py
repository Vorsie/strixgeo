"""Job management API route handlers."""
from fastapi import APIRouter

router = APIRouter()


@router.post("/import-cpt")
async def import_cpt():
    """Enqueue a CPT import job."""
    ...


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    """Return the current status of an import or export job."""
    ...
