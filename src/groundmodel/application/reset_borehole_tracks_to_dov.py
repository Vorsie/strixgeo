"""Use case: reset a borehole's DOV tracks to what DOV published (owner 2026-09-30).

"there needs to be a per borehole button to reset to dov defaults though".
The rules live in ``borehole_track_dov_reset.reset_tracks_from_dov``; this use
case loads the borehole (project-scoped), runs it over the DOV XML cache, and
flushes. Destructive for hand edits on DOV tracks - the desktop confirms first
(Cancel default-focused, "Reset to DOV") and pushes no undo step.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.borehole_track_dov_reset import reset_tracks_from_dov
from groundmodel.application.borehole_track_helpers import load_borehole_with_tracks
from groundmodel.application.borehole_track_reset_outcome import BoreholeTrackResetOutcome
from groundmodel.application.dov_track_source import DovTrackSource
from groundmodel.infrastructure.parsers.borehole.dov.cached_dov_track_source import (
    CachedDovTrackSource,
)
from groundmodel.shared.exceptions import BoreholeResetNoDovSourceError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ResetBoreholeTracksToDov(GroundModelLogger):
    """Rewrite a borehole's DOV tracks from the cached DOV XML. Flushes; the caller commits.

    Parameters
    ----------
    session : AsyncSession
        Active session; the router commits after a successful ``execute``.
    source : DovTrackSource | None
        Where the DOV XML is read from; defaults to the on-disk cache the DOV
        bbox import fills (``CachedDovTrackSource.from_settings()``).
    """

    def __init__(self, session: AsyncSession, source: DovTrackSource | None = None) -> None:
        """Initialise with an active ``AsyncSession`` (does NOT commit) and the XML source."""
        super().__init__(__name__)
        self._session = session
        self._source = source if source is not None else CachedDovTrackSource.from_settings()

    async def execute(
        self, *, project_id: UUID, borehole_id: UUID, track_id: str | None = None
    ) -> BoreholeTrackResetOutcome:
        """Reset every DOV track of the borehole, or only ``track_id``.

        Parameters
        ----------
        project_id : UUID
            Scope guard: the borehole must belong to this project.
        borehole_id : UUID
            The borehole.
        track_id : str | None
            One track (observation UUID or ``"field_log:<kind>"``); None = all.

        Returns
        -------
        BoreholeTrackResetOutcome
            The rewritten tracks + the discarded-edit and kept-manual counts.

        Raises
        ------
        NotFoundError
            The borehole is not in the project, or carries no such track.
        BoreholeResetNoDovSourceError
            No DOV XML for a targeted track (nothing was changed, 409).
        """
        self.info(f"reset to DOV: borehole={borehole_id} track={track_id or 'all'}")
        borehole = await load_borehole_with_tracks(self._session, borehole_id, project_id)
        try:
            outcome = reset_tracks_from_dov(borehole, self._source, track_id)
        except BoreholeResetNoDovSourceError as exc:
            self.warning(
                f"reset to DOV refused: borehole={borehole_id} ({borehole.test_id!r}) "
                f"track={track_id or 'all'}: {exc.reason}"
            )
            raise
        await self._session.flush()
        for i, snap in enumerate(outcome.reset, 1):
            self.debug(
                f"reset to DOV [{i}/{len(outcome.reset)}]: {snap.track_id} {snap.kind} "
                f"-> {len(snap.intervals)} interval(s)"
            )
        self.success(
            f"reset to DOV: borehole={borehole_id} ({borehole.test_id!r}) - "
            f"{len(outcome.reset)} track(s) rewritten, {outcome.discarded_edits} hand "
            f"edit(s) discarded, {outcome.kept_manual} manual track(s) kept"
        )
        return outcome
