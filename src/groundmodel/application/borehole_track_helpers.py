"""Shared helpers of the borehole track use cases (create / replace / delete).

Two ORM families back one API shape: an observation track is one
``observation`` row with its ``observation_layer`` + ``admixture`` children;
a field-log track is the ``field_log_interval`` rows of one ``kind`` on the
borehole. These helpers are where the two branch, so the three use cases stay
family-agnostic.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot
from groundmodel.domain.services.borehole_track_constants import (
    FIELD_LOG_TRACK_ID_PREFIX,
    FIELD_LOG_TRACK_KINDS,
)
from groundmodel.domain.services.validate_track_intervals import validate_track_intervals
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_issue import TrackIssue
from groundmodel.domain.value_objects.track_validation_result import TrackValidationResult
from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.exceptions import BoreholeTrackValidationError, NotFoundError

FAMILY_OBSERVATION = "observation"
FAMILY_FIELD_LOG = "field_log"


def utc_now() -> datetime:
    """Return the current UTC time (the ``edited_manually_at`` stamp)."""
    return datetime.now(UTC)


def track_family(kind: str) -> str:
    """Return the ORM family (``"observation"`` / ``"field_log"``) of a track kind."""
    return FAMILY_FIELD_LOG if kind in FIELD_LOG_TRACK_KINDS else FAMILY_OBSERVATION


def field_log_track_id(kind: str) -> str:
    """Return the synthetic API id of a borehole's field-log track of ``kind``."""
    return f"{FIELD_LOG_TRACK_ID_PREFIX}{kind}"


def parse_track_id(track_id: str) -> tuple[str, UUID | str]:
    """Split an API track id into its family and key.

    Parameters
    ----------
    track_id : str
        An observation UUID, or ``"field_log:<kind>"``.

    Returns
    -------
    tuple[str, UUID | str]
        ``("observation", UUID)`` or ``("field_log", kind)``.

    Raises
    ------
    NotFoundError
        When the id is neither a UUID nor a known field-log track id - an
        unparseable id names no track, which is a 404 like any other miss.
    """
    if track_id.startswith(FIELD_LOG_TRACK_ID_PREFIX):
        kind = track_id[len(FIELD_LOG_TRACK_ID_PREFIX) :]
        if kind in FIELD_LOG_TRACK_KINDS:
            return FAMILY_FIELD_LOG, kind
        raise NotFoundError(f"Track {track_id} not found")
    try:
        return FAMILY_OBSERVATION, UUID(track_id)
    except ValueError as exc:
        raise NotFoundError(f"Track {track_id} not found") from exc


async def load_borehole_with_tracks(
    session: AsyncSession, borehole_id: UUID, project_id: UUID
) -> BoreholeOrm:
    """Load a borehole of ``project_id`` with every track eager-loaded.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    borehole_id : UUID
        The borehole.
    project_id : UUID
        Scope guard: the borehole must belong to this project.

    Returns
    -------
    BoreholeOrm
        The borehole with ``observations -> layers -> admixtures`` and
        ``field_log_intervals`` loaded (a lazy load would raise
        ``MissingGreenlet`` under async).

    Raises
    ------
    NotFoundError
        When the borehole does not exist or belongs to another project (same
        message for both, VULN-6).
    """
    borehole = (
        await session.execute(
            select(BoreholeOrm)
            .where(BoreholeOrm.id == borehole_id, BoreholeOrm.app_project_id == project_id)
            .options(
                selectinload(BoreholeOrm.field_log_intervals),
                selectinload(BoreholeOrm.observations)
                .selectinload(ObservationOrm.layers)
                .selectinload(ObservationLayerOrm.admixtures),
            )
        )
    ).scalar_one_or_none()
    if borehole is None:
        raise NotFoundError(f"Borehole {borehole_id} not found")
    return borehole


