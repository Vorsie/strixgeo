"""Pydantic schema: :class:`LithoLayerBatchUpdateRequest` (A4 slice 4b).

Atomic PATCH for N layer rows in one transaction. Mirrors the existing
``FormationContactBatchUpdateRequest`` semantics so the FE can swap
``api.geology.updateContactsBatch`` for ``api.geology.batchUpdateLayers``
without changing the all-or-nothing contract the section editor's
multi-drag + cross-column MOVE gestures rely on.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerConfidenceLiteral,
    LithoLayerSourceLiteral,
    LithoLayerStatusLiteral,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerBatchUpdateItem(StrictRequestModel):
    """One per-row patch in a batch update.

    ``layer_id`` is the target row; every other field is optional and
    only applied when present. Anchor XOR is enforced at the request
    level (mirrors the single-row ``LithoLayerUpdateRequest`` rule):
    if either anchor field is touched, both must be present and exactly
    one must be non-null.
    """

    layer_id: UUID
    formation_id: UUID | None = None
    depth_top_m: float | None = None
    depth_base_m: float | None = None
    status: LithoLayerStatusLiteral | None = None
    source: LithoLayerSourceLiteral | None = None
    confidence: LithoLayerConfidenceLiteral | None = None
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    parent_geo_contact_id: UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _xor_when_anchor_touched(self) -> LithoLayerBatchUpdateItem:
        """Same anchor-XOR rule as the single-row update.

        Either neither anchor field appears, or both are present with
        exactly one non-null. The use case + DB CHECK enforce the
        ultimate invariant; this is the early reject for clearer 422s.
        """
        sent = {"borehole_id", "cpt_id"} & self.model_fields_set
        if not sent:
            return self
        if sent != {"borehole_id", "cpt_id"}:
            raise ValueError(
                "Anchor update on a litho layer requires both borehole_id and cpt_id "
                "in the request body (set the unused one to null)"
            )
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError(
                "Anchor update on a litho layer: exactly one of "
                "borehole_id / cpt_id must be non-null"
            )
        return self

    @model_validator(mode="after")
    def _depth_ordering(self) -> LithoLayerBatchUpdateItem:
        """Same depth-ordering rule as the single-row update."""
        if self.depth_top_m is not None and self.depth_base_m is not None:
            if self.depth_top_m >= self.depth_base_m:
                raise ValueError(
                    "Layer depth ordering: depth_top_m must be strictly less than depth_base_m"
                )
        return self


class LithoLayerBatchUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{pid}/geology/models/{mid}/layers/batch-update``.

    All-or-nothing: every layer_id must exist and belong to the URL's
    model before any row is mutated. Missing ids → 422 with no side
    effects. Replaces the per-row PATCH loop the FE used to write.
    """

    updates: list[LithoLayerBatchUpdateItem] = Field(
        description="Per-layer patch entries. Empty list = no-op (returns [])."
    )
