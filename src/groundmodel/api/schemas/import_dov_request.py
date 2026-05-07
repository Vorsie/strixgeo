"""Pydantic schema for the POST /cpt/import-dov request body."""

from uuid import UUID

from pydantic import BaseModel, Field


class ImportDovRequest(BaseModel):
    """WGS84 bounding box + project scope for a DOV CPT import."""

    west: float = Field(..., ge=-180, le=180, description="Western longitude (decimal degrees)")
    south: float = Field(..., ge=-90, le=90, description="Southern latitude (decimal degrees)")
    east: float = Field(..., ge=-180, le=180, description="Eastern longitude (decimal degrees)")
    north: float = Field(..., ge=-90, le=90, description="Northern latitude (decimal degrees)")
    project_id: UUID | None = None
