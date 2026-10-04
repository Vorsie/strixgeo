"""Use case: reset a borehole's DOV tracks to what DOV published (owner 2026-09-30).

"there needs to be a per borehole button to reset to dov defaults though".
The rules live in ``borehole_track_dov_reset.reset_tracks_from_dov``; this use
case loads the borehole (project-scoped), runs it over the DOV XML cache, and
flushes. Destructive for hand edits on DOV tracks - the desktop confirms first
(Cancel default-focused, "Reset to DOV") and pushes no undo step.

Every reset logs one INFO timing line - load / DOV XML lookup / parse +
rewrite / flush - because the owner found it slow (2026-10-04, "takes 5 to 10
seconds"): the cold boring-cache scan was the cost, and the next slow click
must be diagnosable from the log alone.
"""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.borehole_track_dov_reset import reset_tracks_from_dov
from groundmodel.application.borehole_track_helpers import load_borehole_with_tracks
from groundmodel.application.borehole_track_reset_outcome import BoreholeTrackResetOutcome
from groundmodel.application.dov_track_source import DovTrackSource
from groundmodel.application.timed_dov_track_source import TimedDovTrackSource
from groundmodel.infrastructure.parsers.borehole.dov.cached_dov_track_source import (
    CachedDovTrackSource,
)
from groundmodel.shared.exceptions import BoreholeResetNoDovSourceError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since


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
        start = time.perf_counter()
        borehole = await load_borehole_with_tracks(self._session, borehole_id, project_id)
        load_ms = ms_since(start)
        timed = TimedDovTrackSource(self._source)
        rules_start = time.perf_counter()
        try:
            outcome = reset_tracks_from_dov(borehole, timed, track_id)
        except BoreholeResetNoDovSourceError as exc:
            self.warning(
                f"reset to DOV refused: borehole={borehole_id} ({borehole.test_id!r}) "
                f"track={track_id or 'all'}: {exc.reason} "
                f"(DOV XML lookup {round(timed.seconds * 1000)} ms)"
            )
            raise
        rules_ms = ms_since(rules_start)
        lookup_ms = round(timed.seconds * 1000)
        flush_start = time.perf_counter()
        await self._session.flush()
        self.info(
            f"reset to DOV timing: borehole={borehole_id} ({borehole.test_id!r}) "
            f"load {load_ms} ms, DOV XML lookup {lookup_ms} ms "
            f"({timed.boring_reads} boring + {timed.interpretation_reads} interpretation "
            f"read(s)), parse + rewrite {max(rules_ms - lookup_ms, 0)} ms, "
            f"flush {ms_since(flush_start)} ms, total {ms_since(start)} ms"
        )
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
