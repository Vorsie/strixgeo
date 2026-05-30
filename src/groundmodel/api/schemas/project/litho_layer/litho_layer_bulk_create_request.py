"""Pydantic schema: :class:`LithoLayerBulkCreateRequest` (Slice A2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerConfidenceLiteral,
    LithoLayerSourceLiteral,
    LithoLayerStatusLiteral,
)


class LithoLayerCreateItem(BaseModel):
    """One per-layer payload in a bulk-create."""

    formation_id: UUID
    depth_top_m: float
    depth_base_m: float
    status: LithoLayerStatusLiteral = "pending"
    source: LithoLayerSourceLiteral = "segmenter"
    confidence: LithoLayerConfidenceLiteral = "medium"
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    parent_geo_contact_id: UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _xor_anchor_and_depth_order(self) -> LithoLayerCreateItem:
        """Anchor XOR + depth ordering guard.

        Both are enforced at the DB level (CHECK constraints) but
        Pydantic-level rejection gives a 422 with a clearer message
        than a Postgres IntegrityError.
        """
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError("Each layer item requires exactly one of borehole_id / cpt_id")
        if self.depth_top_m >= self.depth_base_m:
            raise ValueError("Each layer item requires depth_top_m strictly less than depth_base_m")
        return self


class LithoLayerBulkCreateRequest(BaseModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/layers``.

    Inserts N rows in one transaction. Used by the suggest-litho
    persistence path (segmenter output → pending layers) after the
    Slice A3 cut-over.
    """

    layers: list[LithoLayerCreateItem] = Field(
        description="Per-layer payloads. Empty list = no-op (returns [])."
    )
