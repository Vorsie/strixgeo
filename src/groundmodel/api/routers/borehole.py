"""Borehole API route handlers."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/{borehole_id}")
async def get_borehole(borehole_id: str):
    """Retrieve borehole data by ID."""
    ...
