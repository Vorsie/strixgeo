"""Borehole track route handlers - add / change / delete a track by hand.

Owner 2026-09-29: "i want to be able to add or change any track". A track is
one observation stream of a borehole (coded lithology, a description, a
stratigraphy, ...) or one field-log kind (colour / moisture / consistency).
One API shape for both ORM families: ``kind`` + ``intervals[{top_m, base_m,
value | description | main_soil_codes + admixtures + color}]``.

Mounted under ``/borehole`` next to ``borehole.py`` (kept separate so that
router does not grow past its size budget). Every route is project-scoped by
the required ``?project_id`` (VULN-6) and commits once.

Nothing downstream CACHES observation data: the litho suggestions, the
stratigraphy scan / auto-populate and the formation-absence inference all
re-read the observations on their next run, and no stored contact moves when
a track changes (unlike the elevation PATCH, which moves every anchored
contact's absolute z and so stales the TINs and 3-D solids). A track edit
therefore stales nothing.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.borehole.admixture_response import AdmixtureResponse
from groundmodel.api.schemas.borehole.borehole_track_create_request import (
    BoreholeTrackCreateRequest,
)
from groundmodel.api.schemas.borehole.borehole_track_replace_request import (
    BoreholeTrackReplaceRequest,
)
from groundmodel.api.schemas.borehole.borehole_track_response import BoreholeTrackResponse
from groundmodel.api.schemas.borehole.track_interval_request import TrackIntervalRequest
from groundmodel.api.schemas.borehole.track_interval_response import TrackIntervalResponse
from groundmodel.api.schemas.borehole.track_issue_response import TrackIssueResponse
from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot
from groundmodel.application.create_borehole_track import CreateBoreholeTrack
from groundmodel.application.delete_borehole_track import DeleteBoreholeTrack
from groundmodel.application.replace_borehole_track import ReplaceBoreholeTrack
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_issue import TrackIssue
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import (
    BoreholeTrackConflictError,
    BoreholeTrackValidationError,
    NotFoundError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger - routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


def _to_domain(intervals: list[TrackIntervalRequest]) -> list[TrackInterval]:
    """Map the request intervals onto domain ``TrackInterval`` objects."""
    return [
        TrackInterval(
            top_m=i.top_m,
            base_m=i.base_m,
            value=i.value,
            description=i.description,
            color=i.color,
            main_soil_codes=tuple(i.main_soil_codes),
            admixtures=tuple(
                Admixture(soil_code=a.soil_code, amount=a.amount, locally=a.locally)
                for a in i.admixtures
            ),
        )
        for i in intervals
    ]


def _issue(issue: TrackIssue) -> TrackIssueResponse:
    """Map a domain ``TrackIssue`` onto its wire shape."""
    return TrackIssueResponse(loc=issue.loc, code=issue.code, message=issue.message)


def _to_response(snapshot: BoreholeTrackSnapshot) -> BoreholeTrackResponse:
    """Map a use-case snapshot onto the response schema."""
    return BoreholeTrackResponse(
        track_id=snapshot.track_id,
        kind=snapshot.kind,
        family=snapshot.family,
        source=snapshot.source,
        edited_manually_at=snapshot.edited_manually_at,
        dov_permkey=snapshot.dov_permkey,
        intervals=[
            TrackIntervalResponse(
                top_m=i.top_m,
                base_m=i.base_m,
                value=i.value,
                description=i.description,
                color=i.color,
                main_soil_codes=list(i.main_soil_codes),
                admixtures=[
                    AdmixtureResponse(soil_code=a.soil_code, amount=a.amount, locally=a.locally)
                    for a in i.admixtures
                ],
            )
            for i in snapshot.intervals
        ],
        warnings=[_issue(w) for w in snapshot.warnings],
    )


def _validation_http_error(exc: BoreholeTrackValidationError) -> HTTPException:
    """Build the 422 for a refused track: every issue with its dotted key path."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "borehole_track_invalid",
            "message": str(exc),
            "errors": [_issue(e).model_dump() for e in exc.errors],
            "warnings": [_issue(w).model_dump() for w in exc.warnings],
        },
    )


