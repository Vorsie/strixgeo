"""Track issue value object — one finding of the track interval validator."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TrackIssue:
    """One validation finding on a hand-edited borehole track.

    Parameters
    ----------
    loc : str
        Dotted key path of the offending field in the request body, e.g.
        ``"intervals.3.base_m"`` (the same shape the desktop shows for a 422,
        PR #32), or ``"kind"`` / ``"intervals"`` for track-level findings.
    code : str
        Machine-readable code (``"intervals_overlap"``, ``"gap_between_intervals"``).
    message : str
        English sentence for the log and the API; the desktop translates by
        ``code`` at the presentation boundary.
    """

    loc: str
    code: str
    message: str
