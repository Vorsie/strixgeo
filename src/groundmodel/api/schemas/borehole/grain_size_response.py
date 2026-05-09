"""Pydantic schema for one grain-size lab test on a sample."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class GrainSizeResponse(BaseModel):
    """One grain-size cumulative curve for a ``Sample``.

    The two parallel arrays carry the curve in source order (strictly
    ascending diameters). ``method`` is the raw DOV source-vocabulary
    string ("Zeving", "Hydrometer", "D.m.v. Laserdiffractie", "Pipette",
    "Sedigraaf") — the frontend looks up display labels at render time.

    ``lime_removed`` and ``organics_removed`` are PRE-TREATMENT booleans
    indicating whether those substances were chemically stripped BEFORE
    the test, NOT measurements of CaCO3 / organic content.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    diameters_mm: list[float]
    pct_larger: list[float]
    method: str | None
    test_date: date | None
    lime_removed: bool | None
    organics_removed: bool | None
