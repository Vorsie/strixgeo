"""Pydantic schema: :class:`LithoLayerBatchUpdateResponse` (A4 slice 4b)."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerResponse,
)


class LithoLayerBatchUpdateResponse(BaseModel):
    """Response body for the batch-update endpoint.

    Carries the updated count + every mutated row so the FE can apply
    the new values optimistically without a re-list. Order matches the
    input ``updates`` array.
    """

    updated_count: int
    layers: list[LithoLayerResponse]