@router.post(
    "/{borehole_id}/tracks",
    response_model=BoreholeTrackResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_borehole_track(
    borehole_id: UUID,
    project_id: UUID,
    request: BoreholeTrackCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> BoreholeTrackResponse:
    """Add a hand-typed track of ``kind`` to a borehole (``source = "manual"``).

    Parameters
    ----------
    borehole_id : UUID
        The borehole.
    project_id : UUID
        Required project scope guard.
    request : BoreholeTrackCreateRequest
        The kind and its intervals.
    session : AsyncSession
        Database session.

    Returns
    -------
    BoreholeTrackResponse
        The stored track (1 mm grain, depth-ordered) + non-blocking warnings.

    Raises
    ------
    HTTPException(404)
        The borehole is not in the project.
    HTTPException(409)
        ``code = "borehole_track_exists"``: a field-log track of that kind
        already exists on the borehole (edit it instead).
    HTTPException(422)
        ``code = "borehole_track_invalid"``: an interval breaks a rule; every
        issue carries its dotted key path.
    """
    logger.info(
        f"POST /borehole/{borehole_id}/tracks: kind={request.kind!r} "
        f"intervals={len(request.intervals)}"
    )
    try:
        snapshot = await CreateBoreholeTrack(session).execute(
            project_id=project_id,
            borehole_id=borehole_id,
            kind=request.kind,
            intervals=_to_domain(request.intervals),
        )
    except NotFoundError as exc:
        logger.warning(f"POST /borehole/{borehole_id}/tracks -> 404: {exc}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BoreholeTrackConflictError as exc:
        logger.warning(f"POST /borehole/{borehole_id}/tracks -> 409: {exc}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "borehole_track_exists",
                "message": str(exc),
                "kind": exc.kind,
                "track_id": exc.track_id,
            },
        ) from exc
    except BoreholeTrackValidationError as exc:
        logger.warning(f"POST /borehole/{borehole_id}/tracks -> 422: {exc}")
        raise _validation_http_error(exc) from exc
    await session.commit()
    return _to_response(snapshot)


@router.put("/{borehole_id}/tracks/{track_id}", response_model=BoreholeTrackResponse)
async def replace_borehole_track(
    borehole_id: UUID,
    track_id: str,
    project_id: UUID,
    request: BoreholeTrackReplaceRequest,
    session: AsyncSession = Depends(get_session),
) -> BoreholeTrackResponse:
    """Replace every interval of one track (imported tracks included).

    An imported track keeps ``source = "dov"`` and its ``dov_permkey`` and
    gets ``edited_manually_at`` stamped.

    Parameters
    ----------
    borehole_id : UUID
        The borehole.
    track_id : str
        Observation UUID, or ``"field_log:<kind>"``.
    project_id : UUID
        Required project scope guard.
    request : BoreholeTrackReplaceRequest
        The full new interval list.
    session : AsyncSession
        Database session.

    Returns
    -------
    BoreholeTrackResponse
        The stored track + non-blocking warnings.

    Raises
    ------
    HTTPException(404)
        The borehole is not in the project, or carries no such track.
    HTTPException(422)
        ``code = "borehole_track_invalid"`` (see the POST).
    """
    logger.info(
        f"PUT /borehole/{borehole_id}/tracks/{track_id}: intervals={len(request.intervals)}"
    )
    try:
        snapshot = await ReplaceBoreholeTrack(session).execute(
            project_id=project_id,
            borehole_id=borehole_id,
            track_id=track_id,
            intervals=_to_domain(request.intervals),
        )
    except NotFoundError as exc:
        logger.warning(f"PUT /borehole/{borehole_id}/tracks/{track_id} -> 404: {exc}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BoreholeTrackValidationError as exc:
        logger.warning(f"PUT /borehole/{borehole_id}/tracks/{track_id} -> 422: {exc}")
        raise _validation_http_error(exc) from exc
    await session.commit()
    return _to_response(snapshot)


@router.delete("/{borehole_id}/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_borehole_track(
    borehole_id: UUID,
    track_id: str,
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete one track with all its intervals (the desktop confirms first).

    Parameters
    ----------
    borehole_id : UUID
        The borehole.
    track_id : str
        Observation UUID, or ``"field_log:<kind>"``.
    project_id : UUID
        Required project scope guard.
    session : AsyncSession
        Database session.

    Raises
    ------
    HTTPException(404)
        The borehole is not in the project, or carries no such track.
    """
    logger.info(f"DELETE /borehole/{borehole_id}/tracks/{track_id}")
    try:
        await DeleteBoreholeTrack(session).execute(
            project_id=project_id, borehole_id=borehole_id, track_id=track_id
        )
    except NotFoundError as exc:
        logger.warning(f"DELETE /borehole/{borehole_id}/tracks/{track_id} -> 404: {exc}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await session.commit()