def validate_or_raise(
    kind: str, intervals: Sequence[TrackInterval], total_depth_m: float | None
) -> TrackValidationResult:
    """Run the domain validator; raise on a blocking finding.

    Raises
    ------
    BoreholeTrackValidationError
        When the validator reports any error (the warnings ride along).
    """
    result = validate_track_intervals(kind, intervals, total_depth_m=total_depth_m)
    if not result.ok:
        raise BoreholeTrackValidationError(result.errors, result.warnings)
    return result


def build_observation_layers(intervals: Iterable[TrackInterval]) -> list[ObservationLayerOrm]:
    """Map validated intervals onto fresh ``ObservationLayerOrm`` rows (index = order)."""
    return [
        ObservationLayerOrm(
            id=uuid7(),
            top_m=interval.top_m,
            base_m=interval.base_m,
            color=interval.color,
            main_soil_codes=list(interval.main_soil_codes),
            description=interval.description,
            layer_index=index,
            admixtures=[
                AdmixtureOrm(
                    id=uuid7(),
                    soil_code=adm.soil_code,
                    amount=adm.amount,
                    locally=adm.locally,
                )
                for adm in interval.admixtures
            ],
        )
        for index, interval in enumerate(intervals)
    ]


def build_field_log_rows(
    borehole_id: UUID,
    kind: str,
    intervals: Iterable[TrackInterval],
    *,
    source: str,
    edited_at: datetime | None,
) -> list[FieldLogIntervalOrm]:
    """Map intervals onto fresh ``FieldLogIntervalOrm`` rows of ``kind``.

    ``edited_at`` is the editor's save stamp; ``None`` for rows a Reset to DOV
    writes back as DOV published them.
    """
    return [
        FieldLogIntervalOrm(
            id=uuid7(),
            borehole_id=borehole_id,
            top_m=interval.top_m,
            base_m=interval.base_m,
            kind=kind,
            value=interval.value or "",
            source=source,
            edited_manually_at=edited_at,
        )
        for interval in intervals
    ]


def observation_snapshot(
    observation: ObservationOrm, warnings: tuple[TrackIssue, ...] = ()
) -> BoreholeTrackSnapshot:
    """Build the ORM-free snapshot of an observation track."""
    return BoreholeTrackSnapshot(
        track_id=str(observation.id),
        kind=observation.observation_type,
        family=FAMILY_OBSERVATION,
        source=observation.source,
        edited_manually_at=observation.edited_manually_at,
        dov_permkey=observation.dov_permkey,
        intervals=tuple(
            TrackInterval(
                top_m=layer.top_m,
                base_m=layer.base_m,
                description=layer.description,
                color=layer.color,
                main_soil_codes=tuple(layer.main_soil_codes),
                admixtures=tuple(
                    Admixture(soil_code=a.soil_code, amount=a.amount, locally=a.locally)
                    for a in layer.admixtures
                ),
            )
            for layer in observation.layers
        ),
        warnings=warnings,
    )


def field_log_snapshot(
    kind: str, rows: Sequence[FieldLogIntervalOrm], warnings: tuple[TrackIssue, ...] = ()
) -> BoreholeTrackSnapshot:
    """Build the ORM-free snapshot of a borehole's field-log track of ``kind``.

    The track's provenance is read off its rows: ``manual`` when any row was
    typed by hand, the newest ``edited_manually_at`` of the rows.
    """
    ordered = sorted(rows, key=lambda r: (r.top_m, r.base_m))
    stamps = [r.edited_manually_at for r in ordered if r.edited_manually_at is not None]
    source = "manual" if any(r.source == "manual" for r in ordered) else "dov"
    return BoreholeTrackSnapshot(
        track_id=field_log_track_id(kind),
        kind=kind,
        family=FAMILY_FIELD_LOG,
        source=source,
        edited_manually_at=max(stamps) if stamps else None,
        dov_permkey=None,
        intervals=tuple(
            TrackInterval(top_m=r.top_m, base_m=r.base_m, value=r.value) for r in ordered
        ),
        warnings=warnings,
    )
