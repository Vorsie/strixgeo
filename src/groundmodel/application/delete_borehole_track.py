"""Use case: delete a whole borehole track (owner 2026-09-29).

Irreversible from the app's point of view: the desktop asks first (Cancel
default-focused, "Delete track"). A deleted DOV observation track STAYS deleted
on a DOV bbox re-import (owner dogfeed 2026-10-01): its permkey is remembered
on the borehole (``BoreholeOrm.deleted_dov_permkeys``) and the interpretation
import skips it; Reset to DOV cannot bring it back either (it rewrites the
tracks the borehole still holds). A deleted DOV field-log track does not come
back on an import, only through Reset to DOV when the boring XML is cached
(see docs/domain-model.md, "Hand-edited tracks").
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.borehole_track_helpers import (
    FAMILY_FIELD_LOG,
    load_borehole_with_tracks,
    parse_track_id,
)
from groundmodel.domain.value_objects.track_source import TrackSource
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.exceptions import NotFoundError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteBoreholeTrack(GroundModelLogger):
    """Delete one borehole track with all its intervals. Flushes; the caller commits.

    Parameters
    ----------
    session : AsyncSession
        Active session; the router commits after a successful ``execute``.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession`` (does NOT commit)."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, *, project_id: UUID, borehole_id: UUID, track_id: str) -> int:
        """Delete ``track_id`` from the borehole.

        Parameters
        ----------
        project_id : UUID
            Scope guard: the borehole must belong to this project.
        borehole_id : UUID
            The borehole carrying the track.
        track_id : str
            Observation UUID, or ``"field_log:<kind>"``.

        Returns
        -------
        int
            How many intervals were removed with the track.

        Raises
        ------
        NotFoundError
            When the borehole is not in the project or carries no such track.
        """
        self.info(f"delete track: borehole={borehole_id} track={track_id}")
        family, key = parse_track_id(track_id)
        borehole = await load_borehole_with_tracks(self._session, borehole_id, project_id)

        if family == FAMILY_FIELD_LOG:
            rows = [row for row in borehole.field_log_intervals if row.kind == key]
            if not rows:
                raise NotFoundError(f"Track {track_id} not found on borehole {borehole_id}")
            for row in rows:
                borehole.field_log_intervals.remove(row)
            borehole.n_field_log_intervals = len(borehole.field_log_intervals)
            removed = len(rows)
            detail = f"{key!r} field log"
        else:
            observation = next((o for o in borehole.observations if o.id == key), None)
            if observation is None:
                raise NotFoundError(f"Track {track_id} not found on borehole {borehole_id}")
            removed = len(observation.layers)
            detail = (
                f"{observation.observation_type} (source={observation.source}, "
                f"dov_permkey={observation.dov_permkey})"
            )
            _remember_deleted_dov_permkey(borehole, observation)
            detail += f"; {len(borehole.deleted_dov_permkeys or [])} deleted DOV permkey(s) kept"
            borehole.observations.remove(observation)
        await self._session.flush()
        self.success(
            f"delete track: borehole={borehole_id} track={track_id} {detail} - "
            f"{removed} interval(s) removed"
        )
        return removed


def _remember_deleted_dov_permkey(borehole: BoreholeOrm, observation: ObservationOrm) -> None:
    """Record a deleted DOV track's permkey so a DOV re-import cannot bring it back.

    Owner dogfeed 2026-10-01. A hand-made track has no permkey and nothing to
    remember; a field-log track needs none either (a re-import never re-adds the
    field logs of a borehole the project already holds). A NEW list is assigned
    so SQLAlchemy sees the array change.
    """
    permkey = observation.dov_permkey
    if not permkey or observation.source == TrackSource.MANUAL.value:
        return
    remembered = list(borehole.deleted_dov_permkeys or [])
    if permkey not in remembered:
        borehole.deleted_dov_permkeys = [*remembered, permkey]
