"""Pydantic schema for the answer of a track create / replace."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from groundmodel.api.schemas.borehole.track_interval_response import TrackIntervalResponse
from groundmodel.api.schemas.borehole.track_issue_response import TrackIssueResponse


class BoreholeTrackResponse(BaseModel):
    """One borehole track after a create / replace.

    ``track_id`` is the observation UUID, or ``"field_log:<kind>"`` for a
    field-log track. ``source`` + ``edited_manually_at`` are the provenance
    (Data Integrity rule 1): ``dov`` + a stamp = an import edited by hand.
    ``warnings`` carries the non-blocking findings of the save (gaps, deeper
    than the borehole's total depth).
    """

    track_id: str
    kind: str
    family: str
    source: str
    edited_manually_at: datetime | None
    dov_permkey: str | None
    intervals: list[TrackIntervalResponse]
    warnings: list[TrackIssueResponse] = Field(default_factory=list)
