"""Pydantic schemas for the DEM sampling API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DemSamplePointResponse(BaseModel):
    """One elevation sample along a section line.

    ``elevation_m`` is ``null`` when the underlying pixel was NoData
    (outside the DHMVII coverage, or a known data hole).
    """

    along_m: float
    elevation_m: float | None


class DemSampleLineResponse(BaseModel):
    """Body returned by ``GET /dem/sample``.

    ``source`` echoes which provider answered ("dhmvii" today; "ahn"
    once that integration lands). ``samples`` carries the elevation
    profile from start to end of the requested line.
    """

    source: str
    samples: list[DemSamplePointResponse] = Field(default_factory=list)
