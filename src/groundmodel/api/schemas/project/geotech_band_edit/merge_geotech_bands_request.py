"""Pydantic schema: :class:`MergeGeotechBandsRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class MergeGeotechBandsRequest(BaseModel):
    """Body of the preview-merge and merge endpoints.

    Parameters
    ----------
    upper_band_id : UUID
        The shallower of the two adjacent packing bands.
    lower_band_id : UUID
        The deeper of the two. Order is normalised by depth on the server, so
        passing the pair the other way round is accepted.
    """

    upper_band_id: UUID = Field(..., description="The shallower packing band.")
    lower_band_id: UUID = Field(..., description="The deeper packing band.")
