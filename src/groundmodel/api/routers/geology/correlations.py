"""Geology API — litho correlation edges (Phase-2 Slices 1+3) and admixture propagation.

Mounted under the shared /projects/{project_id}/geology prefix by the
geology package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/correlations
  DELETE /projects/{pid}/geology/models/{mid}/correlations
  DELETE /projects/{pid}/geology/models/{mid}/correlations/auto
  POST   /projects/{pid}/geology/models/{mid}/correlations/resolve
  GET    /projects/{pid}/geology/models/{mid}/correlations
  PATCH  /projects/{pid}/geology/models/{mid}/correlations/admixtures
  POST   /projects/{pid}/geology/models/{mid}/auto-correlate   (#127)

All endpoints are MODEL-level only.  They take no section_id and
do NOT modify seeded_formation_contact_ids on any cross-section row.
This is the structural reason the #57/applyUpdatedSection trap cannot
recur here: there is no section entity in scope.

Idempotency contract:
  POST  /correlations           → 201 when a new edge was created; 200 when it already existed.
  DELETE /correlations          → 204 always (whether an edge was found-and-deleted or not).
  DELETE /correlations/auto     → 200 always (count of rows deleted; 0 = nothing to delete).
  POST  /correlations/resolve   → 200 always (idempotent — no-change returns empty list).
  GET   /correlations           → 200 always (returns current edge list, possibly empty).
  PATCH /correlations/admixtures → 200 always (returns updated formation list).
  POST  /auto-correlate         → 200 always (idempotent; 0 edges_created = nothing new).

Route ordering note:
  The static segments ``/correlations/resolve``, ``/correlations/admixtures``,
  and ``/correlations/auto`` MUST be registered before the parameterless
  ``/correlations`` routes so FastAPI does not misinterpret them as path
  parameters.  The current ordering in this file ensures that: static-segment
  routes come first.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.geological_formation import GeologicalFormationResponse
from groundmodel.api.schemas.project.litho_correlation.litho_correlation_schemas import (
    AutoCorrelateResponse,
    DeleteAutoCorrelationsResponse,
    LithoCorrelationEdgeListItem,
    LithoCorrelationRequest,
    LithoCorrelationResponse,
    OrdinalUpdateItem,
    PropagateAdmixturesRequest,
    PropagateAdmixturesResponse,
    ResolveInstancesResponse,
)
from groundmodel.application.auto_correlate_litho_bodies import AutoCorrelateLithoBodies
from groundmodel.application.correlate_litho_units import CorrelateLithoUnits
from groundmodel.application.propagate_litho_admixtures import PropagateLithoAdmixtures
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.uncorrelate_litho_units import UncorrelateLithoUnits
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
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


# ---------------------------------------------------------------------------
# Slice 4-HalfA — delete all auto edges (re-correlate flow)
# ---------------------------------------------------------------------------

# IMPORTANT: this route must be registered BEFORE the bare ``/correlations``
# DELETE route so FastAPI's static-segment matching fires on "auto" before
# the bare DELETE handler (which expects a JSON body) is reached.  With
# the current structure (one router, decorators in file order) FastAPI
# resolves ambiguity by registration order.  Both /correlations and
# /correlations/auto are distinct paths so there is no actual ambiguity
# — this note is for future reviewers only.


@router.delete(
    "/models/{model_id}/correlations/auto",
    response_model=DeleteAutoCorrelationsResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete all source='auto' correlation edges for a model",
)
async def delete_auto_correlations(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> DeleteAutoCorrelationsResponse:
    """Delete every ``litho_correlation_edge`` row with ``source='auto'`` for this model.

    Manual edges (``source='manual'``) are never touched.

    Idempotent: calling on a model that has no auto edges returns
    ``deleted=0`` (200, not 404).

    Used by the frontend re-correlate dialog — the user chose "Re-correlate:
    delete auto edges and rerun".  The caller fires this endpoint first, then
    immediately calls ``POST .../auto-correlate`` to regenerate the edges.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model whose auto edges are removed (path param).

    Returns
    -------
    DeleteAutoCorrelationsResponse
        Count of rows deleted.  Zero when no auto edges existed.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    stmt = (
        delete(LithoCorrelationEdgeOrm)
        .where(
            LithoCorrelationEdgeOrm.model_id == model_id,
            LithoCorrelationEdgeOrm.source == "auto",
        )
        .returning(LithoCorrelationEdgeOrm.id)
    )
    result = await session.execute(stmt)
    deleted_count = len(result.fetchall())
    await session.commit()

    return DeleteAutoCorrelationsResponse(deleted=deleted_count)


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


