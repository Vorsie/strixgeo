"""Pydantic schema for the full borehole detail tree returned by GET /borehole/{id}."""

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from groundmodel.api.schemas.borehole.drill_segment_response import DrillSegmentResponse
from groundmodel.api.schemas.borehole.field_log_interval_response import (
    FieldLogIntervalResponse,
)
from groundmodel.api.schemas.borehole.observation_response import ObservationResponse
from groundmodel.api.schemas.borehole.sample_response import SampleResponse


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
    # Where ``elevation_m`` came from — ``"dov"`` / ``"gef"`` /
    # ``"manual"`` / ``"none"``. Surfaced so the desktop ElevationEditor
    # can render a provenance badge next to the Z value (debt #8).
    elevation_source: str
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
    # How a borehole read off a PDF report was made (report, pages, profile,
    # the user's CRS / water-unit confirmations); None for DOV and
    # hand-made boreholes. Additive.
    import_provenance: dict[str, Any] | None = None
