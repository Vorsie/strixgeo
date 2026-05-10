"""Pydantic schema for creating a new project."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Lifecycle vocabularies. Stored as plain VARCHAR in the DB so adding a
# bucket here doesn't need a migration; the Pydantic layer is the only
# enforcement point.
ProjectPhase = Literal["feasibility", "design", "construction", "monitoring"]
ProjectStatus = Literal["active", "on_hold", "completed"]


class ProjectCreateRequest(BaseModel):
    """Body of ``POST /projects``.

    ``name`` is the only required field — every other piece of metadata is
    optional so the user can create a project quickly and fill in details
    later via the metadata editor.
    """

    name: str = Field(min_length=1, max_length=200)
    project_number: str | None = Field(default=None, max_length=80)
    client: str | None = Field(default=None, max_length=200)
    site_label: str | None = Field(default=None, max_length=200)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    default_horizontal_epsg: int | None = None
    default_vertical_epsg: int | None = None
    phase: ProjectPhase | None = None
    status: ProjectStatus = "active"
