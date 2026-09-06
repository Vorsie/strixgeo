"""Pydantic schemas for the bed-override API surface."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# A hard cap on the polygon vertex count — a bed override is a hand-drawn map
# area, never a survey trace, so a few dozen vertices is realistic. The bound
# keeps a malicious / runaway .strix or request from shipping a million-point
# ring into the JSONB column and the point-in-polygon loop.
_MAX_VERTICES = 5000

# One ring vertex: exactly an [x, y] pair. StrictRequestModel forbids NaN/inf on
# every float, so a non-finite coordinate is refused at the door.
_Vertex = tuple[float, float]


class BedOverrideCreateRequest(StrictRequestModel):
    """Body of ``POST /projects/{id}/bed-overrides``.

    ``epsg`` is required; the desktop client passes the project's
    ``default_horizontal_epsg``. Three vertices are the minimum for an area.
    """

    label: str = Field(min_length=1, max_length=200)
    level_m: float = Field(allow_inf_nan=False)
    epsg: int
    vertices: list[_Vertex] = Field(min_length=3, max_length=_MAX_VERTICES)


class BedOverrideUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{id}/bed-overrides/{oid}``.

    Every field is optional — only keys present in the body are written. A
    ``vertices`` list, when present, must still be a valid ring (>= 3 points).
    """

    label: str | None = Field(default=None, min_length=1, max_length=200)
    level_m: float | None = Field(default=None, allow_inf_nan=False)
    epsg: int | None = None
    vertices: list[_Vertex] | None = Field(default=None, min_length=3, max_length=_MAX_VERTICES)


class BedOverrideResponse(BaseModel):
    """API representation of a BedOverride row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    label: str
    level_m: float
    epsg: int
    vertices: list[_Vertex]
    created_at: datetime
    updated_at: datetime
