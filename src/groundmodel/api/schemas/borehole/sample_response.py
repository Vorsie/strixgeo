"""Pydantic schema for one sample taken from a borehole."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from groundmodel.api.schemas.borehole.grain_size_response import GrainSizeResponse


class SampleResponse(BaseModel):
    """One material sample taken from a borehole at a depth interval.

    Carries the depth interval, source-vocabulary metadata strings (DOV
    ``monstertype`` / ``monstersamenstelling`` / ``bemonsteringsinstrument``
    pass through verbatim), plus the lab tests run on this sample.

    Phase C3 surfaces ``grain_sizes`` only — Atterberg, CaCO3, organic,
    and water-content tests get their own response schemas in subsequent
    phases. The ORM eager-loads them today; the API just lacks the
    serialiser path for them.
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
