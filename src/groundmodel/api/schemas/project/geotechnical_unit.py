"""Pydantic schemas for the geotechnical-unit API surface."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GeotechnicalUnitCreateRequest(BaseModel):
    """Body of ``POST /projects/{pid}/geology/formations/{fid}/units``.

    ``name`` is the only required field. Colour defaults at the API
    layer when the caller omits it so the DB column stays NOT NULL.
    """

    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#9ca3af", max_length=20)
    code: str | None = Field(default=None, max_length=50)
    display_order: int = 0
    description: str | None = None


class GeotechnicalUnitUpdateRequest(BaseModel):
    """Body of ``PATCH /projects/{pid}/geology/formations/{fid}/units/{uid}``.

    Every field is optional — only keys present in the request body
    are written. Send ``null`` for an optional field to clear it.
    The parent ``geological_formation_id`` is NOT updatable here — to
    re-parent a unit, delete + recreate.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=20)
    code: str | None = Field(default=None, max_length=50)
    display_order: int | None = None
    description: str | None = None


class GeotechnicalUnitResponse(BaseModel):
    """API representation of a GeotechnicalUnit row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    geological_formation_id: UUID
    name: str
    color: str
    code: str | None
    display_order: int
    description: str | None
    created_at: datetime
    updated_at: datetime
