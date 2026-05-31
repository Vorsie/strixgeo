"""Geology API — lens body metadata + absence endpoints (#101 R4 Position 4).

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints
---------
GET  /models/{model_id}/lenses
    List all LithoLensOrm metadata rows (named bodies) for a model.

POST /models/{model_id}/lenses/detect
    Explicit "Detect lenses" verb — runs the correlation-graph lens
    detector and reconciles ``LithoLensOrm`` rows.  Replaces the
    auto-detect that used to fire from every edge mutation and every
    destructive op (owner directive 2026-05-31).

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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.litho_lens import (
    DetectLensesResponse,
    FormationAbsenceItem,
    LithoLensListItem,
    NameLensBodyRequest,
    NameLensBodyResponse,
    UpsertFormationAbsenceRequest,
    UpsertFormationAbsenceResponse,
)
from groundmodel.api.schemas.project.litho_lens_boundary import (
    LensBoundaryNodeItem,
    LensBoundaryResponse,
    LensBoundaryWriteRequest,
)
from groundmodel.application.create_perpendicular_companion import CreatePerpendicularCompanion
from groundmodel.application.delete_lens_metadata import DeleteLensMetadata
from groundmodel.application.detect_litho_lenses import DetectLithoLenses
from groundmodel.application.lens_boundary import (
    BoundaryNode,
    GetLensBoundary,
    LensNoPrimarySectionError,
    LensNotDetectedError,
    LensNotFoundError,
    SaveLensBoundary,
)
from groundmodel.application.name_lens_body import NameLensBody
from groundmodel.application.recompute_all_absences_for_model import RecomputeAllAbsencesForModel
from groundmodel.application.recompute_formation_absences_for_body import (
    RecomputeFormationAbsencesForBody,
)
from groundmodel.application.upsert_formation_absence import UpsertFormationAbsence
from groundmodel.infrastructure.db.models.body_orm import (
    BodyOrm as LithoLensOrm,
)  # TODO: slice 2 — full rename
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
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

    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
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
# Explicit "Detect lenses" verb
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/lenses/detect",
    response_model=DetectLensesResponse,
)
async def detect_litho_lenses(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> DetectLensesResponse:
    """Run the explicit "Detect lenses" pass on a lithostratigraphic model.

    Materialises ``LithoLensOrm`` rows for #135 lens topologies in the
    user-approved contact-edge graph and removes rows whose body no
    longer matches.  Idempotent.

    Until 2026-05-31 this pass fired implicitly from every edge mutation
    (correlate / uncorrelate / accept) and every destructive op (delete
    contact, delete layer, contact cross-merge).  Owner directive
    removed those auto-fires — a single manual correlate that
    incidentally closed a lens topology was silently spawning a
    ``LithoLensOrm`` row.  This endpoint is now the only entry point.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    DetectLensesResponse
        Counts of created, removed, and ordinal-skipped lens rows.

    Raises
    ------
    HTTPException(404)
        Model not found in the project.
    HTTPException(422)
        Model is not lithostratigraphic.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    if model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Model {model_id} is of kind {model.kind!r}; "
                "lens detection only runs on lithostratigraphic models."
            ),
        )
    result = await DetectLithoLenses(session).execute(
        project_id=project_id,
        model_id=model_id,
        prefer_section_id=None,
    )
    # DetectLithoLenses flushes but does NOT commit (it's designed to
    # compose inside larger transactions).  This explicit endpoint owns
    # the commit boundary.
    await session.commit()
    logger.success(
        f"detect_litho_lenses: project={project_id} model={model_id} "
        f"created={result.lenses_created} removed={result.lenses_removed} "
        f"skipped_unresolved_ordinal={result.lenses_skipped_unresolved_ordinal}"
    )
    return DetectLensesResponse(
        lenses_created=result.lenses_created,
        lenses_removed=result.lenses_removed,
        lenses_skipped_unresolved_ordinal=result.lenses_skipped_unresolved_ordinal,
    )


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
        detail="Geological model not found",
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
        detail="Geological model not found",
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
# Lens boundary shape (#163f Slice 2)
# ---------------------------------------------------------------------------


def _boundary_response(state) -> LensBoundaryResponse:  # noqa: ANN001 — internal mapper
    """Map a ``LensBoundaryState`` to the API response schema."""
    return LensBoundaryResponse(
        lens_id=state.lens_id,
        content_key=state.content_key,
        render_style=state.render_style,  # type: ignore[arg-type]
        primary_section_id=state.primary_section_id,
        upper_nodes=[
            LensBoundaryNodeItem(along_m=n.along_m, elevation_m=n.elevation_m)
            for n in state.upper_nodes
        ],
        lower_nodes=[
            LensBoundaryNodeItem(along_m=n.along_m, elevation_m=n.elevation_m)
            for n in state.lower_nodes
        ],
    )


@router.get(
    "/models/{model_id}/lenses/{lens_id}/boundary",
    response_model=LensBoundaryResponse,
)
async def get_lens_boundary(
    project_id: UUID,
    model_id: UUID,
    lens_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> LensBoundaryResponse:
    """Return the user-authored boundary shape for a lens body (#163f).

    Empty node lists + ``render_style='straight'`` when no custom shape is
    stored (or the lens has no stable content key yet).

    Parameters
    ----------
    project_id, model_id, lens_id : UUID
        Scope + target.
    session : AsyncSession
        DB session.

    Returns
    -------
    LensBoundaryResponse

    Raises
    ------
    HTTPException(404)
        When the lens is not found in the project + model scope.
    """
    try:
        state = await GetLensBoundary(session).execute(
            project_id=project_id, model_id=model_id, lens_id=lens_id
        )
    except LensNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "lens_not_found", "message": str(exc)},
        ) from exc
    return _boundary_response(state)


