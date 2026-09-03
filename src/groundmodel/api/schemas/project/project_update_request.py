"""Pydantic schema for updating a project's metadata."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.project.project_create_request import (
    ProjectPhase,
    ProjectStatus,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class ProjectUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{id}``.

    Every field is optional — only fields present in the request body are
    applied to the row. ``tags`` is a full replacement (not append): callers
    submit the new set, the column is overwritten. This matches how the
    desktop metadata editor builds its payload (it always has the complete
    edited tag list in scope).

    Setting ``name`` to an empty string is rejected — the column is
    ``NOT NULL`` in the DB and a project must be human-identifiable.
    Pass ``None`` (omit the field) to leave the existing name.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    project_number: str | None = Field(default=None, max_length=80)
    client: str | None = Field(default=None, max_length=200)
    site_label: str | None = Field(default=None, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    default_horizontal_epsg: int | None = None
    default_vertical_epsg: int | None = None
    phase: ProjectPhase | None = None
    status: ProjectStatus | None = None
