"""Pydantic schemas for the borehole detail tree returned by GET /borehole/{id}."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AdmixtureResponse(BaseModel):
    """One admixture (secondary soil component) inside an observation layer.

    DOV source-vocabulary tokens are passed through verbatim — translation to
    English is a presentation concern (CLAUDE.md memory: "DOV codelists &
    translation strategy"). The frontend looks up display labels at render
    time.
    """

    model_config = ConfigDict(from_attributes=True)

    soil_code: str
    amount: str
    locally: bool


class ObservationLayerResponse(BaseModel):
    """One depth interval within an observation.

    Carries both the lithology sub-shape (``color`` + ``main_soil_codes`` +
    ``admixtures``) and the stratigraphy sub-shape (``description``) — the
    parent observation's ``observation_type`` discriminates which is
    populated. See ``observation_layer_orm`` docstring for the layout
    rationale.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    top_m: float
    base_m: float
    color: str | None
    main_soil_codes: list[str]
    description: str | None
    layer_index: int
    admixtures: list[AdmixtureResponse]


class ObservationResponse(BaseModel):
    """One interpretation stream attached to a borehole.

    A borehole can carry multiple observations of different ``observation_type``s
    (coded_lithology, formal_stratigraphy, ...). Each is its own row with its
    own author / date / quality metadata and aggregates its layers via the
    ``layers`` list.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    observation_type: str
    author: str | None
    observation_date: date | None
    reliability: str | None
    score_category: str | None
    drill_method_score: str | None
    layers: list[ObservationLayerResponse]


class DrillSegmentResponse(BaseModel):
    """One drill-method interval in the boring's depth log."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    top_m: float
    base_m: float
    method: str | None


class FieldLogIntervalResponse(BaseModel):
    """One field-log observation (color / moisture / consistency) by depth."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    top_m: float
    base_m: float
    kind: str
    value: str | None


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
