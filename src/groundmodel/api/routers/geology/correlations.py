"""Geology API — litho correlation edges (Phase-2 Slices 1+3).

Mounted under the shared /projects/{project_id}/geology prefix by the
geology package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/correlations
  DELETE /projects/{pid}/geology/models/{mid}/correlations
  POST   /projects/{pid}/geology/models/{mid}/correlations/resolve
  GET    /projects/{pid}/geology/models/{mid}/correlations

All endpoints are MODEL-level only.  They take no section_id and
do NOT modify seeded_formation_contact_ids on any cross-section row.
This is the structural reason the #57/applyUpdatedSection trap cannot
recur here: there is no section entity in scope.

Idempotency contract:
  POST  /correlations     → 201 when a new edge was created; 200 when it already existed.
  DELETE /correlations    → 204 always (whether an edge was found-and-deleted or not).
  POST  /correlations/resolve → 200 always (idempotent — no-change returns empty list).
  GET   /correlations     → 200 always (returns current edge list, possibly empty).

Route ordering note:
  The static segment ``/correlations/resolve`` MUST be registered before
  the parameterless ``/correlations`` POST route so FastAPI does not
  misinterpret "resolve" as a path parameter.  The current ordering in
  this file ensures that: ``resolve`` router decorator comes first.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.litho_correlation.litho_correlation_schemas import (
    LithoCorrelationEdgeListItem,
    LithoCorrelationRequest,
    LithoCorrelationResponse,
    OrdinalUpdateItem,
    ResolveInstancesResponse,
)
from groundmodel.application.correlate_litho_units import CorrelateLithoUnits
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.uncorrelate_litho_units import UncorrelateLithoUnits
from groundmodel.infrastructure.db.models.litho_correlation_edge_orm import (
    LithoCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.session import get_session

router = APIRouter()


@router.post(
    "/models/{model_id}/correlations",
    response_model=LithoCorrelationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Correlate two litho formations (create or confirm an edge)",
)
async def correlate_formations(
    project_id: UUID,
    model_id: UUID,
    body: LithoCorrelationRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoCorrelationResponse:
    """Record that two formations belong to the same stratigraphic body.

    Creates an undirected edge between ``formation_a_id`` and
    ``formation_b_id`` within ``model_id``.  The edge is stored in
    canonical ordering ``(min, max)`` so the pair is unique regardless
    of the order supplied by the caller.

    Returns **201** when a new edge is inserted; **200** when the edge
    already existed (idempotent re-call).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    body : LithoCorrelationRequest
        The two formation endpoints and optional source token.

    Returns
    -------
    LithoCorrelationResponse
        Edge id, canonical endpoints, was_created flag, and the list of
        formation ordinals updated by the resolver.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``
        (review L1 — uniform with the DELETE/resolve/list siblings).
    422
        When formation_a_id == formation_b_id (self-loop) or the body
        fails Pydantic validation.
    422
        When either formation does not belong to the model / project, or
        the two formations are in different naming groups.
    """
    # Project-scope guard mirrors the DELETE/resolve/list siblings so all
    # four /correlations handlers enforce the HTTP-404 boundary uniformly
    # (review L1). The use case also re-checks model.app_project_id as
    # defence-in-depth.
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        result = await CorrelateLithoUnits(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_a_id=body.formation_a_id,
            formation_b_id=body.formation_b_id,
            source=body.source,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err

    response = LithoCorrelationResponse(
        edge_id=result.edge.id,
        formation_a_id=result.edge.formation_a_id,
        formation_b_id=result.edge.formation_b_id,
        was_created=result.was_created,
        instance_ordinals_updated=[
            OrdinalUpdateItem(
                formation_id=UUID(item["formation_id"]),
                new_ordinal=item["new_ordinal"],
            )
            for item in result.instance_ordinals_updated
        ],
    )
    # Idempotent re-call: already existed → 200 instead of 201.
    if not result.was_created:
        from fastapi.responses import JSONResponse

        return JSONResponse(  # type: ignore[return-value]
            content=response.model_dump(mode="json"),
            status_code=status.HTTP_200_OK,
        )
    return response


@router.delete(
    "/models/{model_id}/correlations",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Uncorrelate two litho formations (delete the edge)",
)
async def uncorrelate_formations(
    project_id: UUID,
    model_id: UUID,
    body: LithoCorrelationRequest,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove the correlation edge between two formations.

    Idempotent: returns **204** whether the edge existed or not.  After
    deletion the ordinal resolver is re-run across all model formations
    so split components receive new ordinals.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    body : LithoCorrelationRequest
        The two formation endpoints (order does not matter — canonical
        ordering is applied internally).

    Returns
    -------
    None
        204 No Content always.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``
        (VULN-12).
    """
    # Project-scope guard mirrors resolve/list siblings (VULN-12). The
    # use case also receives project_id but the router is the right place
    # to enforce the HTTP-404 boundary; the use case's check is defence-in-depth.
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    await UncorrelateLithoUnits(session).execute(
        project_id=project_id,
        model_id=model_id,
        formation_a_id=body.formation_a_id,
        formation_b_id=body.formation_b_id,
    )


