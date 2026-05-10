"""Pydantic schema for the project duplicate (Save As) endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectDuplicateRequest(BaseModel):
    """Body of ``POST /projects/{id}/duplicate``.

    Single optional ``name`` field — the desktop client typically derives
    it from the chosen .gmproj file path's basename, but a future bulk-
    duplicate flow could leave it unset and let the backend default to
    ``"Copy of <source name>"``.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
