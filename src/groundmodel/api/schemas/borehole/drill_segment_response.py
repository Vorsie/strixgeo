"""Pydantic schema for one drill-method interval in a borehole's depth log."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DrillSegmentResponse(BaseModel):
    """One drill-method interval in the boring's depth log."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    top_m: float
    base_m: float
    method: str | None
