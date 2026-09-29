"""Use case: change a borehole track's intervals by hand (owner 2026-09-29).

"I want to be able to add or change any track": the engineer rewrites the
intervals of any track, imported ones included. The whole interval list is
replaced (the editor always sends the full track), which keeps the layer
indexes and the no-overlap rule simple.

Provenance (Data Integrity rule 1): the track keeps its ``source`` - an
imported track stays ``"dov"`` and keeps its ``dov_permkey`` - and gets
``edited_manually_at`` stamped so the UI can say "edited by hand".
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

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
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_source import TrackSource
from groundmodel.shared.exceptions import NotFoundError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ReplaceBoreholeTrack(GroundModelLogger):
    """Replace the intervals of one borehole track. Flushes; the caller commits.

    Parameters
    ----------
    session : AsyncSession
        Active session; the router commits after a successful ``execute``.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession`` (does NOT commit)."""
        super().__init__(__name__)
        self._session = session

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
            for row in old_rows:
                borehole.field_log_intervals.remove(row)
            rows = build_field_log_rows(
                borehole.id, kind, result.intervals, source=source, edited_at=stamp
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
            # delete-orphan on ``layers`` removes the old rows (and their
            # admixtures) at flush; the new rows are indexed in depth order.
            observation.layers = build_observation_layers(result.intervals)
            observation.edited_manually_at = stamp
            await self._session.flush()
            snapshot = observation_snapshot(observation, result.warnings)
            self.debug(
                f"replace track: {previous} -> {len(observation.layers)} layers "
                f"({observation.observation_type}, source={observation.source}, "
                f"dov_permkey={observation.dov_permkey})"
            )

        self.success(
            f"replace track: borehole={borehole_id} track={track_id} kind={snapshot.kind!r} "
            f"source={snapshot.source} ({len(snapshot.intervals)} intervals, "
            f"{len(snapshot.warnings)} warning(s))"
        )
        return snapshot
