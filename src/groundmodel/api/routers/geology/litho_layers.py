"""Litho-layer API router — read-path for the unified litho model (Slice A1).

Mounted under the shared ``/projects/{project_id}/geology`` prefix
through the ``geology`` package ``__init__``. Final path:
``GET /projects/{project_id}/geology/models/{model_id}/layers``.

Slice A1 ships read endpoints only — Slice A2 lands the write path
(PATCH layer, boundary-move, batch-status, bulk-create) plus the
dual-write transition.

The ``project_id`` in the URL is a scope guard: the handler rejects
if the model doesn't belong to the project, preventing trivial
id-guessing across projects (same pattern as the contacts router).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.litho_layer import (
    LithoLayerBatchStatusRequest,
    LithoLayerBatchStatusResponse,
    LithoLayerBatchUpdateRequest,
    LithoLayerBatchUpdateResponse,
    LithoLayerBoundaryMoveRequest,
    LithoLayerBoundaryMoveResponse,
    LithoLayerBulkCreateRequest,
    LithoLayerResponse,
    LithoLayerStatusLiteral,
    LithoLayerUpdateRequest,
)
from groundmodel.application.batch_update_litho_layer_status import (
    BatchStatusError,
    BatchUpdateLithoLayerStatus,
)
from groundmodel.application.batch_update_litho_layers import (
    BatchUpdateError,
    BatchUpdateLithoLayers,
)
from groundmodel.application.bulk_create_litho_layers import (
    BulkCreateLithoLayers,
    LithoLayerCreateRequest,
)
from groundmodel.application.list_litho_layers_for_model import (
    ListLithoLayersForModel,
)
from groundmodel.application.move_litho_layer_boundary import (
    BoundaryMoveError,
    MoveLithoLayerBoundary,
)
from groundmodel.application.update_litho_layer import UpdateLithoLayer
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.session import get_session

router = APIRouter()


@router.get(
    "/models/{model_id}/layers",
    response_model=list[LithoLayerResponse],
)
async def list_layers(
    project_id: UUID,
    model_id: UUID,
    borehole_id: UUID | None = None,
    cpt_id: UUID | None = None,
    formation_id: UUID | None = None,
    status: LithoLayerStatusLiteral | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[LithoLayerOrm]:
    """List ``litho_layer`` rows in a model, optionally filtered.

    Sorted by ``depth_top_m`` ascending. When the model belongs to a
    geological (kind='geological') project rather than a
    lithostratigraphic one, returns an empty list — the table only
    carries litho rows.

    Filters
    -------
    borehole_id, cpt_id : UUID | None
        Restrict to one anchor. Combining both returns zero rows
        (the table's XOR CHECK guarantees no row matches both).
    formation_id : UUID | None
        Restrict to one formation across all anchors.
    status : "pending" | "accepted" | "rejected" | None
        Restrict to one status. Absence returns all three.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = ListLithoLayersForModel(session)
    return await use_case.execute(
        model_id,
        borehole_id=borehole_id,
        cpt_id=cpt_id,
        formation_id=formation_id,
        status=status,
    )


@router.post(
    "/models/{model_id}/layers",
    response_model=list[LithoLayerResponse],
)
async def bulk_create_layers(
    project_id: UUID,
    model_id: UUID,
    request: LithoLayerBulkCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> list[LithoLayerOrm]:
    """Insert N pending ``litho_layer`` rows in one transaction.

    Used by the suggest-litho flow after the Slice A3 cut-over: the
    segmenter output is persisted directly as ``status='pending'`` rows
    rather than held in ``BulkAnchorGhost.suggestions[]`` in memory.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = BulkCreateLithoLayers(session)
    payloads = [
        LithoLayerCreateRequest(
            formation_id=item.formation_id,
            depth_top_m=item.depth_top_m,
            depth_base_m=item.depth_base_m,
            status=item.status,
            source=item.source,
            confidence=item.confidence,
            borehole_id=item.borehole_id,
            cpt_id=item.cpt_id,
            observation_id=item.observation_id,
            observation_layer_id=item.observation_layer_id,
            parent_geo_contact_id=item.parent_geo_contact_id,
            notes=item.notes,
        )
        for item in request.layers
    ]
    return await use_case.execute(model_id, payloads)


@router.patch(
    "/models/{model_id}/layers/boundary-move",
    response_model=LithoLayerBoundaryMoveResponse,
)
async def move_boundary(
    project_id: UUID,
    model_id: UUID,
    request: LithoLayerBoundaryMoveRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerBoundaryMoveResponse:
    """Atomic two-row depth update on the shared boundary."""
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = MoveLithoLayerBoundary(session)
    try:
        result = await use_case.execute(
            request.upper_layer_id,
            request.lower_layer_id,
            request.new_depth_m,
        )
    except BoundaryMoveError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    return LithoLayerBoundaryMoveResponse(
        upper=LithoLayerResponse.model_validate(result.upper),
        lower=LithoLayerResponse.model_validate(result.lower),
    )


@router.post(
    "/models/{model_id}/layers/batch-status",
    response_model=LithoLayerBatchStatusResponse,
)
async def batch_update_status(
    project_id: UUID,
    model_id: UUID,
    request: LithoLayerBatchStatusRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerBatchStatusResponse:
    """Set the same status on N rows in one transaction (accept-all / reject-all)."""
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = BatchUpdateLithoLayerStatus(session)
    try:
        result = await use_case.execute(request.layer_ids, request.status)
    except BatchStatusError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    return LithoLayerBatchStatusResponse(
        updated_count=result.updated_count,
        layers=[LithoLayerResponse.model_validate(r) for r in result.layers],
    )


@router.patch(
    "/models/{model_id}/layers/batch-update",
    response_model=LithoLayerBatchUpdateResponse,
)
async def batch_update_layers(
    project_id: UUID,
    model_id: UUID,
    request: LithoLayerBatchUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerBatchUpdateResponse:
    """All-or-nothing PATCH for N layer rows in one transaction.

    Mirrors the existing ``POST /contacts/batch`` semantics so the FE
    multi-drag + cross-column MOVE gestures preserve the all-or-nothing
    contract after the A4 slice-4b cut-over.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    # Convert request items to (layer_id, patch_dict) tuples for the
    # use case; patch_dict is exclude_unset so only sent fields apply.
    patches = [
        (item.layer_id, item.model_dump(exclude_unset=True, exclude={"layer_id"}))
        for item in request.updates
    ]
    use_case = BatchUpdateLithoLayers(session)
    try:
        result = await use_case.execute(patches)
    except BatchUpdateError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    return LithoLayerBatchUpdateResponse(
        updated_count=result.updated_count,
        layers=[LithoLayerResponse.model_validate(r) for r in result.layers],
    )


@router.patch(
    "/models/{model_id}/layers/{layer_id}",
    response_model=LithoLayerResponse,
)
async def update_layer(
    project_id: UUID,
    model_id: UUID,
    layer_id: UUID,
    request: LithoLayerUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerOrm:
    """Partial update on one layer row.

    Mirrors ``PATCH /contacts/{cid}`` semantics: only fields present
    in the body are written. The anchor pair (borehole_id / cpt_id)
    is updatable with the XOR rule enforced at the request schema.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    patch = request.model_dump(exclude_unset=True)
    use_case = UpdateLithoLayer(session)
    updated = await use_case.execute(layer_id, patch)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found",
        )
    return updated
