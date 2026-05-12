"""Pydantic schemas for the cross-section API surface."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CrossSectionCreateRequest(BaseModel):
    """Body of ``POST /projects/{id}/sections``.

    ``epsg`` is required; the desktop client typically passes the
    project's ``default_horizontal_epsg`` but a section can override
    when the endpoints live in a different CRS. Buffer and exaggeration
    have sensible defaults so simple cases stay short.
    """

    name: str = Field(min_length=1, max_length=200)
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    epsg: int
    description: str | None = None
    projection_buffer_m: float = Field(default=50.0, gt=0.0)
    vertical_exaggeration: float = Field(default=1.0, gt=0.0)
    excluded_borehole_ids: list[UUID] = Field(default_factory=list)
    excluded_cpt_ids: list[UUID] = Field(default_factory=list)
    min_depth_m: float | None = None
    max_depth_m: float | None = None
    display_order: int = 0
    view_state: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _endpoints_distinct(self) -> CrossSectionCreateRequest:
        """Reject zero-length sections — the projection math divides by line length."""
        if self.start_x == self.end_x and self.start_y == self.end_y:
            raise ValueError("Cross-section endpoints must be distinct (line length > 0).")
        return self

    @model_validator(mode="after")
    def _depth_window_ordered(self) -> CrossSectionCreateRequest:
        """If both depth bounds are set, ``min`` must be shallower than ``max``."""
        if (
            self.min_depth_m is not None
            and self.max_depth_m is not None
            and self.min_depth_m >= self.max_depth_m
        ):
            raise ValueError("min_depth_m must be strictly less than max_depth_m")
        return self


class CrossSectionUpdateRequest(BaseModel):
    """Body of ``PATCH /projects/{id}/sections/{sid}``.

    Every field is optional — only keys present in the body are
    written. Endpoint updates re-trigger the distinct-endpoints
    invariant on the server side via the repo flush; we don't repeat
    that validation here because partial updates may leave one
    endpoint untouched.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    start_x: float | None = None
    start_y: float | None = None
    end_x: float | None = None
    end_y: float | None = None
    epsg: int | None = None
    projection_buffer_m: float | None = Field(default=None, gt=0.0)
    vertical_exaggeration: float | None = Field(default=None, gt=0.0)
    excluded_borehole_ids: list[UUID] | None = None
    excluded_cpt_ids: list[UUID] | None = None
    min_depth_m: float | None = None
    max_depth_m: float | None = None
    display_order: int | None = None
    # Sentinel: ``None`` means "do not touch view_state"; an explicit
    # empty dict ``{}`` clears the bag. The router applies a shallow
    # merge so callers can patch individual toggle keys without
    # round-tripping the whole bag (mirrors the
    # ``PATCH /projects/{id}/view-state`` semantics).
    view_state: dict[str, Any] | None = None


class CrossSectionResponse(BaseModel):
    """API representation of a CrossSection row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    name: str
    description: str | None
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    epsg: int
    projection_buffer_m: float
    vertical_exaggeration: float
    excluded_borehole_ids: list[UUID]
    excluded_cpt_ids: list[UUID]
    min_depth_m: float | None
    max_depth_m: float | None
    display_order: int
    view_state: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
