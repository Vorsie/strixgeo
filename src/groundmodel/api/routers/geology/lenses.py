"""Geology API — litho-lens CRUD + perpendicular companion endpoints (#101 Slices 3–6).

Mounted under the shared ``/projects/{project_id}/geology`` prefix by
this package's ``__init__``; paths follow the existing contact pattern.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.litho_lens import (
    CreateLithoLensRequest,
    CreateLithoLensResponse,
    LithoLensListItem,
)
from groundmodel.application.create_litho_lens import CreateLithoLens
from groundmodel.application.create_perpendicular_companion import CreatePerpendicularCompanion
from groundmodel.application.delete_litho_lens import DeleteLithoLens
from groundmodel.domain.services.lens_pinch_out_geometry import LensPinchGeometryError
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


@router.get(
    "/models/{model_id}/lenses",
    response_model=list[LithoLensListItem],
)
async def list_litho_lenses(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[LithoLensOrm]:
    """List all lenses for a lithostratigraphic model.

    Returns a lightweight list item for every lens that belongs to this
    project + model pair, ordered by creation timestamp (oldest first).
    Used by the LithologyInspector to display per-formation lens counts
    (#101 Slice 6).

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
        All lenses in this model, oldest-first.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
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
        f"list_litho_lenses: project={project_id} model={model_id} → {len(lenses)} lens(es)"
    )
    return lenses


@router.post(
    "/models/{model_id}/lenses",
    response_model=CreateLithoLensResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_litho_lens(
    project_id: UUID,
    model_id: UUID,
    request: CreateLithoLensRequest,
    session: AsyncSession = Depends(get_session),
) -> CreateLithoLensResponse:
    """Create a litho lens entity with section-local wedge-tip contacts.

    Atomically creates the ``litho_lens`` row, records absence records,
    tags present contacts, computes wedge-tip synthetic contacts for each
    absent column, and unions all new contact ids into the section's
    ``seeded_formation_contact_ids`` (explicit-content invariant).

    The model must be of ``kind='lithostratigraphic'`` — lenses belong to
    the lithostratigraphic level of the three-level model.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    request : CreateLithoLensRequest
        Lens definition: parent formation, section context, present
        contact ids, and absent investigations.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    CreateLithoLensResponse
        Lens id, synthetic contact ids, skip count, and updated section.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When ``model.kind != 'lithostratigraphic'``, when the parent
        formation is not in the model, when a present contact id is not
        on the formation, when an absent investigation is not in the
        project, or when lens-pinch-out geometry is uncomputable for
        every absent column.
    """
    # Scope guard — model must exist and belong to this project.
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    # Kind guard — only lithostratigraphic models can own lenses.
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
        result = await CreateLithoLens(session).execute(
            project_id=project_id,
            model_id=model_id,
            parent_formation_id=request.parent_formation_id,
            section_id=request.section_id,
            name=request.name,
            present_contact_ids=request.present_contact_ids,
            absent_investigations=[(a.kind, a.id) for a in request.absent_investigations],
        )
    except (ValueError, LensPinchGeometryError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "create_lens_error", "message": str(exc)},
        ) from exc

    return CreateLithoLensResponse(
        lens_id=result.lens_id,
        synthetic_contact_ids=result.synthetic_contact_ids,
        skipped_absent_count=result.skipped_absent_count,
        updated_section=CrossSectionResponse.model_validate(result.updated_section),
    )


@router.delete(
    "/models/{model_id}/lenses/{lens_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_litho_lens(
    project_id: UUID,
    model_id: UUID,
    lens_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a litho lens and its owned synthetic contacts.

    Anchored contacts (borehole- or CPT-tagged contacts that were marked
    as belonging to this lens) survive deletion — only their ``lens_id``
    is cleared by the FK ON DELETE SET NULL.  Synthetic-only contacts
    (the wedge-tip contacts created by ``create_litho_lens``) are
    explicitly deleted.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    lens_id : UUID
        The lens to delete.
    session : AsyncSession
        Database session provided by DI.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project, or when the lens
        does not exist or belongs to a different project/model.
    """
    # Model scope guard.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    # Lens scope guard — verify the lens exists before delegating.
    lens = await session.get(LithoLensOrm, lens_id)
    if lens is None or lens.app_project_id != project_id or lens.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "lens_not_found", "message": f"Lens {lens_id} not found."},
        )

    await DeleteLithoLens(session).execute(
        project_id=project_id,
        model_id=model_id,
        lens_id=lens_id,
    )


@router.post(
    "/models/{model_id}/lenses/{lens_id}/perpendicular-companion",
    response_model=CrossSectionResponse,
    # Default status_code omitted — the handler returns 201 (new) or 200
    # (already existed).  FastAPI uses 200 as the OpenAPI default when
    # status_code is absent; callers must check the actual response code.
)
async def create_perpendicular_companion(
    project_id: UUID,
    model_id: UUID,
    lens_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Auto-create a perpendicular companion cross-section for a litho lens.

    Creates a new cross-section perpendicular to the primary section on
    which the lens was defined, centred on the lens centroid.  The half-
    lengths of the companion section are determined by the nearest
    investigation on each side within ``_SEARCH_BUFFER_M``; when no
    investigation is found on a side the fallback is
    ``max(2 × primary_buffer_m, 100 m)``.

    **Idempotent.** If the lens already has a companion section, the
    existing section is returned with ``HTTP 200``; a freshly created
    companion returns ``HTTP 201``.  The ``already_existed`` flag is
    surfaced in the response body when ``already_existed=True``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    lens_id : UUID
        The lens to create a companion section for.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    CrossSectionResponse
        The companion section (newly created or pre-existing).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project, or when the lens
        does not exist in the project/model scope.
    HTTPException(422)
        When ``primary_section_id`` is null on the lens (pre-Slice-4 lens
        with no recorded primary section), or when the primary section has
        been deleted.
    """
    # Model scope guard.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
    )

    # Lens scope guard.
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

    # Enrich the response with the lens name so the section header
    # can display "Companion of: <lens name>" without a second fetch.
    response = CrossSectionResponse.model_validate(result.companion_section)
    response.companion_lens_name = lens.name

    # 201 for a freshly-created companion; 200 for an idempotent re-call.
    # The client uses the status code to decide whether to show a toast
    # ("section created") vs a silent no-op.
    http_status = status.HTTP_200_OK if result.already_existed else status.HTTP_201_CREATED
    return JSONResponse(
        status_code=http_status,
        content=response.model_dump(mode="json"),
    )
