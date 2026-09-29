"""Track validation result — the verdict on a hand-edited borehole track."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_issue import TrackIssue


@dataclass(frozen=True)
class TrackValidationResult:
    """Outcome of :func:`validate_track_intervals`.

    Parameters
    ----------
    intervals : tuple[TrackInterval, ...]
        The intervals snapped to the 1 mm grain and sorted by top depth — the
        shape that gets stored when ``errors`` is empty.
    errors : tuple[TrackIssue, ...]
        Blocking findings; any error refuses the save.
    warnings : tuple[TrackIssue, ...]
        Non-blocking findings (gaps, deeper than the total depth).
    """

    intervals: tuple[TrackInterval, ...]
    errors: tuple[TrackIssue, ...]
    warnings: tuple[TrackIssue, ...]

    @property
    def ok(self) -> bool:
        """Return True when the track may be saved (no blocking finding)."""
        return not self.errors
