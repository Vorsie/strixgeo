"""Pydantic schema for the POST /borehole/import-dov response."""

from uuid import UUID

from pydantic import BaseModel


class ImportBoreholeDovResponse(BaseModel):
    """Summary of a completed DOV bounding-box borehole import.

    Mirrors ``ImportDovResponse`` (the CPT-side equivalent) but renames
    ``cpt_ids`` → ``borehole_ids`` so the frontend can route the IDs to
    the right detail-fetch endpoint without inspecting the request type.
    """

    imported: int
    duplicates: int
    failed: int
    borehole_ids: list[UUID]
