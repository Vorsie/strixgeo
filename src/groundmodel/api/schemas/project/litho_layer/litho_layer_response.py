"""Pydantic schema: :class:`LithoLayerResponse` (Slice A1).

Read-path representation of a ``litho_layer`` row. Mirrors the ORM
shape (FormationContactResponse-style) — every column is exposed.

See ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``
for the data model and the rationale behind retiring the
suggestion/contact dual representation for litho models.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

LithoLayerStatusLiteral = Literal["pending", "accepted", "rejected"]
"""Status values accepted by the layer table CHECK constraint."""

LithoLayerSourceLiteral = Literal[
    "segmenter", "manual", "observation_layer", "observation_interpretation"
]
"""Provenance tokens accepted by the layer table CHECK constraint."""

LithoLayerConfidenceLiteral = Literal["low", "medium", "high"]
"""Confidence values accepted by the layer table CHECK constraint."""


class LithoLayerResponse(BaseModel):
    """API representation of a ``litho_layer`` row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    borehole_id: UUID | None
    cpt_id: UUID | None
    depth_top_m: float
    depth_base_m: float
    status: LithoLayerStatusLiteral
    source: LithoLayerSourceLiteral
    confidence: LithoLayerConfidenceLiteral
    observation_id: UUID | None
    observation_layer_id: UUID | None
    # Litho↔geo coupling (#162): set on a lithostratigraphic layer,
    # pointing at the geological contact it is bound to. NULL = not
    # coupled.
    parent_geo_contact_id: UUID | None = None
    # The body (instance) this layer belongs to; NULL until the resolver runs.
    body_id: UUID | None = None
    # The accepted litho band a geotech band subdivides; the Parameters tree
    # derives the band's litho body live through it. NULL on litho-model rows
    # and on a geotech band with no covering litho band (a true orphan).
    parent_litho_layer_id: UUID | None = None
    notes: str | None
    created_at: datetime
    updated_at: datetime
