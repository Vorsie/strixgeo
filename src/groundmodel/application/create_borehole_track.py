"""Use case: add a track to a borehole by hand (owner 2026-09-29).

"I want to add columns on the borehole itself": the engineer picks a kind
(coded lithology, a description, a stratigraphy, a field-log colour /
moisture / consistency, ...) and types its intervals. The track is stamped
``source = "manual"`` (Data Integrity rule 1) so it never passes for DOV data,
and - by the track-preference rule - it is the one the sections draw for that
kind from now on.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.borehole_track_helpers import (
    FAMILY_FIELD_LOG,
    build_field_log_rows,
    build_observation_layers,
    field_log_snapshot,
    field_log_track_id,
    load_borehole_with_tracks,
    observation_snapshot,
    track_family,
    utc_now,
    validate_or_raise,
)
from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_source import TrackSource
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.exceptions import BoreholeTrackConflictError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CreateBoreholeTrack(GroundModelLogger):
    """Create one hand-typed track on a borehole. Flushes; the caller commits.

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
        kind: str,
        intervals: Sequence[TrackInterval],
    ) -> BoreholeTrackSnapshot:
        """Validate and store a new manual track.

        Parameters
        ----------
        project_id : UUID
            Scope guard: the borehole must belong to this project.
        borehole_id : UUID
            The borehole to add the track to.
        kind : str
            ``ObservationType`` or ``FieldLogKind`` value.
        intervals : Sequence[TrackInterval]
            The typed intervals, any order.

        Returns
        -------
        BoreholeTrackSnapshot
            The stored track (depth-ordered, on the 1 mm grain) with the
            non-blocking warnings of the save.

        Raises
        ------
        NotFoundError
            When the borehole is not in the project.
        BoreholeTrackValidationError
            When an interval breaks a blocking rule (422).
        BoreholeTrackConflictError
            When a field-log track of ``kind`` already exists (409).
        """
        self.info(f"create track: borehole={borehole_id} kind={kind!r} intervals={len(intervals)}")
        borehole = await load_borehole_with_tracks(self._session, borehole_id, project_id)
        result = validate_or_raise(kind, intervals, borehole.total_depth_m)
        stamp = utc_now()

        if track_family(kind) == FAMILY_FIELD_LOG:
            if any(row.kind == kind for row in borehole.field_log_intervals):
                self.warning(
                    f"create track refused: borehole={borehole_id} already has a {kind!r} "
                    "field-log track"
                )
                raise BoreholeTrackConflictError(kind, field_log_track_id(kind))
            rows = build_field_log_rows(
                borehole.id,
                kind,
                result.intervals,
                source=TrackSource.MANUAL.value,
                edited_at=stamp,
            )
            borehole.field_log_intervals.extend(rows)
            borehole.n_field_log_intervals = len(borehole.field_log_intervals)
            await self._session.flush()
            snapshot = field_log_snapshot(kind, rows, result.warnings)
        else:
            observation = ObservationOrm(
                id=uuid7(),
                borehole_id=borehole.id,
                dov_permkey=None,
                observation_type=kind,
                # The interpretation date of a hand-typed track is the day it
                # was typed; it keeps today's date order meaningful.
                observation_date=date.today(),
                source=TrackSource.MANUAL.value,
                edited_manually_at=stamp,
                layers=build_observation_layers(result.intervals),
            )
            borehole.observations.append(observation)
            await self._session.flush()
            snapshot = observation_snapshot(observation, result.warnings)

        self.success(
            f"create track: borehole={borehole_id} kind={kind!r} -> {snapshot.track_id} "
            f"({len(snapshot.intervals)} intervals, {len(result.warnings)} warning(s))"
        )
        return snapshot
