"""Pydantic schema: :class:`LithoLayerSplitResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerResponse,
)


class LithoLayerSplitResponse(BaseModel):
    """Response body for the split endpoint.

    Both resulting layers are returned post-split so the frontend can refresh
    in-place without a second GET: ``top`` is the original row (its base shrunk
    to the split depth), ``bottom`` is the new row below the split.
    """

    top: LithoLayerResponse
    bottom: LithoLayerResponse