@router.put(
    "/models/{model_id}/lenses/{lens_id}/boundary",
    response_model=LensBoundaryResponse,
)
async def put_lens_boundary(
    project_id: UUID,
    model_id: UUID,
    lens_id: UUID,
    request: LensBoundaryWriteRequest,
    session: AsyncSession = Depends(get_session),
) -> LensBoundaryResponse:
    """Full-replace the boundary shape for a lens body (#163f).

    Sorts + re-indexes the node lists server-side. Persisted under the lens's
    stable ``content_key`` so the shape survives a resolver re-detection.

    Parameters
    ----------
    project_id, model_id, lens_id : UUID
        Scope + target.
    request : LensBoundaryWriteRequest
        upper/lower nodes + render style.
    session : AsyncSession
        DB session.

    Returns
    -------
    LensBoundaryResponse
        The saved state.

    Raises
    ------
    HTTPException(404)
        Lens not found in scope.
    HTTPException(422)
        Lens has no content key (re-run correlation) or no primary section.
    """
    try:
        state = await SaveLensBoundary(session).execute(
            project_id=project_id,
            model_id=model_id,
            lens_id=lens_id,
            upper_nodes=[BoundaryNode(n.along_m, n.elevation_m) for n in request.upper_nodes],
            lower_nodes=[BoundaryNode(n.along_m, n.elevation_m) for n in request.lower_nodes],
            render_style=request.render_style,
        )
    except LensNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "lens_not_found", "message": str(exc)},
        ) from exc
    except LensNotDetectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "lens_not_detected", "message": str(exc)},
        ) from exc
    except LensNoPrimarySectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_primary_section", "message": str(exc)},
        ) from exc
    return _boundary_response(state)


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
        detail="Geological model not found",
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
# List absence records for a formation
# ---------------------------------------------------------------------------


@router.get(
    "/formations/{formation_id}/absences",
    response_model=list[FormationAbsenceItem],
)
async def list_formation_absences(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[FormationAbsenceOrm]:
    """Return all absence records for a formation in this project.

    Used by the "Inspect lens body" panel to display which investigations
    are absent for this formation and their confidence source
    (``'inferred'`` / ``'manual'`` / ``'observed'``).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    formation_id : UUID
        The geological formation whose absences are requested.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[FormationAbsenceItem]
        All absence rows for this formation, ordered by investigation_kind
        then investigation_id for deterministic rendering.

    Raises
    ------
    HTTPException(404)
        When the formation does not belong to the project.
    """
    formation = await session.get(GeologicalFormationOrm, formation_id)
    if formation is None or formation.app_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "formation_not_found",
                "message": f"Formation {formation_id} not found.",
            },
        )
    stmt = (
        select(FormationAbsenceOrm)
        .where(FormationAbsenceOrm.formation_id == formation_id)
        .order_by(
            FormationAbsenceOrm.investigation_kind,
            FormationAbsenceOrm.investigation_id,
        )
    )
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    logger.debug(f"list_formation_absences: formation={formation_id} → {len(rows)} absence(s)")
    return rows


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
        detail="Geological model not found",
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


# ---------------------------------------------------------------------------
# Bulk recompute all absences for a model (batch-accept companion)
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/recompute-all-absences",
    status_code=status.HTTP_200_OK,
)
async def recompute_all_absences_for_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Re-run absence inference for every formation with contacts in the model.

    Designed as the one-shot finaliser for ``defer_inference=True`` bulk-accept
    flows.  When the frontend accepts N anchors with ``defer_inference=True`` it
    skips the per-accept R7 inference hook to avoid N × formations × sections
    inference passes.  After the full batch of accepts, ONE call here runs a
    single inference pass per formation — O(formations × sections) regardless
    of N.

    The model must be ``kind='lithostratigraphic'``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model to recompute.  Must belong to
        ``project_id`` and have ``kind='lithostratigraphic'``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    dict
        ``formations_processed``, ``total_written``, ``total_retracted``,
        ``total_wedge_tips_created``, ``total_wedge_tips_deleted`` counts.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model kind is not ``'lithostratigraphic'``.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    # Kind guard: must be lithostratigraphic (same pattern as the other lens
    # endpoints — callers that accidentally pass a geological model_id get a
    # clear 422 rather than a silent no-op or a misleading 404).
    model = await session.get(GeologicalModelOrm, model_id)
    if model is not None and model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "wrong_model_kind",
                "message": (
                    f"Model {model_id} has kind='{model.kind}'; "
                    f"recompute-all-absences requires kind='{MODEL_KIND_LITHOSTRATIGRAPHIC}'."
                ),
            },
        )

    try:
        result = await RecomputeAllAbsencesForModel(session).execute(
            project_id=project_id,
            model_id=model_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "recompute_all_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"recompute_all_absences_for_model: project={project_id} model={model_id} → "
        f"formations_processed={result.formations_processed} "
        f"written={result.total_written} retracted={result.total_retracted} "
        f"wedge_tips_created={result.total_wedge_tips_created}"
    )
    return {
        "formations_processed": result.formations_processed,
        "total_written": result.total_written,
        "total_retracted": result.total_retracted,
        "total_wedge_tips_created": result.total_wedge_tips_created,
        "total_wedge_tips_deleted": result.total_wedge_tips_deleted,
    }
