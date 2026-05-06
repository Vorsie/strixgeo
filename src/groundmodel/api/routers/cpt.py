"""CPT API route handlers."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/{cpt_id}")
async def get_cpt(cpt_id: str):
    """Retrieve CPT data by ID."""
    ...


@router.get("/{cpt_id}/plot")
async def get_cpt_plot(cpt_id: str):
    """Return plotted qc/fs depth series for a CPT."""
    ...
