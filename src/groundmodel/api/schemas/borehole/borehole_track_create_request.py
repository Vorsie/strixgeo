"""Pydantic schema for ``POST /borehole/{id}/tracks``."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.borehole.track_interval_request import TrackIntervalRequest
from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.borehole_track_constants import MAX_TRACK_INTERVALS


class BoreholeTrackCreateRequest(StrictRequestModel):
    """Create a hand-typed track of ``kind`` on a borehole.

    ``kind`` is an ``ObservationType`` value (``coded_lithology``,
    ``formal_stratigraphy``, ...) or a ``FieldLogKind`` value (``color``,
    ``moisture``, ``consistency``); an unknown kind answers 422 from the
    domain validator with ``loc = "kind"``.
    """

    kind: str = Field(min_length=1, max_length=50)
    intervals: list[TrackIntervalRequest] = Field(max_length=MAX_TRACK_INTERVALS)
