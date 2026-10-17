"""Geology API — litho contact-correlation edges (#133 Phase 1+2).

Mounted under the shared /projects/{project_id}/geology prefix by the
geology package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/contact-correlations
  DELETE /projects/{pid}/geology/models/{mid}/contact-correlations
  GET    /projects/{pid}/geology/models/{mid}/contact-correlations
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations/auto
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations/accept
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations/{edge_id}/accept
  POST   /projects/{pid}/geology/models/{mid}/body-companions/materialise

These endpoints are MODEL-level only.  They take no section_id and do NOT
modify seeded_formation_contact_ids on any cross-section row — the #57
structural trap cannot recur here.

The contact-level model coexists with the formation-level
``/correlations`` endpoints (debt #133 Phase 3 migrates and retires those).

Idempotency contract:
  POST   (create)     -> 201 when a new edge was created; 200 when it already existed.
  DELETE              -> 204 always (edge found-and-deleted or not).
  GET                 -> 200 always (current edge list, possibly empty).
  POST   /auto        -> 200 always (count shape).
  POST   /accept      -> 200 always (count shape).
  POST   /materialise -> 200 always (count shape).
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.routers.geology.formations import _build_parent_code_map
from groundmodel.api.schemas.project.geological_formation import GeologicalFormationResponse
from groundmodel.api.schemas.project.litho_contact_correlation.accept_schemas import (
    AcceptContactCorrelationsRequest,
    AcceptContactCorrelationsResponse,
    ConfirmEdgeReviewResponse,
)
from groundmodel.api.schemas.project.litho_contact_correlation.auto_schemas import (
    AutoCorrelateContactRequest,
    AutoCorrelateContactResponse,
    CrossingPinchOutResponse,
    DeleteAutoCorrelationsResponse,
)
from groundmodel.api.schemas.project.litho_contact_correlation.body_companion_schemas import (
    MaterialiseBodyCompanionsResponse,
)
from groundmodel.api.schemas.project.litho_contact_correlation.litho_contact_correlation_schemas import (  # noqa: E501
    ContactCorrelationEdgeListItem,
    ContactCorrelationRequest,
    ContactCorrelationResponse,
    ContactSide,
)
from groundmodel.api.schemas.project.litho_correlation.litho_correlation_schemas import (
    PropagateAdmixturesRequest,
    PropagateAdmixturesResponse,
)
from groundmodel.application.accept_contact_correlations import AcceptContactCorrelations
from groundmodel.application.auto_correlate_contact_edges import AutoCorrelateContactEdges
from groundmodel.application.confirm_correlation_edge_review import (
    ConfirmCorrelationEdgeReview,
)
from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
from groundmodel.application.materialise_body_companions import MaterialiseBodyCompanions
from groundmodel.application.propagate_litho_admixtures import PropagateLithoAdmixtures
from groundmodel.domain.services.auto_correlate_contact_edges import (
    AutoCorrelateContactParams,
)
from groundmodel.infrastructure.db.dml_rowcount import dml_rowcount
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import (
    CrossingCorrelationError,
    CrossLithoBodyCorrelationError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

router = APIRouter()

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)


@router.post(
    "/models/{model_id}/contact-correlations",
    response_model=ContactCorrelationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create (or confirm) a contact-level correlation edge (#133)",
)
async def create_contact_correlation(
    project_id: UUID,
    model_id: UUID,
    body: ContactCorrelationRequest,
    session: AsyncSession = Depends(get_session),
) -> ContactCorrelationResponse:
    """Record that two formation contacts represent the same boundary across columns.

    Creates an undirected contact-level edge stored in canonical ordering
    ``(min, max)`` so the pair is unique regardless of call order.

    Returns **201** when a new edge is inserted; **200** when the edge
    already existed (idempotent re-call).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    body : ContactCorrelationRequest
        The two contact endpoints and optional source token.

    Returns
    -------
    ContactCorrelationResponse
        Edge id, canonical endpoints, was_created flag.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    422
        When layer_a_id == layer_b_id (self-loop), when either contact
        does not belong to the model / project, or when a geotech packing
        correlation crosses lithostratigraphic body boundaries
        (``CrossLithoBodyCorrelationError``), or would cross a tie already
        standing in the same gap (``CrossingCorrelationError``).
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        result = await CorrelateLithoContacts(session).execute(
            project_id=project_id,
            model_id=model_id,
            layer_a_id=body.layer_a_id,
            layer_b_id=body.layer_b_id,
            source=body.source,
            request_section_id=body.request_section_id,
            layer_a_side=body.layer_a_side,
            layer_b_side=body.layer_b_side,
        )
    except CrossingCorrelationError as err:
        # Owner ruling 2026-08-17: a crossing tie the engineer draws is rejected
        # with a toast. The renderer shows the server's own words, so the
        # message must name columns and depths rather than ids.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except CrossLithoBodyCorrelationError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err

    response = ContactCorrelationResponse(
        edge_id=result.edge.id,
        layer_a_id=result.edge.layer_a_id,
        layer_b_id=result.edge.layer_b_id,
        # The ORM column is ``str``; the CHECK constraint on the table holds it
        # to top / base, and pydantic re-validates the Literal at runtime.
        layer_a_side=cast(ContactSide, result.edge.layer_a_side),
        layer_b_side=cast(ContactSide, result.edge.layer_b_side),
        model_id=result.edge.model_id,
        source=result.edge.source,
        was_created=result.was_created,
        # The tie stands; the warning rides along so the renderer can toast it
        # (owner order 2026-08-21 — flag a tie the litho frame will not band).
        frame_warning=result.frame_warning,
    )
    if not result.was_created:
        from fastapi.responses import JSONResponse

        return JSONResponse(  # type: ignore[return-value]
            content=response.model_dump(mode="json"),
            status_code=status.HTTP_200_OK,
        )
    return response


