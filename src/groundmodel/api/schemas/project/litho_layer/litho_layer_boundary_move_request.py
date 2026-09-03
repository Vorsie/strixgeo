"""Pydantic schema: :class:`LithoLayerBoundaryMoveRequest` (Slice A2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerBoundaryMoveRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{pid}/geology/models/{mid}/layers/boundary-move``.

    Atomic two-row depth update: the shared boundary between the
    upper and lower layer moves to ``new_depth_m``. Both layers must
    be on the same anchor (the use case enforces this) and adjacent
    (upper.depth_base_m == lower.depth_top_m at call time).
    """

    upper_layer_id: UUID = Field(
        description=(
            "Id of the layer whose depth_base_m moves. Must be adjacent above"
            " ``lower_layer_id`` on the same anchor."
        )
    )
    lower_layer_id: UUID = Field(
        description=(
            "Id of the layer whose depth_top_m moves. Must be adjacent below"
            " ``upper_layer_id`` on the same anchor."
        )
    )
    new_depth_m: float = Field(
        description=(
            "New depth (m below surface) for the shared boundary. Must lie"
            " strictly between upper.depth_top_m and lower.depth_base_m."
        )
    )
