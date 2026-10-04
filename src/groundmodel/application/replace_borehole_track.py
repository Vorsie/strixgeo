"""Use case: change a borehole track's intervals by hand (owner 2026-09-29).

"I want to be able to add or change any track": the engineer rewrites the
intervals of any track, imported ones included. The whole interval list is
replaced (the editor always sends the full track), which keeps the layer
indexes and the no-overlap rule simple.

Provenance (Data Integrity rule 1): the track keeps its ``source`` - an
imported track stays ``"dov"`` and keeps its ``dov_permkey`` - and gets
``edited_manually_at`` stamped so the UI can say "edited by hand".

Undo of a first edit (owner dogfeed 2026-10-01): a save that puts a DOV track
back to EXACTLY what DOV published clears ``edited_manually_at`` instead -
the badge follows the content, not the history. "What DOV published":

* an untouched DOV track (no stamp yet) IS DOV's content - it was written by
  the import or a Reset to DOV - so the save compares with the stored rows and
  reads nothing;
* an edited DOV track compares with the DOV XML the bbox import cached (the
  read a Reset to DOV does). No usable XML = the original is unknown, and the
  stamp stays (never claim DOV published what the engineer typed).

A manual track has no DOV original: every save stamps it.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.borehole_track_dov_reset import (
    dov_original_field_log_intervals,
    dov_original_observation_intervals,
)
from groundmodel.application.borehole_track_helpers import (
    FAMILY_FIELD_LOG,
    build_field_log_rows,
    build_observation_layers,
    field_log_snapshot,
    load_borehole_with_tracks,
    observation_snapshot,
    parse_track_id,
    utc_now,
    validate_or_raise,
)
from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot
from groundmodel.application.dov_track_source import DovTrackSource
from groundmodel.domain.services.validate_track_intervals import same_track_content
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_source import TrackSource
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.parsers.borehole.dov.cached_dov_track_source import (
    CachedDovTrackSource,
)
from groundmodel.shared.exceptions import NotFoundError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ReplaceBoreholeTrack(GroundModelLogger):
    """Replace the intervals of one borehole track. Flushes; the caller commits.

    Parameters
    ----------
    session : AsyncSession
        Active session; the router commits after a successful ``execute``.
    source : DovTrackSource | None
        Where an edited DOV track's original is read from; defaults to the
        on-disk cache the DOV bbox import fills.
    """

    def __init__(self, session: AsyncSession, source: DovTrackSource | None = None) -> None:
        """Initialise with an active ``AsyncSession`` (does NOT commit) and the XML source."""
        super().__init__(__name__)
        self._session = session
        self._source = source if source is not None else CachedDovTrackSource.from_settings()

    async def execute(
        self,
        *,
        project_id: UUID,
        borehole_id: UUID,
        track_id: str,
        intervals: Sequence[TrackInterval],
    ) -> BoreholeTrackSnapshot:
        """Validate and store the new intervals of ``track_id``.

        Parameters
        ----------
        project_id : UUID
            Scope guard: the borehole must belong to this project.
        borehole_id : UUID
            The borehole carrying the track.
        track_id : str
            Observation UUID, or ``"field_log:<kind>"``.
        intervals : Sequence[TrackInterval]
            The full new interval list, any order.

        Returns
        -------
        BoreholeTrackSnapshot
            The stored track with the non-blocking warnings of the save.

        Raises
        ------
        NotFoundError
            When the borehole is not in the project or carries no such track.
        BoreholeTrackValidationError
            When an interval breaks a blocking rule (422).
        """
        self.info(
            f"replace track: borehole={borehole_id} track={track_id} intervals={len(intervals)}"
        )
        family, key = parse_track_id(track_id)
        borehole = await load_borehole_with_tracks(self._session, borehole_id, project_id)
        stamp = utc_now()

        if family == FAMILY_FIELD_LOG:
            kind = str(key)
            old_rows = [row for row in borehole.field_log_intervals if row.kind == kind]
            if not old_rows:
                raise NotFoundError(f"Track {track_id} not found on borehole {borehole_id}")
            result = validate_or_raise(kind, intervals, borehole.total_depth_m)
            # The track keeps its provenance: a hand-made track stays manual,
            # an imported one stays dov (and is now marked edited).
            source = (
                TrackSource.MANUAL.value
                if any(r.source == TrackSource.MANUAL.value for r in old_rows)
                else TrackSource.DOV.value
            )
            edited_at = self._field_log_stamp(
                borehole.test_id, kind, old_rows, source, result.intervals, stamp
            )
            for row in old_rows:
                borehole.field_log_intervals.remove(row)
            rows = build_field_log_rows(
                borehole.id, kind, result.intervals, source=source, edited_at=edited_at
            )
            borehole.field_log_intervals.extend(rows)
            borehole.n_field_log_intervals = len(borehole.field_log_intervals)
            await self._session.flush()
            snapshot = field_log_snapshot(kind, rows, result.warnings)
            self.debug(f"replace track: {len(old_rows)} -> {len(rows)} {kind!r} rows")
        else:
            observation = next((o for o in borehole.observations if o.id == key), None)
            if observation is None:
                raise NotFoundError(f"Track {track_id} not found on borehole {borehole_id}")
            result = validate_or_raise(
                observation.observation_type, intervals, borehole.total_depth_m
            )
            previous = len(observation.layers)
            obs_edited_at = self._observation_stamp(
                borehole.id, observation, result.intervals, stamp
            )
            # delete-orphan on ``layers`` removes the old rows (and their
            # admixtures) at flush; the new rows are indexed in depth order.
            observation.layers = build_observation_layers(result.intervals)
            observation.edited_manually_at = obs_edited_at
            await self._session.flush()
            snapshot = observation_snapshot(observation, result.warnings)
            self.debug(
                f"replace track: {previous} -> {len(observation.layers)} layers "
                f"({observation.observation_type}, source={observation.source}, "
                f"dov_permkey={observation.dov_permkey})"
            )

        self.success(
            f"replace track: borehole={borehole_id} track={track_id} kind={snapshot.kind!r} "
            f"source={snapshot.source} edited_manually_at={snapshot.edited_manually_at} "
            f"({len(snapshot.intervals)} intervals, {len(snapshot.warnings)} warning(s))"
        )
        return snapshot

    def _observation_stamp(
        self,
        borehole_id: UUID,
        observation: ObservationOrm,
        intervals: Sequence[TrackInterval],
        stamp: datetime,
    ) -> datetime | None:
        """Return the observation's new edit stamp: None when it holds DOV's content again."""
        if observation.source == TrackSource.MANUAL.value:
            return stamp
        original: tuple[TrackInterval, ...] | None
        if observation.edited_manually_at is None:
            # Untouched: the stored layers ARE DOV's content.
            original = observation_snapshot(observation).intervals
            origin = "stored rows"
        else:
            original = dov_original_observation_intervals(borehole_id, observation, self._source)
            origin = f"cached interpretation {observation.dov_permkey}"
        return self._decide(f"observation {observation.id}", intervals, original, origin, stamp)

    def _field_log_stamp(
        self,
        boornummer: str,
        kind: str,
        old_rows: Sequence[FieldLogIntervalOrm],
        source: str,
        intervals: Sequence[TrackInterval],
        stamp: datetime,
    ) -> datetime | None:
        """Return the field-log track's new edit stamp: None when it holds DOV's content again."""
        if source == TrackSource.MANUAL.value:
            return stamp
        original: tuple[TrackInterval, ...] | None
        if all(row.edited_manually_at is None for row in old_rows):
            # Untouched: the stored rows ARE DOV's content.
            original = field_log_snapshot(kind, old_rows).intervals
            origin = "stored rows"
        else:
            original = dov_original_field_log_intervals(boornummer, kind, self._source)
            origin = f"cached boring {boornummer!r}"
        return self._decide(f"field_log:{kind}", intervals, original, origin, stamp)

    def _decide(
        self,
        label: str,
        intervals: Sequence[TrackInterval],
        original: Sequence[TrackInterval] | None,
        origin: str,
        stamp: datetime,
    ) -> datetime | None:
        """Clear the stamp when ``intervals`` equal DOV's ``original``; log the verdict."""
        if original is None:
            self.info(f"replace track: {label} - no DOV original ({origin} not usable); edited")
            return stamp
        if same_track_content(intervals, original):
            self.info(f"replace track: {label} equals DOV's content ({origin}); not edited")
            return None
        self.debug(f"replace track: {label} differs from DOV's content ({origin}); edited")
        return stamp