@router.delete(
    "/models/{model_id}/contact-correlations",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a contact-level correlation edge (#133)",
)
async def delete_contact_correlation(
    project_id: UUID,
    model_id: UUID,
    body: ContactCorrelationRequest,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove the contact-level correlation edge between two contacts.

    Idempotent: returns **204** whether the edge existed or not.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    body : ContactCorrelationRequest
        The two contact endpoints (order does not matter).

    Returns
    -------
    None
        204 No Content always.

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
    try:
        await UncorrelateLithoContacts(session).execute(
            project_id=project_id,
            model_id=model_id,
            layer_a_id=body.layer_a_id,
            layer_b_id=body.layer_b_id,
            request_section_id=body.request_section_id,
            layer_a_side=body.layer_a_side,
            layer_b_side=body.layer_b_side,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err


@router.get(
    "/models/{model_id}/contact-correlations",
    response_model=list[ContactCorrelationEdgeListItem],
    status_code=status.HTTP_200_OK,
    summary="List all contact-level correlation edges for a model (#133)",
)
async def list_contact_correlations(
    project_id: UUID,
    model_id: UUID,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[LithoContactCorrelationEdgeOrm]:
    """Return contact-level correlation edges in the model.

    Consumed by the section canvas renderer to draw point-to-point
    boundary lines between correlated contacts (#133 Phase 1).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The model whose contact edges are listed.
    section_id : UUID | None
        Optional section scope (query param).  When given, only edges AUTHORED
        on this section (``edge.section_id == section_id``) are returned — so
        the section view renders only its own ribbons and the auto-correlate
        pre-check counts this section's suggestions, not the whole model's
        (section-scoped correlations, owner directive 2026-06-08).  Omitted
        ``→`` model-wide.

    Returns
    -------
    list[ContactCorrelationEdgeListItem]
        Edges for the model (optionally section-scoped), ordered by creation time.

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
    stmt = select(LithoContactCorrelationEdgeOrm).where(
        LithoContactCorrelationEdgeOrm.model_id == model_id
    )
    if section_id is not None:
        # Section-scoped render (owner directive 2026-06-08): an edge belongs to
        # the section it was AUTHORED on, not "any section that projects both
        # endpoints". Filter the section_id column directly.
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.section_id == section_id)
    stmt = stmt.order_by(LithoContactCorrelationEdgeOrm.created_at)
    rows = list((await session.execute(stmt)).scalars().all())
    return rows


@router.post(
    "/models/{model_id}/contact-correlations/auto",
    response_model=AutoCorrelateContactResponse,
    status_code=status.HTTP_200_OK,
    summary="Auto-propose contact-level correlation edges (#133 Phase 2)",
)
async def auto_correlate_contact(
    project_id: UUID,
    model_id: UUID,
    body: AutoCorrelateContactRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> AutoCorrelateContactResponse:
    """Run the contact-level auto-correlate algorithm for a model.

    Proposes edges with ``user_approved=False`` — they are visible to the
    frontend but do NOT yet participate in lens detection.  Call
    ``/accept`` afterwards to promote them.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    body : AutoCorrelateContactRequest | None
        Optional tunables.  ``base_depth_threshold_m`` overrides the
        depth-match window (the Settings knob, #163b); omitted/``None``
        uses the algorithm default.

    Returns
    -------
    AutoCorrelateContactResponse
        Counts of net-new edges created and candidates skipped because
        they already existed.

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
    # Build params only when the caller tuned the depth window; otherwise
    # let the use case apply its own defaults.
    params: AutoCorrelateContactParams | None = None
    if body is not None and body.base_depth_threshold_m is not None:
        params = AutoCorrelateContactParams(base_depth_threshold_m=body.base_depth_threshold_m)
    try:
        result = await AutoCorrelateContactEdges(session).execute(
            project_id=project_id,
            model_id=model_id,
            params=params,
            section_id=body.section_id if body is not None else None,
        )
    except ValueError as err:
        # Non-litho model (or out-of-project) — the use case rejects it.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    return AutoCorrelateContactResponse(
        edges_created=result.edges_created,
        edges_skipped_existing=result.edges_skipped_existing,
        edges_dropped_crossing=result.edges_dropped_crossing,
        crossing_pinch_outs=[
            CrossingPinchOutResponse(
                source_investigation_id=po.source_investigation_id,
                above_contact_id=po.above_contact_id,
                below_contact_id=po.below_contact_id,
                neighbour_investigation_id=po.neighbour_investigation_id,
            )
            for po in result.crossing_pinch_outs
        ],
    )


@router.delete(
    "/models/{model_id}/contact-correlations/auto",
    response_model=DeleteAutoCorrelationsResponse,
    status_code=status.HTTP_200_OK,
    summary="Clear all unapproved (auto) contact-correlation suggestions (#179)",
)
async def delete_auto_contact_correlations(
    project_id: UUID,
    model_id: UUID,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> DeleteAutoCorrelationsResponse:
    """Remove unapproved (suggestion) contact-correlation edges for a model.

    The "Clear suggestions" action (#179). Deletes only
    ``user_approved=False`` edges — approved manual correlations are left
    intact. Idempotent: returns ``deleted=0`` when there is nothing to clear.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    section_id : UUID | None
        Optional section scope (query param).  When given, only suggestion
        edges AUTHORED on this section (``edge.section_id == section_id``) are
        cleared — so re-correlating one section cannot wipe a neighbouring
        section's auto edges (section-scoped correlations, owner directive
        2026-06-08).  Omitted ``→`` model-wide clear.
    session : AsyncSession
        DB session.

    Returns
    -------
    DeleteAutoCorrelationsResponse
        Count of suggestion edges removed.

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
    stmt = delete(LithoContactCorrelationEdgeOrm).where(
        LithoContactCorrelationEdgeOrm.model_id == model_id,
        LithoContactCorrelationEdgeOrm.user_approved.is_(False),
    )
    if section_id is not None:
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.section_id == section_id)
    result = await session.execute(stmt)
    deleted = dml_rowcount(result) or 0
    await session.commit()
    logger.info(
        f"delete_auto_contact_correlations: project={project_id} model={model_id} "
        f"section={section_id} cleared {deleted} suggestion edge(s)"
    )
    return DeleteAutoCorrelationsResponse(deleted=deleted)


@router.post(
    "/models/{model_id}/contact-correlations/accept",
    response_model=AcceptContactCorrelationsResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve auto-proposed contact-correlation edges in scope (#133 Phase 2)",
)
async def accept_contact_correlations(
    project_id: UUID,
    model_id: UUID,
    body: AcceptContactCorrelationsRequest,
    session: AsyncSession = Depends(get_session),
) -> AcceptContactCorrelationsResponse:
    """Flip ``user_approved=True`` for in-scope unapproved edges.

    Scope is section-local when ``section_id`` is supplied (both endpoints
    must be seeded on that section); model-wide when ``section_id`` is
    ``None``.  After flipping, runs the ordinal resolver and lens detector
    in the same transaction.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    body : AcceptContactCorrelationsRequest
        Optional ``section_id`` to scope the accept pass.

    Returns
    -------
    AcceptContactCorrelationsResponse
        Counts of edges accepted and ordinal changes triggered.

    Raises
    ------
    404
        When the model or the referenced section does not belong to
        ``project_id``.
    """
    # The SCOPE is the load-bearing part of this request now that the geotech
    # toolbar's step 3 defaults to the open section (owner ruling 2026-08-15):
    # "accepted 40 correlations" reads very differently depending on whether it
    # covered one section or fourteen, and the terminal is where the owner
    # checks that during a dogfeed.
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/contact-correlations/accept "
        f"scope={'section=' + str(body.section_id) if body.section_id else 'model-wide'}"
    )
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        result = await AcceptContactCorrelations(session).execute(
            project_id=project_id, model_id=model_id, section_id=body.section_id
        )
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
    logger.info(
        f"accept_contact_correlations ok model={model_id} "
        f"scope={'section=' + str(body.section_id) if body.section_id else 'model-wide'} "
        f"accepted={result.edges_accepted} ordinals_changed={result.ordinals_changed}"
    )
    return AcceptContactCorrelationsResponse(
        edges_accepted=result.edges_accepted,
        ordinals_changed=result.ordinals_changed,
    )


@router.post(
    "/models/{model_id}/contact-correlations/{edge_id}/accept",
    response_model=AcceptContactCorrelationsResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve a single contact-correlation edge (dogfeed 2026-05-31)",
)
async def accept_single_contact_correlation(
    project_id: UUID,
    model_id: UUID,
    edge_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> AcceptContactCorrelationsResponse:
    """Flip ``user_approved=True`` for one edge identified by ``edge_id``.

    Powers the right-click "Accept correlation" menu item on a single edge.
    Idempotent — re-accepting an already-approved edge returns
    ``edges_accepted=0`` without raising. Runs the ordinal resolver and
    lens detector in the same transaction so the model stays consistent.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).
    edge_id : UUID
        The single edge to accept (path param).

    Returns
    -------
    AcceptContactCorrelationsResponse
        Counts of edges accepted and ordinal changes triggered.

    Raises
    ------
    404
        When the model or edge does not exist, or the edge does not belong
        to the given model.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        result = await AcceptContactCorrelations(session).execute(
            project_id=project_id, model_id=model_id, edge_id=edge_id
        )
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
    return AcceptContactCorrelationsResponse(
        edges_accepted=result.edges_accepted,
        ordinals_changed=result.ordinals_changed,
    )


@router.post(
    "/models/{model_id}/contact-correlations/{edge_id}/confirm-review",
    response_model=ConfirmEdgeReviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm one flagged correlation edge (2026-08-02)",
)
async def confirm_single_edge_review(
    project_id: UUID,
    model_id: UUID,
    edge_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ConfirmEdgeReviewResponse:
    """Clear ``review_reason`` on one edge — the engineer says the tie is right.

    Powers the right-click "Confirm tie" menu item on a flagged edge.  The other
    half of the same decision is the existing delete: a re-subdivide that could
    not place an accepted tie confidently carries it with a flag rather than
    deleting it, and the engineer resolves it one way or the other.

    Changes no geometry and no approval state — a flagged edge is already
    approved.  Idempotent: confirming an unflagged edge returns
    ``edges_confirmed=0`` without raising.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The model owning the edge (path param).
    edge_id : UUID
        The edge to confirm (path param).

    Returns
    -------
    ConfirmEdgeReviewResponse
        How many flags were cleared (0 or 1).

    Raises
    ------
    404
        When the model does not belong to ``project_id``.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    result = await ConfirmCorrelationEdgeReview(session).execute(model_id=model_id, edge_id=edge_id)
    return ConfirmEdgeReviewResponse(edges_confirmed=result.edges_confirmed)


@router.post(
    "/models/{model_id}/contact-correlations/confirm-review",
    response_model=ConfirmEdgeReviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm every flagged correlation edge of a model (2026-08-02)",
)
async def confirm_all_edge_reviews(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ConfirmEdgeReviewResponse:
    """Clear ``review_reason`` on every flagged edge of the model.

    The bulk counterpart of :func:`confirm_single_edge_review`, for when the
    engineer has looked over the flagged ties and accepts them as a set.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The model whose flags are cleared (path param).

    Returns
    -------
    ConfirmEdgeReviewResponse
        How many flags were cleared.

    Raises
    ------
    404
        When the model does not belong to ``project_id``.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    result = await ConfirmCorrelationEdgeReview(session).execute(model_id=model_id)
    return ConfirmEdgeReviewResponse(edges_confirmed=result.edges_confirmed)


@router.post(
    "/models/{model_id}/body-companions/materialise",
    response_model=MaterialiseBodyCompanionsResponse,
    status_code=status.HTTP_200_OK,
    summary="Create perpendicular companion sections for qualifying lenses (#133 Phase 2)",
)
async def materialise_body_companions(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> MaterialiseBodyCompanionsResponse:
    """Auto-create companion sections for lenses whose primary section is fully correlated.

    A lens qualifies when every contact seeded on its primary section has
    at least one ``user_approved=True`` outbound edge.  Lenses that
    already have a companion section are skipped silently (idempotent).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The lithostratigraphic model (path param).

    Returns
    -------
    MaterialiseBodyCompanionsResponse
        Counts of sections created, lenses skipped for various reasons,
        and lenses that errored.

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
    result = await MaterialiseBodyCompanions(session).execute(
        project_id=project_id, model_id=model_id
    )
    return MaterialiseBodyCompanionsResponse(
        companion_sections_created=result.companion_sections_created,
        skipped_no_primary=result.skipped_no_primary,
        skipped_unfinished_section=result.skipped_unfinished_section,
        errored=result.errored,
    )


# ---------------------------------------------------------------------------
# Admixture propagation (#133 Phase 3 — moved from formation-level router)
# ---------------------------------------------------------------------------


@router.patch(
    "/models/{model_id}/contact-correlations/admixtures",
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

    BFS-expands from ``body.formation_id`` over the model's contact-level
    correlation-edge graph (the formation-level edges were retired in #133
    Phase 3) and writes the supplied admixture list to ALL reachable
    formations in that component (including the seed itself).

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
    # Same formal-code resolution the GET /formations path uses (manual link
    # first, then the DOV-derived regional_ref) so the lens auto-name is stable
    # across both response surfaces.
    code_map: dict[UUID, str | None] = _build_parent_code_map(all_formations)

    enriched: list[GeologicalFormationResponse] = []
    for f_orm in result.updated_formations:
        resp = GeologicalFormationResponse.model_validate(f_orm)
        if f_orm.parent_formation_id is not None:
            resp.parent_formation_name = name_map.get(f_orm.parent_formation_id)
            resp.parent_formation_code = code_map.get(f_orm.parent_formation_id)
        enriched.append(resp)

    return PropagateAdmixturesResponse(
        updated_formations=enriched,
        component_size=result.component_size,
    )
