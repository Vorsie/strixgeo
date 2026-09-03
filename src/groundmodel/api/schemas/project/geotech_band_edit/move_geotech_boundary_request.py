"""Pydantic schema: :class:`MoveGeotechBoundaryRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class MoveGeotechBoundaryRequest(StrictRequestModel):
    """Body of the preview-move and move endpoints (the drag verb).

    Parameters
    ----------
    upper_band_id : UUID
        The shallower of the two adjacent packing bands sharing the boundary.
    lower_band_id : UUID
        The deeper of the two. Order is normalised by depth on the server.
    new_depth_m : float
        The proposed boundary depth (metres, positive down). Must land
        strictly inside the pair — the squeeze-to-collapse case is the ABSORB
        gesture (a merge call), not a move.
    """

    upper_band_id: UUID = Field(..., description="The shallower packing band.")
    lower_band_id: UUID = Field(..., description="The deeper packing band.")
    new_depth_m: float = Field(..., description="The new boundary depth (m, positive down).")
