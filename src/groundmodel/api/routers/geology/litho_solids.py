"""Geology API — litho-3D solid cache endpoints.

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints
---------
GET  /models/{mid}/litho-solids
    List all cached ``LithoBodySolidOrm`` rows for the model.

POST /models/{mid}/litho-solids/rebuild
    Trigger ``RecomputeLithoSolids`` (on-click build) and return the
    freshly rebuilt solid list alongside outcome counts.

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

from fastapi import APIRouter, Depends, HTTPException, status
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
from groundmodel.application.recompute_litho_solids import RecomputeLithoSolids
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Private helper — join display_color from BodyOrm without lazy-loading
# ---------------------------------------------------------------------------


async def _display_colors_by_body(
    session: AsyncSession, body_ids: list[UUID]
) -> dict[UUID, str | None]:
    """Return each body's ``display_color`` override from ``BodyOrm``.

    A second bulk SELECT keyed on the body_ids seen in the solid rows —
    avoids lazy-loading ``BodyOrm`` from inside Pydantic serialisation
    (which would raise ``MissingGreenlet`` in an async context).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    body_ids : list[UUID]
        The body ids whose colour overrides are needed.

    Returns
    -------
    dict[UUID, str | None]
        ``body_id → display_color``.  Bodies absent from the map (or
        not found in the DB) resolve to ``None``.
    """
    if not body_ids:
        return {}
    rows = (
        await session.execute(
            select(BodyOrm.id, BodyOrm.display_color).where(BodyOrm.id.in_(body_ids))
        )
    ).all()
    return {row.id: row.display_color for row in rows}


def _to_solid_response(
    solid: LithoBodySolidOrm, display_color: str | None
) -> LithoBodySolidResponse:
    """Build a :class:`LithoBodySolidResponse` from an ORM row + colour override.

    Merges the ``display_color`` (which lives on ``BodyOrm``) into the
    response at construction time so Pydantic never touches a lazy
    attribute on the ``solid`` row.

    Parameters
    ----------
    solid : LithoBodySolidOrm
        The cached solid ORM row.
    display_color : str | None
        Colour override fetched from ``BodyOrm``; ``None`` falls back to the
        formation colour in the 3-D viewer.

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
        All cached solid rows for this model (may be empty when
        ``RecomputeLithoSolids`` has not run yet).

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

    # Bulk-load display_color from BodyOrm to avoid lazy-load during
    # Pydantic serialisation (MissingGreenlet in async context).
    body_ids = [s.body_id for s in solids]
    colors = await _display_colors_by_body(session, body_ids)

    result = [_to_solid_response(s, colors.get(s.body_id)) for s in solids]
    logger.info(
        f"list_litho_solids: project={project_id} model={model_id} → {len(result)} solid(s)"
    )
    return result


# ---------------------------------------------------------------------------
# POST /models/{model_id}/litho-solids/rebuild
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/litho-solids/rebuild",
    response_model=RebuildLithoSolidsResponse,
)
async def rebuild_litho_solids(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> RebuildLithoSolidsResponse:
    """Recompute the 3-D solid cache for every body in this lithostratigraphic model.

    The PRIMARY way the user materialises the lithostratigraphic model
    into a 3-D solid mesh.  Per-contact mutations flip ``is_stale=True``
    (cheap DB flag, no triangulation); only this endpoint re-triangulates.
    Calling on a clean model is idempotent (``bodies_built=0``).

    Runs ``RecomputeLithoSolids`` with ``force=True`` so an explicit Build
    always re-triangulates even when the pick-set checksum has not changed
    (a TIN-algorithm update would otherwise be invisible to the user).

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
    RebuildLithoSolidsResponse
        Outcome counts + the freshly rebuilt solid list (equivalent to
        calling ``GET .../litho-solids`` immediately after, bundled here
        to save a round-trip).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(f"POST /projects/{project_id}/geology/models/{model_id}/litho-solids/rebuild")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    outcome = await RecomputeLithoSolids(session).execute(model_id, force=True)

    # Load the rebuilt solid list for the bundled response.
    repo = LithoLayerRepository(session)
    solids = await repo.list_litho_solids(model_id)
    body_ids = [s.body_id for s in solids]
    colors = await _display_colors_by_body(session, body_ids)
    solid_responses = [_to_solid_response(s, colors.get(s.body_id)) for s in solids]

    logger.info(
        f"rebuild_litho_solids: project={project_id} model={model_id} "
        f"considered={outcome.bodies_considered} built={outcome.bodies_built} "
        f"skipped={outcome.bodies_skipped_checksum} flagged={outcome.bodies_flagged} "
        f"orphans_deleted={outcome.orphans_deleted} "
        f"solids_returned={len(solid_responses)}"
    )
    return RebuildLithoSolidsResponse(
        bodies_considered=outcome.bodies_considered,
        bodies_built=outcome.bodies_built,
        bodies_skipped_checksum=outcome.bodies_skipped_checksum,
        bodies_flagged=outcome.bodies_flagged,
        orphans_deleted=outcome.orphans_deleted,
        solids=solid_responses,
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
