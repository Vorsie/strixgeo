"""Geology API — litho contact-correlation edges (#133 Phase 1+2).

Mounted under the shared /projects/{project_id}/geology prefix by the
geology package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/contact-correlations
  DELETE /projects/{pid}/geology/models/{mid}/contact-correlations
  GET    /projects/{pid}/geology/models/{mid}/contact-correlations
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations/auto
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations/accept
  POST   /projects/{pid}/geology/models/{mid}/lens-companions/materialise

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

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.litho_contact_correlation.accept_schemas import (
    AcceptContactCorrelationsRequest,
    AcceptContactCorrelationsResponse,
)
from groundmodel.api.schemas.project.litho_contact_correlation.auto_schemas import (
    AutoCorrelateContactResponse,
)
from groundmodel.api.schemas.project.litho_contact_correlation.lens_companion_schemas import (
    MaterialiseLensCompanionsResponse,
)
from groundmodel.api.schemas.project.litho_contact_correlation.litho_contact_correlation_schemas import (  # noqa: E501
    ContactCorrelationEdgeListItem,
    ContactCorrelationRequest,
    ContactCorrelationResponse,
)
from groundmodel.application.accept_contact_correlations import AcceptContactCorrelations
from groundmodel.application.auto_correlate_contact_edges import AutoCorrelateContactEdges
from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
from groundmodel.application.materialise_lens_companions import MaterialiseLensCompanions
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.session import get_session

router = APIRouter()


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
        When contact_a_id == contact_b_id (self-loop), or when either
        contact does not belong to the model / project.
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
            contact_a_id=body.contact_a_id,
            contact_b_id=body.contact_b_id,
            source=body.source,
            request_section_id=body.request_section_id,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err

    response = ContactCorrelationResponse(
        edge_id=result.edge.id,
        contact_a_id=result.edge.contact_a_id,
        contact_b_id=result.edge.contact_b_id,
        model_id=result.edge.model_id,
        source=result.edge.source,
        was_created=result.was_created,
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
            contact_a_id=body.contact_a_id,
            contact_b_id=body.contact_b_id,
            request_section_id=body.request_section_id,
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
    session: AsyncSession = Depends(get_session),
) -> list[LithoContactCorrelationEdgeOrm]:
    """Return every contact-level correlation edge in the model.

    Consumed by the section canvas renderer to draw point-to-point
    boundary lines between correlated contacts (#133 Phase 1).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param).
    model_id : UUID
        The model whose contact edges are listed.

    Returns
    -------
    list[ContactCorrelationEdgeListItem]
        All contact edges for the model, ordered by creation time.

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
        select(LithoContactCorrelationEdgeOrm)
        .where(LithoContactCorrelationEdgeOrm.model_id == model_id)
        .order_by(LithoContactCorrelationEdgeOrm.created_at)
    )
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
    result = await AutoCorrelateContactEdges(session).execute(
        project_id=project_id, model_id=model_id
    )
    return AutoCorrelateContactResponse(
        edges_created=result.edges_created,
        edges_skipped_existing=result.edges_skipped_existing,
    )


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
        Counts of edges accepted, lenses created/removed, and ordinal
        changes triggered.

    Raises
    ------
    404
        When the model or the referenced section does not belong to
        ``project_id``.
    """
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
    return AcceptContactCorrelationsResponse(
        edges_accepted=result.edges_accepted,
        lenses_created=result.lenses_created,
        lenses_removed=result.lenses_removed,
        ordinals_changed=result.ordinals_changed,
    )


@router.post(
    "/models/{model_id}/lens-companions/materialise",
    response_model=MaterialiseLensCompanionsResponse,
    status_code=status.HTTP_200_OK,
    summary="Create perpendicular companion sections for qualifying lenses (#133 Phase 2)",
)
async def materialise_lens_companions(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> MaterialiseLensCompanionsResponse:
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
    MaterialiseLensCompanionsResponse
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
    result = await MaterialiseLensCompanions(session).execute(
        project_id=project_id, model_id=model_id
    )
    return MaterialiseLensCompanionsResponse(
        companion_sections_created=result.companion_sections_created,
        skipped_no_primary=result.skipped_no_primary,
        skipped_unfinished_section=result.skipped_unfinished_section,
        errored=result.errored,
    )
