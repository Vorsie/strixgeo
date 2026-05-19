"""Geology API — litho correlation edges (Phase-2 Slice 1).

Mounted under the shared /projects/{project_id}/geology prefix by the
geology package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/correlations
  DELETE /projects/{pid}/geology/models/{mid}/correlations

Both endpoints are MODEL-level only.  They take no section_id and
do NOT modify seeded_formation_contact_ids on any cross-section row.
This is the structural reason the #57/applyUpdatedSection trap cannot
recur here: there is no section entity in scope.

Idempotency contract:
  POST  → 201 when a new edge was created; 200 when it already existed.
  DELETE → 204 always (whether an edge was found-and-deleted or not).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.project.litho_correlation.litho_correlation_schemas import (
    LithoCorrelationRequest,
    LithoCorrelationResponse,
    OrdinalUpdateItem,
)
from groundmodel.application.correlate_litho_units import CorrelateLithoUnits
from groundmodel.application.uncorrelate_litho_units import UncorrelateLithoUnits
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
    422
        When formation_a_id == formation_b_id (self-loop) or the body
        fails Pydantic validation.
    422
        When either formation does not belong to the model / project, or
        the two formations are in different naming groups.
    """
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
    """
    await UncorrelateLithoUnits(session).execute(
        project_id=project_id,
        model_id=model_id,
        formation_a_id=body.formation_a_id,
        formation_b_id=body.formation_b_id,
    )
