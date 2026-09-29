"""Pydantic schema for one field-log observation (color/moisture/consistency) by depth."""

from datetime import datetime
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
    # Provenance of the field-log track the row belongs to (additive,
    # 2026-09-29): ``"dov"`` / ``"manual"`` + the last track-editor save.
    source: str = "dov"
    edited_manually_at: datetime | None = None
