"""Pydantic schemas for the geological-model API surface."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GeologicalModelCreateRequest(BaseModel):
    """Body of ``POST /projects/{id}/geology/models``.

    A project can have multiple interpretation models. ``is_active``
    defaults to False — call ``POST .../models/{id}/activate`` to flip
    the active flag (which clears it on every sibling).
    """

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    is_active: bool = False
    excluded_borehole_ids: list[UUID] = Field(default_factory=list)


class GeologicalModelUpdateRequest(BaseModel):
    """Body of ``PATCH /projects/{id}/geology/models/{mid}``.

    ``is_active`` is intentionally NOT updatable here — use the dedicated
    activate endpoint so the "only one active per project" guard runs.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    excluded_borehole_ids: list[UUID] | None = None


class GeologicalModelResponse(BaseModel):
    """API representation of a GeologicalModel row (without contacts).

    Use ``GET /projects/{id}/geology/models/{mid}/contacts`` to fetch
    the model's formation contacts. The shape stays light here so list
    endpoints don't drag the full contact tree.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    name: str
    description: str | None
    is_active: bool
    excluded_borehole_ids: list[UUID]
    created_at: datetime
    updated_at: datetime
