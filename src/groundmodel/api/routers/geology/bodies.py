"""Geology API — body endpoints (replaces lenses router).

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints
---------
GET  /models/{mid}/bodies
    List all ``BodyOrm`` rows for the model.

PATCH /models/{mid}/bodies/{bid}
    Update name — calls ``NameBody`` identified by body_id.

DELETE /models/{mid}/bodies/{bid}
    Hard-delete a body row (``DeleteBody``).

GET  /models/{mid}/bodies/{bid}/boundary
    Fetch boundary shape + control nodes (``GetBodyBoundary``).

PUT  /models/{mid}/bodies/{bid}/boundary
    Full-replace boundary shape + nodes (``SaveBodyBoundary``).

POST /models/{mid}/bodies/{bid}/perpendicular-companion
    Auto-create a perpendicular companion section.

POST /models/{mid}/bodies/merge-enclosed-lenses
    Merge host halves of an enclosed lens into one body.

Plus the absence endpoints (kept from lenses.py; body-scoped but mounted
under the shared geology prefix for historical reasons):

GET  /formations/{formation_id}/absences
POST /formations/{formation_id}/absences
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    get_in_project_or_404,
    require_model_kind,
)
from groundmodel.api.schemas.project.body import (
    BodyBoundaryNodeItem,
    BodyBoundaryResponse,
    BodyBoundaryWriteRequest,
    BodyGeoFormationRef,
    BodyListItem,
    ClearBoundariesResponse,
    MergeEnclosedLensResponse,
    NameBodyRequest,
    NameBodyResponse,
)
from groundmodel.api.schemas.project.body.body_boundary import BodyRenderStyle
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.formation_absence import (
    FormationAbsenceItem,
    UpsertFormationAbsenceRequest,
    UpsertFormationAbsenceResponse,
)
from groundmodel.api.schemas.project.recompute_bodies import (
    RecomputeBodiesRequest,
    RecomputeBodiesResponse,
)
from groundmodel.application.body_boundary import (
    BodyBoundaryState,
    BodyNoPrimarySectionError,
    BodyNotFoundError,
    BoundaryNode,
    GetBodyBoundary,
    SaveBodyBoundary,
)
from groundmodel.application.clear_body_boundaries import ClearBodyBoundaries
from groundmodel.application.create_perpendicular_companion import CreatePerpendicularCompanion
from groundmodel.application.delete_body import DeleteBody
from groundmodel.application.get_body_geo_labels import BodyGeoLabel, GetBodyGeoLabels
from groundmodel.application.merge_enclosed_lens_bodies import MergeEnclosedLensBodies
from groundmodel.application.name_body import NameBody
from groundmodel.application.recompute_bodies import RecomputeBodies
from groundmodel.application.upsert_formation_absence import UpsertFormationAbsence
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import (
    MODEL_KIND_LITHOSTRATIGRAPHIC,
    NON_STRATIGRAPHIC_KINDS,
)
from groundmodel.shared.exceptions import (
    EmptyRecomputePayloadError,
    IncompleteRecomputeCoverageError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


def _to_list_item(body: BodyOrm, label: BodyGeoLabel) -> BodyListItem:
    """Build a ``BodyListItem`` from a body row + its derived geo label.

    ``parent_litho_body_id`` (debt #278, R1) is a real ORM column, so
    ``from_attributes`` fills it straight off ``body`` here — only the DERIVED
    geo label (the majority singular pair AND the R2 crossed-formation list) is
    set by hand.
    """
    item = BodyListItem.model_validate(body)
    item.geo_formation_id = label.formation_id
    item.geo_formation_name = label.formation_name
    item.geo_formations = [BodyGeoFormationRef(id=fid, name=name) for fid, name in label.formations]
    return item


# ---------------------------------------------------------------------------
# List all bodies for a model
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/bodies",
    response_model=list[BodyListItem],
)
async def list_bodies(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[BodyListItem]:
    """List all body metadata rows for a lithostratigraphic model.

    Returns a lightweight list item for every ``BodyOrm`` row that belongs
    to this project + model pair, ordered by creation timestamp (oldest
    first).

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
    list[BodyListItem]
        All bodies in this model, oldest-first.

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
        select(BodyOrm)
        .where(
            BodyOrm.app_project_id == project_id,
            BodyOrm.model_id == model_id,
        )
        .order_by(BodyOrm.created_at)
    )
    result = await session.execute(stmt)
    bodies = list(result.scalars().all())
    labels = await GetBodyGeoLabels(session).execute(
        litho_model_id=model_id, body_ids=[b.id for b in bodies]
    )
    logger.debug(f"list_bodies: project={project_id} model={model_id} → {len(bodies)} body row(s)")
    return [_to_list_item(b, labels.get(b.id, BodyGeoLabel(None, None))) for b in bodies]


