"""Pydantic schema for one field-log observation (color/moisture/consistency) by depth."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FieldLogIntervalResponse(BaseModel):
    """One field-log observation (color / moisture / consistency) by depth."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    top_m: float
    base_m: float
    kind: str
    value: str | None