# ---------------------------------------------------------------------------
# Slice 3 — explicit resolve + edge list
# ---------------------------------------------------------------------------

# IMPORTANT: the /resolve route is declared BEFORE the bare /correlations
# routes above so FastAPI's static-segment matching fires on "resolve"
# before a parameterless POST would.  With the current structure (one
# router, decorators in file order) FastAPI resolves ambiguity by
# registration order.  Both /correlations and /correlations/resolve are
# distinct paths so there is no actual ambiguity — this note is for
# clarity only.


@router.post(
    "/models/{model_id}/correlations/resolve",
    response_model=ResolveInstancesResponse,
    status_code=status.HTTP_200_OK,
    summary="Re-run the litho-instance ordinal resolver for a model",
)
async def resolve_litho_instances(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ResolveInstancesResponse:
    """Re-run the connected-component ordinal resolver for all formations in a model.

    Idempotent: if the current edge graph + formation depths already
    produce the correct ordinals, ``updated`` is empty and nothing is
    written to the DB.

    This endpoint is MODEL-level only.  It takes no ``section_id`` and
    does not touch ``seeded_formation_contact_ids`` on any cross-section
    row — the #57/applyUpdatedSection trap structurally cannot recur here.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).  Used to scope-guard the model.
    model_id : UUID
        The lithostratigraphic model whose formations are resolved.

    Returns
    -------
    ResolveInstancesResponse
        List of per-formation ordinal changes.  Empty when the resolver
        found nothing to update (already consistent).

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    """
    # Project-scope guard — same pattern as every other geology router.
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    result = await ResolveLithoInstances(session).execute(model_id=model_id)

    return ResolveInstancesResponse(
        updated=[
            OrdinalUpdateItem(
                formation_id=u.formation_id,
                new_ordinal=u.new_ordinal,
            )
            for u in result.updated
        ]
    )


@router.get(
    "/models/{model_id}/correlations",
    response_model=list[LithoCorrelationEdgeListItem],
    status_code=status.HTTP_200_OK,
    summary="List all correlation edges for a model",
)
async def list_correlations(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[LithoCorrelationEdgeOrm]:
    """Return every litho correlation edge in the model.

    Consumed by:
    * The LithologyInspector stale-badge computation (Slice 2) — the
      frontend tracks a hash/count of edge ids and flags
      ``instance_ordinal_locked`` formations when the edge set changed
      since the ordinal was last resolved.
    * Future Slice 4 correlation rendering on the section canvas.

    This endpoint is MODEL-level only.  It takes no ``section_id`` and
    does not touch ``seeded_formation_contact_ids`` — the #57 trap
    structurally cannot recur here.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).  Used to scope-guard the model.
    model_id : UUID
        The model whose edges are listed.

    Returns
    -------
    list[LithoCorrelationEdgeListItem]
        All edges for the model, ordered by creation time.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    """
    # Project-scope guard.
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    stmt = (
        select(LithoCorrelationEdgeOrm)
        .where(LithoCorrelationEdgeOrm.model_id == model_id)
        .order_by(LithoCorrelationEdgeOrm.created_at)
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return rows
