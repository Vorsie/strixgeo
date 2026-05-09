"""Pydantic schema for the full borehole detail tree returned by GET /borehole/{id}."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from groundmodel.api.schemas.borehole.drill_segment_response import DrillSegmentResponse
from groundmodel.api.schemas.borehole.field_log_interval_response import (
    FieldLogIntervalResponse,
)
from groundmodel.api.schemas.borehole.observation_response import ObservationResponse


class BoreholeDetailResponse(BaseModel):
    """Full borehole detail tree returned by GET /borehole/{id}.

    Includes header metadata + drill segments + field-log intervals +
    observations (with layers + admixtures). Sample-side lab tests will be
    added in Phase C3 when the sample import pipeline lands; the repository
    already eager-loads them via ``selectinload`` so the API response just
    needs the schema fields.

    The ``observation_type`` field on each observation is the raw
    ``ObservationType.value`` string (e.g. ``"coded_lithology"``,
    ``"formal_stratigraphy"``) — the frontend maps it to a display label.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    test_id: str
    project_id: str
    location_x: float
    location_y: float
    epsg: int | None
    elevation_m: float | None
    z_epsg: int | None
    start_date: date | None
    drill_method: str | None
    borehole_type: str | None
    purpose: str | None
    municipality: str | None
    executor: str | None
    total_depth_m: float | None
    water_table_depth_m: float | None
    n_drill_segments: int | None
    n_field_log_intervals: int | None
    drill_segments: list[DrillSegmentResponse]
    field_log_intervals: list[FieldLogIntervalResponse]
    observations: list[ObservationResponse]
    samples: list[SampleResponse]
