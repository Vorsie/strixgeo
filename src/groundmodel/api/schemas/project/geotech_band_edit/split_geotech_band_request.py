"""Pydantic schema: :class:`SplitGeotechBandRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SplitGeotechBandRequest(StrictRequestModel):
    """Body of the preview-split and split endpoints.

    Parameters
    ----------
    band_id : UUID
        The packing band (``litho_layer`` row in the geotech model) to split.
    split_depth_m : float
        Proposed boundary depth in metres, positive down. It must fall strictly
        inside the band's own litho body; the server refuses
        anything else with a 422 (the owner overrules the class, not the
        hierarchy).
    """

    band_id: UUID = Field(..., description="The packing band to split.")
    split_depth_m: float = Field(
        ...,
        description="New boundary depth (m, positive down), inside the band's litho body.",
    )
