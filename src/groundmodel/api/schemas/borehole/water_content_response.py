"""Pydantic schema for one water-content (moisture) lab test on a sample."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class WaterContentResponse(BaseModel):
    """Water content as percentage of dry mass.

    Values can exceed 100 % for organic soils, peats, and some quick
    clays (the wet sample can hold more water than the dry mass weighs).
    The domain entity validates [0, 1000]; consumers shouldn't clamp.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    content_pct: float | None
    method: str | None
    test_date: date | None
