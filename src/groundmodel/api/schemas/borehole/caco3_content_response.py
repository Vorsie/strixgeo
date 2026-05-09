"""Pydantic schema for one calcium-carbonate-content lab test on a sample."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CaCO3ContentResponse(BaseModel):
    """Calcium carbonate (lime) content as percentage of dry mass.

    Distinct from ``GrainSize.lime_removed`` — the latter is a
    pre-treatment boolean indicating whether lime was chemically
    stripped before a grain-size test, not a measurement.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    content_pct: float | None
    method: str | None
    test_date: date | None
