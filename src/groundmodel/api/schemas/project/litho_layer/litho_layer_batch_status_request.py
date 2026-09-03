"""Pydantic schema: :class:`LithoLayerBatchStatusRequest` (Slice A2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerStatusLiteral,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerBatchStatusRequest(StrictRequestModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/layers/batch-status``.

    Set the same status on every listed layer id in one transaction.
    Used by the "accept all" / "reject all" verbs after the frontend
    cut-over (Slice A3) — replaces the per-row PATCH loop.
    """

    layer_ids: list[UUID] = Field(
        description="Target layer ids. Empty list = no-op (returns count=0)."
    )
    status: LithoLayerStatusLiteral = Field(
        description='One of "pending" / "accepted" / "rejected".'
    )
