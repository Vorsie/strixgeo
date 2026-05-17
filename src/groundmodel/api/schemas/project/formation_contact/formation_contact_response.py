"""Pydantic schema: :class:`FormationContactResponse`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FormationContactResponse(BaseModel):
    """API representation of a FormationContact row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    borehole_id: UUID | None
    cpt_id: UUID | None
    depth_top_m: float
    source: str
    confidence: str
    observation_id: UUID | None
    observation_layer_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