@router.patch(
    "/models/{model_id}/correlations/admixtures",
    response_model=PropagateAdmixturesResponse,
    status_code=status.HTTP_200_OK,
    summary="Propagate admixtures to every formation in a correlated body",
)
async def propagate_correlated_admixtures(
    project_id: UUID,
    model_id: UUID,
    body: PropagateAdmixturesRequest,
    session: AsyncSession = Depends(get_session),
) -> PropagateAdmixturesResponse:
    """Write ``litho_admixtures`` to every formation in the seed's connected component.

    BFS-expands from ``body.formation_id`` over the model's correlation-edge
    graph and writes the supplied admixture list to ALL reachable formations
    in that component (including the seed itself).

    Only ``litho_admixtures`` is modified — ``litho_main_soil_code`` and
    ``instance_ordinal`` are left untouched so no resolver re-run is needed.

    If the seed formation has no correlation edges, the component is the
    singleton ``{seed}`` and only the seed's admixtures are updated.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model whose edge graph is traversed (path param).
    body : PropagateAdmixturesRequest
        Seed formation id + the new admixture list to write.

    Returns
    -------
    PropagateAdmixturesResponse
        Updated formation rows (post-commit refresh) and component size.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    422
        When the seed formation is missing / out-of-scope / not a litho unit,
        or when the model is not of kind ``'lithostratigraphic'``.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    admixtures_dicts = [
        {"soil_code": a.soil_code, "amount": a.amount, "locally": a.locally}
        for a in body.admixtures
    ]

    try:
        result = await PropagateLithoAdmixtures(session).execute(
            project_id=project_id,
            model_id=model_id,
            seed_formation_id=body.formation_id,
            admixtures=admixtures_dicts,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err

    # Resolve parent_formation_name for each updated formation.
    # Load all project formations so the name-map covers orphan parents too.
    all_formations_stmt = select(GeologicalFormationOrm).where(
        GeologicalFormationOrm.app_project_id == project_id
    )
    all_formations = list((await session.execute(all_formations_stmt)).scalars().all())
    name_map: dict[UUID, str] = {f.id: f.name for f in all_formations}

    enriched: list[GeologicalFormationResponse] = []
    for f_orm in result.updated_formations:
        resp = GeologicalFormationResponse.model_validate(f_orm)
        if f_orm.parent_formation_id is not None:
            resp.parent_formation_name = name_map.get(f_orm.parent_formation_id)
        enriched.append(resp)

    return PropagateAdmixturesResponse(
        updated_formations=enriched,
        component_size=result.component_size,
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


# ---------------------------------------------------------------------------
# #127 — auto-correlate endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/auto-correlate",
    response_model=AutoCorrelateResponse,
    status_code=status.HTTP_200_OK,
    summary="Run the auto-correlate algorithm across a lithostratigraphic model",
)
async def auto_correlate_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> AutoCorrelateResponse:
    """Run the bottom-up dip-transfer auto-correlate algorithm for a model.

    Loads all formation contacts in the model, computes correlation
    candidates using the pure domain algorithm (distance-aware window,
    mutual-nearest-neighbour disambiguation, Theil-Sen dip transfer),
    inserts net-new edges with ``source='auto'``, re-runs the ordinal
    resolver once, and triggers absence inference for each touched
    formation — all in a single transaction.

    Idempotent: calling again with no new contacts / edges produces
    ``edges_created=0`` and is a no-op.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model to process (path param).

    Returns
    -------
    AutoCorrelateResponse
        Counts of edges created, skipped, and formations recomputed.
        ``edges_created=0`` means the model was already fully correlated.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    422
        When the model is not of kind ``'lithostratigraphic'``.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    try:
        result = await AutoCorrelateLithoBodies(session).execute(
            project_id=project_id,
            model_id=model_id,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err

    return AutoCorrelateResponse(
        edges_created=result.edges_created,
        edges_skipped_existing=result.edges_skipped_existing,
        formations_recomputed=result.formations_recomputed,
        wedge_tips_materialised=result.wedge_tips_materialised,
    )
