"""Pydantic schema for a single Project response."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectResponse(BaseModel):
    """Full project metadata returned by every project endpoint.

    Used for both the list endpoint and the detail endpoint — projects are
    metadata-only (no heavy children), so list and detail return the same
    shape. Mirrors the columns on ``ProjectOrm`` 1:1; the desktop client
    serialises this directly into the ``.gmproj`` file.

    Lifecycle fields (``phase`` / ``status``) are validated at the
    request-schema layer, not here — a value already in the DB is treated
    as ground truth.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    project_number: str | None
    client: str | None
    site_label: str | None
    description: str | None
    tags: list[str]
    default_horizontal_epsg: int | None
    default_vertical_epsg: int | None
    phase: str | None
    status: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Project-level view toggles (DEM overlay, hidden-by-type sets, …).
    # Always a dict — the column default is ``{}`` so reads never see
    # null. Schema discipline for keys lives at the PATCH endpoint.
    view_state: dict[str, Any] = Field(default_factory=dict)
