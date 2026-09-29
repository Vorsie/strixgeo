"""Borehole track snapshot - what a track mutation hands back to the API."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_issue import TrackIssue


@dataclass(frozen=True)
class BoreholeTrackSnapshot:
    """One borehole track after a create / replace, ORM-free.

    Parameters
    ----------
    track_id : str
        The observation UUID as a string, or ``"field_log:<kind>"`` for a
        field-log track (see ``FIELD_LOG_TRACK_ID_PREFIX``).
    kind : str
        ``ObservationType`` or ``FieldLogKind`` value.
    family : str
        ``"observation"`` or ``"field_log"`` - which table the rows live in.
    source : str
        ``TrackSource`` value (``"dov"`` / ``"manual"``).
    edited_manually_at : datetime | None
        Last save from the track editor.
    dov_permkey : str | None
        Upstream DOV identity of an imported observation track (kept through
        edits); None for manual and field-log tracks.
    intervals : tuple[TrackInterval, ...]
        The stored intervals, depth-ordered.
    warnings : tuple[TrackIssue, ...]
        Non-blocking findings of the save (gaps, deeper than drilled).
    """

    track_id: str
    kind: str
    family: str
    source: str
    edited_manually_at: datetime | None
    dov_permkey: str | None
    intervals: tuple[TrackInterval, ...]
    warnings: tuple[TrackIssue, ...] = ()
