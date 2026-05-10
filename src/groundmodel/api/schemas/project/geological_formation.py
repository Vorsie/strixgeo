"""Pydantic schemas for the geological-formation API surface."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GeologicalFormationCreateRequest(BaseModel):
    """Body of ``POST /projects/{id}/geology/formations``.

    ``name`` is the only required field. Colour defaults at the API
    layer when the caller omits it so the DB column stays NOT NULL.
    """

    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#9ca3af", max_length=20)
    code: str | None = Field(default=None, max_length=50)
    display_order: int = 0
    regional_ref: str | None = Field(default=None, max_length=200)
    description: str | None = None


class GeologicalFormationUpdateRequest(BaseModel):
    """Body of ``PATCH /projects/{id}/geology/formations/{fid}``.

    Every field is optional — only keys present in the request body are
    written. Send ``null`` for an optional field to clear it.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=20)
    code: str | None = Field(default=None, max_length=50)
    display_order: int | None = None
    regional_ref: str | None = Field(default=None, max_length=200)
    description: str | None = None


class GeologicalFormationResponse(BaseModel):
    """API representation of a GeologicalFormation row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    name: str
    color: str
    code: str | None
    display_order: int
    regional_ref: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime
