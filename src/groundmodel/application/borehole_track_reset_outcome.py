"""What a Reset to DOV hands back to the API."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot


@dataclass(frozen=True)
class BoreholeTrackResetOutcome:
    """The tracks a Reset to DOV rewrote, ORM-free.

    Parameters
    ----------
    reset : tuple[BoreholeTrackSnapshot, ...]
        Every track rewritten from the fresh DOV parse (observations first,
        then the field logs by kind).
    discarded_edits : int
        How many of them carried hand edits (``edited_manually_at`` set) that
        the reset threw away.
    kept_manual : int
        How many hand-made tracks the borehole carries; the reset never
        touches them.
    """

    reset: tuple[BoreholeTrackSnapshot, ...]
    discarded_edits: int
    kept_manual: int
