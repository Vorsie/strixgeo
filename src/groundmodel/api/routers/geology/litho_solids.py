"""Geology API — litho-3D solid cache endpoints.

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints
---------
GET  /models/{mid}/litho-solids
    List all cached ``LithoBodySolidOrm`` rows for the model.

POST /models/{mid}/litho-solids/build-voxel
    Trigger ``BuildVoxelLithoModel`` (on-click build) from the frontend's
    validated 2-D partitions and return the freshly built solid list
    alongside outcome counts.  (The retired implicit strat-field
    ``POST .../litho-solids/rebuild`` sibling was deleted with the
    strat_field builder — #237; git history has it.)

PATCH /models/{mid}/bodies/{body_id}/color
    Update ``BodyOrm.display_color`` for a body.  Additive endpoint —
    does not touch ``name``; the existing ``PATCH .../bodies/{body_id}``
    route requires a non-empty ``name`` which makes it unsuitable as a
    colour-only target without a breaking contract change.

These are the litho analogue of the geological TIN surfaces endpoints
(``GET .../surfaces`` / ``POST .../surfaces/rebuild``).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.body.update_body_color_request import (
    UpdateBodyColorRequest,
    UpdateBodyColorResponse,
)
from groundmodel.api.schemas.project.litho_body_solid_response import LithoBodySolidResponse
from groundmodel.api.schemas.project.rebuild_litho_solids_response import (
    RebuildLithoSolidsResponse,
)
from groundmodel.api.schemas.project.voxel_build_request import VoxelBuildRequest
from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel
from groundmodel.application.litho_solid_persistence import LithoSolidsOutcome
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import VoxelGridTooLargeError
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Private helper — join display_color from BodyOrm without lazy-loading
# ---------------------------------------------------------------------------


async def _body_attrs_by_body(
    session: AsyncSession, body_ids: list[UUID]
) -> dict[UUID, tuple[str | None, int]]:
    """Return each body's ``display_color`` and ``body_ordinal`` from ``BodyOrm``.

    A single bulk SELECT keyed on the body_ids seen in the solid rows —
    avoids lazy-loading ``BodyOrm`` from inside Pydantic serialisation
    (which would raise ``MissingGreenlet`` in an async context).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    body_ids : list[UUID]
        The body ids whose attributes are needed.

    Returns
    -------
    dict[UUID, tuple[str | None, int]]
        ``body_id → (display_color, body_ordinal)``.  Bodies absent from the
        result set (not found in the DB) will be missing from the dict; callers
        default to ``(None, 0)`` in that case.
    """
    if not body_ids:
        return {}
    rows = (
        await session.execute(
            select(BodyOrm.id, BodyOrm.display_color, BodyOrm.body_ordinal).where(
                BodyOrm.id.in_(body_ids)
            )
        )
    ).all()
    return {row.id: (row.display_color, row.body_ordinal) for row in rows}


def _to_solid_response(
    solid: LithoBodySolidOrm,
    display_color: str | None,
    body_ordinal: int,
) -> LithoBodySolidResponse:
    """Build a :class:`LithoBodySolidResponse` from an ORM row + body attributes.

    Merges ``display_color`` and ``body_ordinal`` (both from ``BodyOrm``) into
    the response at construction time so Pydantic never touches a lazy
    attribute on the ``solid`` row.

    Parameters
    ----------
    solid : LithoBodySolidOrm
        The cached solid ORM row.
    display_color : str | None
        Colour override fetched from ``BodyOrm``; ``None`` falls back to the
        formation colour in the 3-D viewer.
    body_ordinal : int
        The body's ordinal within its formation's naming group, fetched from
        ``BodyOrm``; combined with the lithology gives a stable human handle
        such as "SILT #3".

    Returns
    -------
    LithoBodySolidResponse
        Fully populated response object.
    """
    return LithoBodySolidResponse(
        id=solid.id,
        model_id=solid.model_id,
        body_id=solid.body_id,
        formation_id=solid.formation_id,
        body_ordinal=body_ordinal,
        method=solid.method,
        vertices=solid.vertices,
        triangles=solid.triangles,
        is_stale=solid.is_stale,
        is_flagged=solid.is_flagged,
        display_color=display_color,
        created_at=solid.created_at,
        updated_at=solid.updated_at,
    )


# ---------------------------------------------------------------------------
# GET /models/{model_id}/litho-solids
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/litho-solids",
    response_model=list[LithoBodySolidResponse],
)
async def list_litho_solids(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[LithoBodySolidResponse]:
    """Return every cached 3-D solid in this lithostratigraphic model.

    The 3-D viewer fetches this once on load, indexes by ``body_id``,
    and renders each solid.  ``is_stale=True`` rows are rendered at
    lower opacity until the user clicks "Build 3-D model".

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model — must belong to ``project_id``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[LithoBodySolidResponse]
        All cached solid rows for this model (may be empty when no
        build has run yet).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(f"GET /projects/{project_id}/geology/models/{model_id}/litho-solids")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    repo = LithoLayerRepository(session)
    solids = await repo.list_litho_solids(model_id)

    # Bulk-load display_color + body_ordinal from BodyOrm to avoid lazy-load
    # during Pydantic serialisation (MissingGreenlet in async context).
    body_ids = [s.body_id for s in solids]
    body_attrs = await _body_attrs_by_body(session, body_ids)

    result = [_to_solid_response(s, *body_attrs.get(s.body_id, (None, 0))) for s in solids]
    logger.info(
        f"list_litho_solids: project={project_id} model={model_id} → {len(result)} solid(s)"
    )
    return result


