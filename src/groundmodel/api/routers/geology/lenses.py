"""Geology API — lens body metadata + absence endpoints (#101 R4 Position 4).

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints
---------
GET  /models/{model_id}/lenses
    List all LithoLensOrm metadata rows (named bodies) for a model.

POST /models/{model_id}/lenses
    Create or update a name label for a lens body
    (identified by formation_id + body_ordinal).

DELETE /models/{model_id}/lenses/{lens_id}
    Delete the metadata row for a named lens body.
    Absence rows and synthetic contacts are preserved.

POST /models/{model_id}/lenses/{lens_id}/perpendicular-companion
    Auto-create a perpendicular companion section for a lens.

POST /projects/{project_id}/formations/{formation_id}/absences
    Upsert a user-intent formation absence (manual / observed).

POST /models/{model_id}/formations/{formation_id}/absences/recompute
    Re-run the inference engine for a body and apply the delta.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.litho_lens import (
    LithoLensListItem,
    NameLensBodyRequest,
    NameLensBodyResponse,
    UpsertFormationAbsenceRequest,
    UpsertFormationAbsenceResponse,
)
from groundmodel.application.create_perpendicular_companion import CreatePerpendicularCompanion
from groundmodel.application.delete_lens_metadata import DeleteLensMetadata
from groundmodel.application.name_lens_body import NameLensBody
from groundmodel.application.recompute_formation_absences_for_body import (
    RecomputeFormationAbsencesForBody,
)
from groundmodel.application.upsert_formation_absence import UpsertFormationAbsence
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Lens metadata list
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/lenses",
    response_model=list[LithoLensListItem],
)
async def list_litho_lenses(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[LithoLensOrm]:
    """List all named lens bodies for a lithostratigraphic model.

    Returns a lightweight list item for every ``LithoLensOrm`` metadata row
    that belongs to this project + model pair, ordered by creation timestamp
    (oldest first).  Note that un-named bodies (those not explicitly given a
    label by the user) do not appear here — they are auto-detected from the
    correlation graph at query time.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[LithoLensListItem]
        All named lens bodies in this model, oldest-first.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    from sqlalchemy import select

    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )
    stmt = (
        select(LithoLensOrm)
        .where(
            LithoLensOrm.app_project_id == project_id,
            LithoLensOrm.model_id == model_id,
        )
        .order_by(LithoLensOrm.created_at)
    )
    result = await session.execute(stmt)
    lenses = list(result.scalars().all())
    logger.debug(
        f"list_litho_lenses: project={project_id} model={model_id} → {len(lenses)} named lens(es)"
    )
    return lenses


