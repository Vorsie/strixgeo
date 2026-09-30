"""Pydantic schema for the answer of a Reset to DOV (owner 2026-09-30)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from groundmodel.api.schemas.borehole.borehole_track_response import BoreholeTrackResponse


class BoreholeTrackResetResponse(BaseModel):
    """The tracks a Reset to DOV rewrote from the cached DOV XML.

    ``tracks`` are the rewritten tracks (``source = "dov"``,
    ``edited_manually_at = null``); manual tracks are never in it - they are
    kept untouched and only counted in ``kept_manual``.
    """

    tracks: list[BoreholeTrackResponse] = Field(default_factory=list)
    discarded_edits: int = Field(
        0, description="How many rewritten tracks carried hand edits that were discarded."
    )
    kept_manual: int = Field(0, description="How many hand-made tracks were kept untouched.")
