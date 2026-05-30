"""Pydantic schema: :class:`LithoLayerBoundaryMoveResponse` (Slice A2)."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerResponse,
)


class LithoLayerBoundaryMoveResponse(BaseModel):
    """Response body for the boundary-move endpoint.

    Both layers are returned post-mutation so the frontend can refresh
    in-place without a second GET.
    """

    upper: LithoLayerResponse
    lower: LithoLayerResponse
