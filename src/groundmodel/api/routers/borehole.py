from fastapi import APIRouter

router = APIRouter()


@router.get("/{borehole_id}")
async def get_borehole(borehole_id: str):
    ...