# ---------------------------------------------------------------------------
# Name a lens body
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/lenses",
    response_model=NameLensBodyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def name_lens_body(
    project_id: UUID,
    model_id: UUID,
    request: NameLensBodyRequest,
    session: AsyncSession = Depends(get_session),
) -> NameLensBodyResponse:
    """Attach a name to a lens body identified by (formation_id, body_ordinal).

    Creates a ``LithoLensOrm`` metadata row if none exists for the
    ``(model_id, formation_id, body_ordinal)`` triple; updates the name
    field if a row already exists.  The body itself is defined by the
    correlation resolver — this endpoint only attaches a label to it.

    The model must be of ``kind='lithostratigraphic'``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    request : NameLensBodyRequest
        Body: formation_id, body_ordinal, name, optional primary_section_id.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    NameLensBodyResponse
        The lens metadata row id and a ``was_created`` flag.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model kind is not ``'lithostratigraphic'``, or when the
        formation is not found in the project.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    if model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "wrong_model_kind",
                "message": (
                    f"Model {model_id} has kind='{model.kind}'; "
                    f"lenses require kind='{MODEL_KIND_LITHOSTRATIGRAPHIC}'."
                ),
            },
        )

    try:
        result = await NameLensBody(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=request.formation_id,
            body_ordinal=request.body_ordinal,
            name=request.name,
            primary_section_id=request.primary_section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "name_lens_error", "message": str(exc)},
        ) from exc

    return NameLensBodyResponse(lens_id=result.lens_id, was_created=result.was_created)


# ---------------------------------------------------------------------------
# Delete lens metadata
# ---------------------------------------------------------------------------


@router.delete(
    "/models/{model_id}/lenses/{lens_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_lens_metadata(
    project_id: UUID,
    model_id: UUID,
    lens_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete the name label (LithoLensOrm metadata row) for a lens body.

    The lens body itself (contacts, absence rows, synthetic contacts)
    is NOT deleted — only the human-readable label is removed.  The body
    continues to exist in the correlation graph and its absence rows survive
    intact.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    lens_id : UUID
        The ``LithoLensOrm`` row to delete.
    session : AsyncSession
        Database session provided by DI.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project, or when the metadata
        row does not exist or belongs to a different project/model.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    lens = await session.get(LithoLensOrm, lens_id)
    if lens is None or lens.app_project_id != project_id or lens.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "lens_not_found", "message": f"Lens {lens_id} not found."},
        )

    await DeleteLensMetadata(session).execute(
        project_id=project_id,
        model_id=model_id,
        lens_id=lens_id,
    )


# ---------------------------------------------------------------------------
# Perpendicular companion section
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/lenses/{lens_id}/perpendicular-companion",
    response_model=CrossSectionResponse,
)
async def create_perpendicular_companion(
    project_id: UUID,
    model_id: UUID,
    lens_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Auto-create a perpendicular companion cross-section for a lens body.

    Creates a new cross-section perpendicular to the primary section on
    which the lens body was named, centred on the body's formation-contact
    centroid.  The half-lengths are determined by the nearest investigation
    on each side within the search buffer; the Q3 fallback is
    ``max(2 × primary_buffer_m, 100 m)``.

    **Idempotent.** If the lens already has a companion section, the
    existing section is returned with ``HTTP 200``; a freshly created
    companion returns ``HTTP 201``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    lens_id : UUID
        The ``LithoLensOrm`` row that defines the body.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    CrossSectionResponse
        The companion section (newly created or pre-existing).

    Raises
    ------
    HTTPException(404)
        When the model or lens is not found in the project scope.
    HTTPException(422)
        When ``primary_section_id`` is null on the lens, or when the
        primary section has been deleted.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    lens = await session.get(LithoLensOrm, lens_id)
    if lens is None or lens.app_project_id != project_id or lens.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "lens_not_found", "message": f"Lens {lens_id} not found."},
        )

    try:
        result = await CreatePerpendicularCompanion(session).execute(
            project_id=project_id,
            model_id=model_id,
            lens_id=lens_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "companion_error", "message": str(exc)},
        ) from exc

    response = CrossSectionResponse.model_validate(result.companion_section)
    response.companion_lens_name = lens.name

    http_status = status.HTTP_200_OK if result.already_existed else status.HTTP_201_CREATED
    return JSONResponse(
        status_code=http_status,
        content=response.model_dump(mode="json"),
    )


# ---------------------------------------------------------------------------
# Upsert a user-intent formation absence
# ---------------------------------------------------------------------------


@router.post(
    "/formations/{formation_id}/absences",
    response_model=UpsertFormationAbsenceResponse,
    status_code=status.HTTP_200_OK,
)
async def upsert_formation_absence(
    project_id: UUID,
    formation_id: UUID,
    request: UpsertFormationAbsenceRequest,
    session: AsyncSession = Depends(get_session),
) -> UpsertFormationAbsenceResponse:
    """Create or promote a formation absence row.

    Supports two gestures from the "Inspect lens body" panel:

    * **Confirm absence** — promotes an existing ``source='inferred'`` row
      to ``source='manual'``.  The inference engine will not overwrite it
      on the next recompute.
    * **Manual absence** — adds a ``source='manual'`` or ``source='observed'``
      row for an investigation the engine did not infer.

    ``source='inferred'`` is rejected — that source belongs to the inference
    engine.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    formation_id : UUID
        The geological formation to record absence for.
    request : UpsertFormationAbsenceRequest
        investigation_id, investigation_kind, source.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    UpsertFormationAbsenceResponse
        The absence row id and a ``was_created`` flag.

    Raises
    ------
    HTTPException(422)
        When ``source`` is not allowed, the formation is not found, or the
        investigation is not found.
    """
    try:
        result = await UpsertFormationAbsence(session).execute(
            project_id=project_id,
            formation_id=formation_id,
            investigation_id=request.investigation_id,
            investigation_kind=request.investigation_kind,
            source=request.source,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "absence_upsert_error", "message": str(exc)},
        ) from exc

    return UpsertFormationAbsenceResponse(
        absence_id=result.absence_id,
        was_created=result.was_created,
    )


# ---------------------------------------------------------------------------
# Recompute inference for a body
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/formations/{formation_id}/absences/recompute",
    status_code=status.HTTP_200_OK,
)
async def recompute_formation_absences(
    project_id: UUID,
    model_id: UUID,
    formation_id: UUID,
    body_ordinal: int = 0,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Re-run the inference engine for a body and apply the delta.

    Triggered after correlation-edge mutations or observation-data mutations.
    Idempotent — safe to call multiple times.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model that owns the body.
    formation_id : UUID
        The formation whose body is being re-evaluated.
    body_ordinal : int
        Zero-based ordinal from the resolver (defaults to 0 for single-body
        formations).
    section_id : UUID | None
        Section that defines the corridor.  Required.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    dict
        ``written``, ``retracted``, ``skipped_no_data`` counts.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When ``section_id`` is missing or the formation is not found.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    if section_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "missing_section_id", "message": "section_id is required"},
        )

    try:
        result = await RecomputeFormationAbsencesForBody(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=formation_id,
            body_ordinal=body_ordinal,
            section_id=section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "recompute_error", "message": str(exc)},
        ) from exc

    return {
        "written": result.written_count,
        "retracted": result.retracted_count,
        "skipped_no_data": result.skipped_no_data_count,
    }