async def _build_rebuild_response(
    session: AsyncSession,
    project_id: UUID,
    model_id: UUID,
    outcome: LithoSolidsOutcome,
    *,
    log_label: str,
) -> RebuildLithoSolidsResponse:
    """Load the rebuilt solid list + assemble the bundled rebuild response.

    Tail of the ``build-voxel`` endpoint: after the build use case commits,
    load the freshly persisted solid rows (joining ``display_color`` /
    ``body_ordinal`` from ``BodyOrm``) and bundle them with the outcome
    counts so the frontend updates its cache in one round-trip.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope (for the log line only — the caller already guarded it).
    model_id : UUID
        The lithostratigraphic model whose solids were rebuilt.
    outcome : LithoSolidsOutcome
        The build outcome (both the strat and voxel use cases return this).
    log_label : str
        Short label distinguishing the two endpoints in the log line.

    Returns
    -------
    RebuildLithoSolidsResponse
        Outcome counts + the freshly rebuilt solid list.
    """
    repo = LithoLayerRepository(session)
    solids = await repo.list_litho_solids(model_id)
    body_ids = [s.body_id for s in solids]
    body_attrs = await _body_attrs_by_body(session, body_ids)
    solid_responses = [_to_solid_response(s, *body_attrs.get(s.body_id, (None, 0))) for s in solids]

    logger.info(
        f"{log_label}_litho_solids: project={project_id} model={model_id} "
        f"considered={outcome.bodies_considered} built={outcome.bodies_built} "
        f"skipped={outcome.bodies_skipped_checksum} flagged={outcome.bodies_flagged} "
        f"orphans_deleted={outcome.orphans_deleted} "
        f"solids_returned={len(solid_responses)} "
        f"marked_tests={len(outcome.marked_test_ids)} "
        f"uncovered_tests={len(outcome.uncovered_test_ids)}"
    )
    return RebuildLithoSolidsResponse(
        bodies_considered=outcome.bodies_considered,
        bodies_built=outcome.bodies_built,
        bodies_skipped_checksum=outcome.bodies_skipped_checksum,
        bodies_flagged=outcome.bodies_flagged,
        orphans_deleted=outcome.orphans_deleted,
        solids=solid_responses,
        marked_test_ids=outcome.marked_test_ids,
        # Investigations outside the model footprint. Carried out so the client
        # can downgrade the toast: the build succeeded, but not for these.
        uncovered_test_ids=outcome.uncovered_test_ids,
        # Why an empty build is empty. An empty build also CLEARED the stored
        # 3-D model, so the client must not read zero bodies as a plain success.
        empty_reason=outcome.empty_reason,
    )