@router.post(
    "/models/{model_id}/bodies/merge-enclosed-lenses",
    response_model=MergeEnclosedLensResponse,
)
async def merge_enclosed_lenses(
    project_id: UUID,
    model_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> MergeEnclosedLensResponse:
    """Merge a lithology split only by a local lens into one body (Fill bands).

    For a DIFFERENT-lithology enclosed lens absent on a neighbour (a true pinch),
    correlates the bracketing host halves to that neighbour's continuous host and
    re-resolves, so they become one body while the lens keeps its own body. A
    SAME-lithology enclosed lens (owner ruling 2026-07-13) merges INTO its matrix
    body instead. Idempotent — re-running adds only new edges.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    section_id : UUID
        The active cross-section — defines column adjacency (section-scoped).
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    MergeEnclosedLensResponse
        Counts of created + skipped correlation edges.

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
    require_model_kind(model, MODEL_KIND_LITHOSTRATIGRAPHIC, "merge-enclosed-lenses")
    result = await MergeEnclosedLensBodies(session).execute(
        project_id=project_id,
        model_id=model_id,
        section_id=section_id,
    )
    logger.success(
        f"merge_enclosed_lenses: project={project_id} model={model_id} "
        f"created={result.edges_created} skipped={result.edges_skipped_existing}"
    )
    return MergeEnclosedLensResponse(
        edges_created=result.edges_created,
        edges_skipped_existing=result.edges_skipped_existing,
    )


# ---------------------------------------------------------------------------
# Recompute geometric body identity (POST)
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/bodies/recompute",
    response_model=RecomputeBodiesResponse,
)
async def recompute_bodies(
    project_id: UUID,
    model_id: UUID,
    request: RecomputeBodiesRequest,
    session: AsyncSession = Depends(get_session),
) -> RecomputeBodiesResponse:
    """Persist the geometric body merge and re-stamp ``litho_layer.body_id``.

    Owner ruling 2026-08-12: every set of same-lithology units whose fill
    regions connect shares one body id. The frontend posts what it renders
    (fallback regions omitted) plus its merge groups and layer snapshot; the
    server unions that with the cross-section alias rule, replaces the model's
    geometry facts, and re-runs the resolver.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        A lithostratigraphic OR geotechnical model in this project — both
        carry bodies (packing bodies drive qc-per-body extraction).
    request : RecomputeBodiesRequest
        Sections (regions carrying layer ids) + per-section layer groups.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    RecomputeBodiesResponse
        The diff for the frontend's toast.

    Raises
    ------
    HTTPException(404)
        Model not found in the project.
    HTTPException(422)
        Model kind carries no bodies, or the payload is empty (an empty
        payload would wipe every geometric merge — refused, never applied).
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    if model.kind not in NON_STRATIGRAPHIC_KINDS:
        # Mirrors require_model_kind's shape; that helper takes ONE kind and
        # this verb legitimately serves two.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": (
                    f"bodies/recompute needs a lithostratigraphic or geotechnical "
                    f"model; {model_id} is '{model.kind}'"
                ),
            },
        )
    try:
        result = await RecomputeBodies(session).execute(
            model_id=model_id,
            sections=request.to_domain_sections(),
            section_layer_groups=request.layer_groups or [[] for _ in request.sections],
            section_ids=request.section_ids,
        )
    except EmptyRecomputePayloadError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "empty_recompute_payload", "message": str(exc)},
        ) from exc
    except IncompleteRecomputeCoverageError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "incomplete_recompute_coverage", "message": str(exc)},
        ) from exc
    logger.success(
        f"recompute_bodies: project={project_id} model={model_id} "
        f"facts={result.facts_written} merged={result.bodies_merged} "
        f"split={result.bodies_split} solids_stale={result.solids_stale}"
    )
    return RecomputeBodiesResponse(
        facts_written=result.facts_written,
        facts_dropped_stale=result.facts_dropped_stale,
        bodies_merged=result.bodies_merged,
        bodies_split=result.bodies_split,
        renamed=list(result.renamed),
        solids_stale=result.solids_stale,
    )


