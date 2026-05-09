"""Pydantic schema for one generic scalar lab test on a sample."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ScalarLabTestResponse(BaseModel):
    """A scalar-valued lab measurement that doesn't fit the typed families.

    Catch-all for DOV scalar observations outside grain_size /
    atterberg_limits / caco3_content / organic_content / water_content.
    Currently surfaces grain density, ASTM classification, and
    descriptive calcareous content; future scalar parameters land here
    as a config addition (no schema change).

    Numeric source values land in ``value_numeric``; non-numeric
    (the ASTM codes ``"CL"`` / ``"SP"`` / etc.) in ``value_text``.
    Both ``None`` only when ``detection_condition`` flags the row as
    not-measurable.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parameter_group: str
    parameter: str
    value_numeric: float | None
    value_text: str | None
    unit: str | None
    method: str | None
    test_date: date | None
    detection_condition: str | None