# ---------------------------------------------------------------------------
# POST /models/{model_id}/litho-solids/build-voxel
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/litho-solids/build-voxel",
    response_model=RebuildLithoSolidsResponse,
)
async def build_voxel_litho_solids(
    project_id: UUID,
    model_id: UUID,
    request: VoxelBuildRequest,
    force: bool = Query(
        default=True,
        description=(
            "When true (the on-click Build default) always rebuild; when false "
            "the model-level partition checksum short-circuits an unchanged payload."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> RebuildLithoSolidsResponse:
    """Build the 3-D litho-solid cache from the validated 2-D voxel partitions.

    The PRIMARY way the user materialises the lithostratigraphic model into a
    3-D solid mesh.  Takes the frontend's validated ``computeSectionFill``
    partitions (the source of truth) and labels a 3-D voxel grid from them,
    then extracts each body's watertight greedy-meshed boundary — watertight
    AND faithful by construction (a labelling of space is a partition, so
    interfingering / pinch-out is representable).

    The Pydantic request is converted to the frozen domain value objects before
    the use case runs (the clean-architecture boundary).  ``force`` defaults to
    ``True`` (the on-click Build), so an explicit Build always re-meshes; pass
    ``force=false`` to let the partition-payload checksum skip an unchanged build.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model — must belong to ``project_id``.
    request : VoxelBuildRequest
        The per-section 2-D partitions + grid spacing (the build payload).
    force : bool, default ``True``
        Skip the checksum short-circuit when ``True``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    RebuildLithoSolidsResponse
        Outcome counts + the freshly built solid list (equivalent to calling
        ``GET .../litho-solids`` immediately after, bundled to save a
        round-trip).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the requested spacing resolves to more voxels than one build may
        allocate.  The detail is ``{"code": "voxel_grid_too_large", "message":
        ..., "suggested_horizontal_m": <float>}`` — the retry spacing stays a
        number so the client can offer the retry instead of parsing it out of
        prose or making the engineer guess.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/litho-solids/build-voxel "
        f"sections={len(request.sections)} "
        f"horizontal_spacing={request.effective_horizontal_spacing_m} "
        f"vertical_spacing={request.effective_vertical_spacing_m} force={force}"
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    # Convert the Pydantic request → frozen domain value objects (the domain
    # layer takes value objects, not Pydantic — clean-architecture boundary).
    # The effective spacings resolve the optional anisotropic fields against the
    # cubic ``grid_spacing_m`` fallback: the horizontal spacing is passed as the
    # use case's ``grid_spacing_m`` (the X/Y edge length), and the vertical
    # spacing is passed only when it differs from the horizontal so a cubic
    # payload keeps the byte-stable cubic checksum (``None`` → cubic).
    domain_sections = request.to_domain_sections()
    horizontal_m = request.effective_horizontal_spacing_m
    vertical_m = request.effective_vertical_spacing_m
    try:
        outcome = await BuildVoxelLithoModel(session).execute(
            model_id,
            domain_sections,
            grid_spacing_m=horizontal_m,
            vertical_spacing_m=(None if vertical_m == horizontal_m else vertical_m),
            force=force,
        )
    except VoxelGridTooLargeError as err:
        # A spacing the engineer can simply retype — 422, never a 500 and never
        # the destructive "unbuildable model" path (which clears the stored 3-D
        # solids).  The stored model is untouched: nothing was written yet.
        logger.warning(
            f"build_voxel refused: project={project_id} model={model_id} — {err} "
            f"(suggested horizontal spacing {err.suggested_horizontal_m} m)"
        )
        # Structured, because the exception deliberately carries the retry
        # spacing as a NUMBER: prose would force the renderer to parse it back
        # out of a sentence to offer "retry at 3.0 m".
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "voxel_grid_too_large",
                "message": str(err),
                "suggested_horizontal_m": err.suggested_horizontal_m,
            },
        ) from err

    return await _build_rebuild_response(
        session, project_id, model_id, outcome, log_label="build_voxel"
    )


# ---------------------------------------------------------------------------
# PATCH /models/{model_id}/bodies/{body_id}/color
# ---------------------------------------------------------------------------


@router.patch(
    "/models/{model_id}/bodies/{body_id}/color",
    response_model=UpdateBodyColorResponse,
)
async def update_body_color(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    request: UpdateBodyColorRequest,
    session: AsyncSession = Depends(get_session),
) -> UpdateBodyColorResponse:
    """Update the per-body display colour override for the 3-D viewer.

    Additive endpoint — does not touch the body ``name``.  The existing
    ``PATCH .../bodies/{body_id}`` route requires a non-empty ``name``
    field, making it unsuitable as a colour-only target without a
    breaking contract change.

    ``display_color=null`` clears the override; the 3-D viewer then
    falls back to the formation (lithology) colour.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        Primary key of the ``BodyOrm`` row to update.
    request : UpdateBodyColorRequest
        ``display_color`` (hex string or ``None``).
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    UpdateBodyColorResponse
        The body id and persisted colour value.

    Raises
    ------
    HTTPException(404)
        When the body does not exist or belongs to a different
        project / model.
    """
    logger.info(
        f"PATCH /projects/{project_id}/geology/models/{model_id}"
        f"/bodies/{body_id}/color display_color={request.display_color!r}"
    )
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    body.display_color = request.display_color
    await session.flush()
    await session.commit()

    logger.info(f"update_body_color: body={body_id} display_color={request.display_color!r}")
    return UpdateBodyColorResponse(body_id=body_id, display_color=body.display_color)
