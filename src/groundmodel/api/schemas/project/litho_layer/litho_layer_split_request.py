"""Pydantic schema: :class:`LithoLayerSplitRequest`."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerSplitRequest(StrictRequestModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/layers/{lid}/split``.

    "Split here": cut one accepted litho layer at ``depth_m`` into two accepted
    layers that keep the same composition. The depth must lie strictly inside the
    layer's interval, leaving both halves at least the minimum thickness (the use
    case enforces the exact tolerance and answers 422 otherwise).

    Parameters
    ----------
    depth_m : float
        The split boundary depth (m below surface). Mm-rounded server-side to the
        stored precision.
    """

    depth_m: float = Field(
        description=(
            "Depth (m below surface) at which to split the layer. Must lie"
            " strictly between the layer's depth_top_m and depth_base_m."
        )
    )
