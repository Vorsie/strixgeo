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
    # Set only on synthetic pinch-out contacts (no borehole/CPT anchor);
    # null for normal contacts. The absolute tip elevation lives in
    # synthetic_elevation_m (depth_top_m is a 0.0 sentinel there).
    synthetic_x: float | None = None
    synthetic_y: float | None = None
    synthetic_elevation_m: float | None = None
    depth_top_m: float
    source: str
    confidence: str
    observation_id: UUID | None
    observation_layer_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