# ---------------------------------------------------------------------------
# Update body name (PATCH)
# ---------------------------------------------------------------------------


@router.patch(
    "/models/{model_id}/bodies/{body_id}",
    response_model=NameBodyResponse,
)
async def update_body(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    request: NameBodyRequest,
    session: AsyncSession = Depends(get_session),
) -> NameBodyResponse:
    """Update a body's human-readable name.

    Fetches the existing ``BodyOrm`` row to derive ``formation_id`` and
    ``body_ordinal``, then delegates to ``NameBody`` (which creates or
    updates the row idempotently).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        Primary key of the body to rename.
    request : NameBodyRequest
        name (required), optional primary_section_id.  The
        ``formation_id`` and ``body_ordinal`` fields from the schema
        are ignored here — they are derived from the existing body row.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    NameBodyResponse
        The body_id and a ``was_created`` flag (always False for this
        endpoint — the body must already exist to be addressed by id).

    Raises
    ------
    HTTPException(404)
        When the body does not exist or belongs to a different
        project / model.
    HTTPException(422)
        On NameBody validation failure (formation not found, etc.).
    """
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    try:
        result = await NameBody(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=body.formation_id,
            body_ordinal=body.body_ordinal,
            name=request.name,
            primary_section_id=request.primary_section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "name_body_error", "message": str(exc)},
        ) from exc

    return NameBodyResponse(body_id=result.body_id, was_created=result.was_created)


# ---------------------------------------------------------------------------
# Delete body
# ---------------------------------------------------------------------------


@router.delete(
    "/models/{model_id}/bodies/{body_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_body_endpoint(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Hard-delete the ``BodyOrm`` metadata row for a body.

    Absence rows and synthetic contacts scoped to the formation are
    intentionally preserved — they belong to the body's formation, not to
    the label row.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The ``BodyOrm`` row to delete.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    None
        204 No Content on success.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project, or when the body
        row does not exist or belongs to a different project/model.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    # Scope-check the body row before delegating (DeleteBody performs its
    # own scope guard but returns False instead of raising; we want a 404).
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    await DeleteBody(session).execute(
        project_id=project_id,
        model_id=model_id,
        body_id=body_id,
    )


# ---------------------------------------------------------------------------
# Boundary shape — GET + PUT
# ---------------------------------------------------------------------------


def _boundary_response(state: BodyBoundaryState) -> BodyBoundaryResponse:
    """Map a ``BodyBoundaryState`` (domain) to the API response schema."""
    return BodyBoundaryResponse(
        body_id=state.body_id,
        # The domain carries ``str``; SaveBodyBoundary refuses any style outside
        # the three, and pydantic re-validates the Literal at runtime.
        render_style=cast(BodyRenderStyle, state.render_style),
        primary_section_id=state.primary_section_id,
        upper_nodes=[
            BodyBoundaryNodeItem(along_m=n.along_m, elevation_m=n.elevation_m)
            for n in state.upper_nodes
        ],
        lower_nodes=[
            BodyBoundaryNodeItem(along_m=n.along_m, elevation_m=n.elevation_m)
            for n in state.lower_nodes
        ],
    )


@router.get(
    "/models/{model_id}/bodies/{body_id}/boundary",
    response_model=BodyBoundaryResponse,
)
async def get_body_boundary(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> BodyBoundaryResponse:
    """Return the user-authored boundary shape for a body.

    Empty node lists + ``render_style='straight'`` when no custom shape
    is stored yet.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The body whose boundary is requested.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BodyBoundaryResponse

    Raises
    ------
    HTTPException(404)
        When the body is not found in the project + model scope.
    """
    try:
        state = await GetBodyBoundary(session).execute(
            project_id=project_id, model_id=model_id, body_id=body_id
        )
    except BodyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": str(exc)},
        ) from exc
    return _boundary_response(state)


@router.put(
    "/models/{model_id}/bodies/{body_id}/boundary",
    response_model=BodyBoundaryResponse,
)
async def put_body_boundary(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    request: BodyBoundaryWriteRequest,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> BodyBoundaryResponse:
    """Full-replace the boundary shape + nodes for a body.

    Sorts and re-indexes the node lists server-side.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The body whose boundary is being updated.
    request : BodyBoundaryWriteRequest
        upper/lower nodes + render style.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BodyBoundaryResponse
        The saved state.

    Raises
    ------
    HTTPException(404)
        Body not found in scope.
    HTTPException(422)
        Body has no primary section.
    """
    try:
        state = await SaveBodyBoundary(session).execute(
            project_id=project_id,
            model_id=model_id,
            body_id=body_id,
            upper_nodes=[BoundaryNode(n.along_m, n.elevation_m) for n in request.upper_nodes],
            lower_nodes=[BoundaryNode(n.along_m, n.elevation_m) for n in request.lower_nodes],
            render_style=request.render_style,
            prefer_section_id=section_id,
        )
    except BodyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": str(exc)},
        ) from exc
    except BodyNoPrimarySectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_primary_section", "message": str(exc)},
        ) from exc
    return _boundary_response(state)


