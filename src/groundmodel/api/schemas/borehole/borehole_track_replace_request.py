"""Pydantic schema for ``PUT /borehole/{id}/tracks/{track_id}``."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.borehole.track_interval_request import TrackIntervalRequest
from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.borehole_track_constants import MAX_TRACK_INTERVALS


class BoreholeTrackReplaceRequest(StrictRequestModel):
    """Replace every interval of one track (the editor always sends the full track)."""

    intervals: list[TrackIntervalRequest] = Field(max_length=MAX_TRACK_INTERVALS)
