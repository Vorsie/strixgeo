"""Geology API — litho contact-correlation edges (#133 Phase 1).

Mounted under the shared /projects/{project_id}/geology prefix by the
geology package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/contact-correlations
  DELETE /projects/{pid}/geology/models/{mid}/contact-correlations
  GET    /projects/{pid}/geology/models/{mid}/contact-correlations

These endpoints are MODEL-level only.  They take no section_id and do NOT
modify seeded_formation_contact_ids on any cross-section row — the #57
structural trap cannot recur here.

The contact-level model coexists with the formation-level
``/correlations`` endpoints (debt #133 Phase 3 migrates and retires those).

Idempotency contract:
  POST   -> 201 when a new edge was created; 200 when it already existed.
  DELETE -> 204 always (edge found-and-deleted or not).
  GET    -> 200 always (current edge list, possibly empty).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.litho_contact_correlation.litho_contact_correlation_schemas import (  # noqa: E501
    ContactCorrelationEdgeListItem,
    ContactCorrelationRequest,
    ContactCorrelationResponse,
)
from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
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
