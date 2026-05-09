"""Pydantic schema for one sample taken from a borehole."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from groundmodel.api.schemas.borehole.atterberg_limits_response import (
    AtterbergLimitsResponse,
)
from groundmodel.api.schemas.borehole.caco3_content_response import CaCO3ContentResponse
from groundmodel.api.schemas.borehole.grain_size_response import GrainSizeResponse
from groundmodel.api.schemas.borehole.organic_content_response import (
    OrganicContentResponse,
)
from groundmodel.api.schemas.borehole.water_content_response import WaterContentResponse


class SampleResponse(BaseModel):
    """One material sample taken from a borehole at a depth interval.

    Carries the depth interval, source-vocabulary metadata strings (DOV
    ``monstertype`` / ``monstersamenstelling`` / ``bemonsteringsinstrument``
    pass through verbatim), plus the five lab-test families currently
    surfaced (Phase C3 grain-size + Phase C4 Atterberg / CaCO3 /
    organic / water-content). Each list is empty when DOV has no rows of
    that type for the sample.

    The ORM relationship names differ from the domain ``LabTest``
    suffixes: e.g. ``SampleOrm.atterberg_limits_tests`` (plural,
    ``_tests`` suffix). Pydantic's ``from_attributes`` config picks the
    attribute name straight off the ORM, so the JSON keys here match
    that ORM relationship — clients see ``atterberg_limits_tests``,
    ``caco3_content_tests``, ``organic_content_tests``,
    ``water_content_tests``, ``grain_sizes``.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    depth_top_m: float
    depth_base_m: float
    description: str
    sample_number: str | None
    sample_type: str | None
    composition: str | None
    instrument: str | None
    sampling_date: date | None
    grain_sizes: list[GrainSizeResponse]
    atterberg_limits_tests: list[AtterbergLimitsResponse]
    caco3_content_tests: list[CaCO3ContentResponse]
    organic_content_tests: list[OrganicContentResponse]
    water_content_tests: list[WaterContentResponse]
