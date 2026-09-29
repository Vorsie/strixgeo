"""Pydantic schema for one stored interval of a borehole track."""

from __future__ import annotations

from pydantic import BaseModel, Field

from groundmodel.api.schemas.borehole.admixture_response import AdmixtureResponse


class TrackIntervalResponse(BaseModel):
    """One stored interval of a track, in the shared request shape."""

    top_m: float
    base_m: float
    value: str | None = None
    description: str | None = None
    color: str | None = None
    main_soil_codes: list[str] = Field(default_factory=list)
    admixtures: list[AdmixtureResponse] = Field(default_factory=list)
