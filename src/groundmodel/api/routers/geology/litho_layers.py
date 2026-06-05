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
from groundmodel.application.delete_litho_layer import DeleteLithoLayer
from groundmodel.application.link_litho_to_geo import LinkLithoToGeo
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
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import LithoLayerOverlapError

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
    """Insert N ``litho_layer`` rows in one transaction.

    Used by the suggest-litho flow (segmenter output → pending layers)
    and by the manual-create-contact path (single-item array with
    section_id) after the A4 cut-over.

    When ``section_id`` is provided the freshly-created layer ids are
    unioned into that section's ``seeded_formation_contact_ids`` array —
    the explicit-content invariant carried forward from the contact
    endpoint (only seeded ids pass the section's filter so the user
    actually sees what they just drew). Non-fatal: a seeding failure
    leaves the set stale but the 200 still stands.
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
    created = await use_case.execute(model_id, payloads)
    if request.section_id is not None and created:
        # The created layers' ids are valid contact ids by Shape A's
        # UUID-preservation rule (LL→FC trigger materialises accepted
        # FCs with the same id), so unioning them into the section's
        # seeded set works whether the section filter reads /layers
        # or /contacts.
        await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            {layer.id for layer in created},
            operation="bulk_create_layers",
        )
    return created


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


@router.post(
    "/models/{model_id}/layers/{layer_id}/link-geo",
    response_model=LithoLayerResponse | None,
    responses={
        200: {"description": "Linked successfully or no geo contact within tolerance (null body)."},
    },
)
async def link_layer_to_geo(
    project_id: UUID,
    model_id: UUID,
    layer_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerOrm | None:
    """Link a litho LAYER to the nearest geological contact (A4 cleanup).

    Mirrors the contact-side ``/contacts/{id}/link-geo`` endpoint. UUIDs
    are preserved between LL and FC (LL.id == FC.id for accepted layers),
    so the existing LinkLithoToGeo use case operates on the same row via
    either entry point. The post-commit return is the refreshed LL row
    (the FC→LL trigger UPSERTs parent_geo_contact_id automatically when
    the use case commits the FC mutation).

    Returns 200 with the updated layer, or 200 with a null body when no
    geo contact is within tolerance. 404 when the layer doesn't exist or
    isn't in the URL model.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    layer = await session.get(LithoLayerOrm, layer_id)
    if layer is None or layer.model_id != model_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    try:
        # contact_id == layer_id by Shape A's UUID-preservation rule.
        contact = await LinkLithoToGeo(session).execute(project_id=project_id, contact_id=layer_id)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
    if contact is None:
        return None
    # FC→LL trigger already mirrored the parent_geo_contact_id update
    # onto the layer row; refresh so the response reflects it.
    await session.refresh(layer)
    return layer


@router.post(
    "/models/{model_id}/layers/{layer_id}/unlink-geo",
    response_model=LithoLayerResponse,
)
async def unlink_layer_from_geo(
    project_id: UUID,
    model_id: UUID,
    layer_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerOrm:
    """Clear the litho↔geo coupling on a single layer (A4 cleanup).

    Thin wrapper over ``UpdateLithoLayer`` with ``parent_geo_contact_id``
    set to NULL. Provided alongside ``link-geo`` so the FE has a
    consistent layer-shaped pair for the coupling toggle (parity with
    the contact-side unlink endpoint).
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    updated = await UpdateLithoLayer(session).execute(layer_id, {"parent_geo_contact_id": None})
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    return updated


@router.delete(
    "/models/{model_id}/layers/{layer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_layer(
    project_id: UUID,
    model_id: UUID,
    layer_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete one ``litho_layer`` row + reconcile downstream state.

    Idempotent — returns 204 whether the row existed or not. For
    accepted layers the LL→FC trigger removes the matching contact
    mirror; correlation edges referencing the layer cascade via the
    FK. The use case re-runs the instance resolver + lens detector
    afterwards so the model stays consistent.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    layer_id : UUID
        The layer to delete (path param).

    Raises
    ------
    404
        When the model does not exist or does not belong to
        ``project_id``. A missing layer is silently 204 (idempotent).
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    await DeleteLithoLayer(session).execute(
        layer_id,
        project_id=project_id,
        model_id=model_id,
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
    try:
        updated = await use_case.execute(layer_id, patch)
    except LithoLayerOverlapError as err:
        # The no-overlap exclusion constraint fired at commit. Answer 409 with a
        # named code instead of leaking a raw 500 — the edit would put this
        # layer inside an accepted sibling on the same column.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "litho_layer_overlap",
                "message": (
                    "This depth edit would overlap an accepted layer on the same "
                    "investigation. Move the neighbouring boundary first, or "
                    "delete the overlapping layer."
                ),
                "layer_id": str(err.layer_id),
            },
        ) from err
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found",
        )
    return updated
