"""Pydantic schema for the POST /cpt/import-dov response."""

from uuid import UUID

from pydantic import BaseModel


class ImportDovResponse(BaseModel):
    """Summary of a completed DOV bounding-box import."""

    imported: int
    duplicates: int
    failed: int
    cpt_ids: list[UUID]