# ---------------------------------------------------------------------------
# Bulk clear — reset all user-authored boundary shapes for a model
# ---------------------------------------------------------------------------


@router.delete(
    "/models/{model_id}/boundaries",
    response_model=ClearBoundariesResponse,
)
async def clear_body_boundaries(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ClearBoundariesResponse:
    """Reset every user-authored body boundary shape for a model.

    The "Reset manual points" bulk action. Deletes all
    ``body_boundary_shape`` rows (+ their cascade-deleted control nodes) for
    the model, so every body returns to its engine-computed partition shape.
    Left-over hand-drawn overrides can bend boundaries off the engine default
    and produce visible gap wedges; clearing them restores the validated fill.

    Idempotent — a model with no stored shapes returns ``shapes_deleted=0``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model whose hand-drawn boundaries are cleared.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    ClearBoundariesResponse
        The number of boundary shapes deleted.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not lithostratigraphic.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    require_model_kind(model, MODEL_KIND_LITHOSTRATIGRAPHIC, "clear-boundaries")
    result = await ClearBodyBoundaries(session).execute(model_id=model_id)
    logger.success(
        f"clear_body_boundaries: project={project_id} model={model_id} "
        f"shapes_deleted={result.shapes_deleted}"
    )
    return ClearBoundariesResponse(shapes_deleted=result.shapes_deleted)


# ---------------------------------------------------------------------------
# Perpendicular companion section
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/bodies/{body_id}/perpendicular-companion",
    response_model=CrossSectionResponse,
)
async def create_perpendicular_companion(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Auto-create a perpendicular companion cross-section for a body.

    Creates a new cross-section perpendicular to the body's primary section,
    centred on the body's formation-contact centroid.  Idempotent — returns
    the existing companion section (HTTP 200) when one already exists; a
    freshly created companion returns HTTP 201.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The ``BodyOrm`` row that defines the body.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    CrossSectionResponse
        The companion section (newly created or pre-existing).

    Raises
    ------
    HTTPException(404)
        When the model or body is not found in the project scope.
    HTTPException(422)
        When ``primary_section_id`` is null on the body, or when the
        primary section has been deleted.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    # Load and scope-check the body row.
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    try:
        result = await CreatePerpendicularCompanion(session).execute(
            project_id=project_id,
            model_id=model_id,
            body_id=body_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "companion_error", "message": str(exc)},
        ) from exc

    response = CrossSectionResponse.model_validate(result.companion_section)
    response.companion_body_name = body.name

    http_status = status.HTTP_200_OK if result.already_existed else status.HTTP_201_CREATED
    return JSONResponse(
        status_code=http_status,
        content=response.model_dump(mode="json"),
    )


# ---------------------------------------------------------------------------
# Formation absence — list
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

    Used by the "Inspect body" panel to display which investigations are
    absent for this formation and their confidence source
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
# Formation absence — upsert
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

    Supports two gestures from the "Inspect body" panel:

    * **Confirm absence** — promotes an existing ``source='inferred'``
      row to ``source='manual'``.  The inference engine will not
      overwrite it on the next recompute.
    * **Manual absence** — adds a ``source='manual'`` or
      ``source='observed'`` row for an investigation the engine did not
      infer.

    ``source='inferred'`` is rejected — that source belongs to the
    inference engine.

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
        When ``source`` is not allowed, the formation is not found, or
        the investigation is not found.
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


# The standalone POST /models/{mid}/recompute-all-absences endpoint was
# deleted 2026-07-13 (audit BE-API-07): the batch-accept endpoint's
# ``run_inference=True`` runs RecomputeAllAbsencesForModel server-side, so
# the FE's defer-then-finalise dance (and this finaliser) had no callers.
