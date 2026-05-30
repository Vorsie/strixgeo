"""Pydantic schema: :class:`LithoLayerBatchStatusResponse` (Slice A2)."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerResponse,
)


class LithoLayerBatchStatusResponse(BaseModel):
    """Response body for the batch-status endpoint.

    Carries the updated count + every mutated row so the frontend can
    apply the new status optimistically without a re-list.
    """

    updated_count: int
    layers: list[LithoLayerResponse]
