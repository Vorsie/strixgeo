from fastapi import APIRouter

router = APIRouter()


@router.post("/import-cpt")
async def import_cpt():
    ...


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    ...
