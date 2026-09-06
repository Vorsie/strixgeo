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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    get_in_project_or_404,
    litho_layer_write_conflict,
)
from groundmodel.api.schemas.project.litho_layer import (
    LithoLayerBatchStatusRequest,
    LithoLayerBatchStatusResponse,
    LithoLayerBatchUpdateRequest,
    LithoLayerBatchUpdateResponse,
    LithoLayerBoundaryMoveRequest,
    LithoLayerBoundaryMoveResponse,
    LithoLayerBulkCreateRequest,
    LithoLayerCompositionRequest,
    LithoLayerResponse,
    LithoLayerSplitRequest,
    LithoLayerSplitResponse,
    LithoLayerStatusLiteral,
    LithoLayerUpdateRequest,
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
from groundmodel.application.edit_litho_layer_composition import EditLithoLayerComposition
from groundmodel.application.link_litho_to_geo import LinkLithoToGeo
from groundmodel.application.list_litho_layers_for_model import (
    ListLithoLayersForModel,
)
from groundmodel.application.move_litho_layer_boundary import (
    BoundaryMoveError,
    MoveLithoLayerBoundary,
)
from groundmodel.application.split_litho_layer import SplitError, SplitLithoLayer
from groundmodel.application.update_litho_layer import UpdateLithoLayer
from groundmodel.domain.value_objects.admixture import Admixture
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

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    borehole_id : UUID | None
        Optional query filter — restrict to one borehole anchor.
    cpt_id : UUID | None
        Optional query filter — restrict to one CPT anchor.
    formation_id : UUID | None
        Optional query filter — restrict to one formation.
    status : "pending" | "accepted" | "rejected" | None
        Optional query filter — restrict to one layer status.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[LithoLayerResponse]
        Matching layer rows sorted by ``depth_top_m`` ascending;
        empty list for a non-litho model or when no row matches.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``.
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

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model to insert into (path param).
    request : LithoLayerBulkCreateRequest
        Body with the ``layers`` array and an optional ``section_id``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[LithoLayerResponse]
        The freshly-created layer rows.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``, or when a ``formation_id`` in the body is unknown
        or belongs to another project (the use case's scope guard).
    HTTPException(409)
        When the layers would overlap an accepted layer on the same
        investigation column (``litho_layer_overlap``).
    HTTPException(422)
        When any other database constraint rejects the write.
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
    try:
        created = await use_case.execute(model_id, payloads, project_id=project_id)
    except ValueError as err:
        # The application-layer scope guard's contract: an unknown or
        # cross-project formation_id is "not found", deliberately not
        # distinguishing the two so a caller cannot probe another project.
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
    except IntegrityError as err:
        # The deferred no-overlap exclusion (and any other constraint) fires at
        # commit, i.e. after the response would otherwise have been built.
        # Roll back explicitly: the session is poisoned and the seeding call
        # below would fail on it.
        await session.rollback()
        raise litho_layer_write_conflict(
            err,
            overlap_message=(
                "These layers would overlap an accepted layer on the same "
                "investigation. Move the neighbouring boundary first, or delete "
                "the overlapping layer, before creating them."
            ),
        ) from err
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
    """Atomic two-row depth update on the shared boundary.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    request : LithoLayerBoundaryMoveRequest
        Body with ``upper_layer_id``, ``lower_layer_id``, and the
        ``new_depth_m`` for the shared boundary.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerBoundaryMoveResponse
        The updated upper + lower layer rows.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``.
    HTTPException(422)
        When the boundary move is invalid (``BoundaryMoveError``).
    """
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
            model_id=model_id,
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
    """Set the same status on N rows in one transaction (accept-all / reject-all).

    Thin alias over the generic batch update: a batch status transition IS
    a batch update whose every patch is ``{"status": <new_status>}``
    (audit BE-APPLICATION-LITHO-04 — the hand-rolled twin use case with
    identical control flow was merged into ``BatchUpdateLithoLayers``).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    request : LithoLayerBatchStatusRequest
        Body with the ``layer_ids`` list and the target ``status``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerBatchStatusResponse
        The updated-row count and the updated layer rows.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``.
    HTTPException(409)
        When accepting the batch would overlap an accepted layer on the same
        investigation column (``litho_layer_overlap``).
    HTTPException(422)
        When the batch status update is invalid (``BatchUpdateError``), or when
        any other database constraint rejects the write.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = BatchUpdateLithoLayers(session)
    try:
        result = await use_case.execute(
            [(layer_id, {"status": request.status}) for layer_id in request.layer_ids],
            model_id=model_id,
        )
    except BatchUpdateError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except IntegrityError as err:
        # Accept-all promotes rows to 'accepted', which is exactly what the
        # deferred no-overlap exclusion guards — and it fires at the use case's
        # COMMIT, after every validation the batch does itself has passed. Roll
        # back explicitly: the session is poisoned for anything after this.
        await session.rollback()
        raise litho_layer_write_conflict(
            err,
            overlap_message=(
                "One or more of these layers would overlap an accepted layer on "
                "the same investigation. Clear the column or move the neighbouring "
                "boundary before accepting the batch."
            ),
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

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    request : LithoLayerBatchUpdateRequest
        Body with the ``updates`` list; each item carries a
        ``layer_id`` plus the fields to patch (only sent fields apply).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerBatchUpdateResponse
        The updated-row count and the updated layer rows.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``.
    HTTPException(409)
        When the patched depths would overlap an accepted layer on the same
        investigation column (``litho_layer_overlap``).
    HTTPException(422)
        When the batch update is invalid (``BatchUpdateError``), or when any
        other database constraint rejects the write.
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
        result = await use_case.execute(patches, model_id=model_id)
    except BatchUpdateError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except IntegrityError as err:
        # A batch patch can move depths and/or set status='accepted', both of
        # which the deferred no-overlap exclusion guards; it fires at the use
        # case's COMMIT. Same handling as the batch-status sibling above.
        await session.rollback()
        raise litho_layer_write_conflict(
            err,
            overlap_message=(
                "One or more of these layers would overlap an accepted layer on "
                "the same investigation. Clear the column or move the neighbouring "
                "boundary before applying the batch."
            ),
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

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    layer_id : UUID
        The layer to link to its nearest geological contact (path param).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerResponse | None
        The refreshed layer row when a link was made, or ``None`` when no
        geo contact is within tolerance.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``, when the layer does not exist or is not in the
        URL model, or when the link use case reports the row as missing.
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
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    None
        204 No Content on success (idempotent — 204 whether the row
        existed or not).

    Raises
    ------
    HTTPException(404)
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

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    layer_id : UUID
        The layer to update (path param).
    request : LithoLayerUpdateRequest
        Partial body; only fields present are written.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerResponse
        The updated layer row.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to
        ``project_id``, or when the layer does not exist.
    HTTPException(409)
        When the depth edit would overlap an accepted sibling layer on
        the same investigation column (``LithoLayerOverlapError``).
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    patch = request.model_dump(exclude_unset=True)
    use_case = UpdateLithoLayer(session)
    try:
        updated = await use_case.execute(layer_id, patch, model_id=model_id)
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


@router.patch(
    "/models/{model_id}/layers/{layer_id}/composition",
    response_model=LithoLayerResponse,
)
async def edit_layer_composition(
    project_id: UUID,
    model_id: UUID,
    layer_id: UUID,
    request: LithoLayerCompositionRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerOrm:
    """Repoint one accepted layer to a different composition's litho unit.

    "Edit composition" — e.g. turn an accepted SILT into a ZAND without deleting
    it (installer #21 PROD BLOCKER). Resolves the target litho unit with the
    shared find-or-create (reuse the project's unit for that composition, or mint
    a new one), then repoints ``formation_id`` through the existing layer PATCH.
    Depths, anchor and status are unchanged; the instance resolver re-runs so
    body membership tracks the new composition.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    layer_id : UUID
        The layer to recompose (path param).
    request : LithoLayerCompositionRequest
        Body with the target ``litho_main_soil_code`` + ``admixtures``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerResponse
        The updated layer row.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to ``project_id``, or
        when the layer does not exist or is not in the URL model.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    admixtures = tuple(
        Admixture(soil_code=a.soil_code, amount=a.amount, locally=a.locally)
        for a in request.admixtures
    )
    updated = await EditLithoLayerComposition(session).execute(
        project_id=project_id,
        model_id=model_id,
        layer_id=layer_id,
        litho_main_soil_code=request.litho_main_soil_code,
        admixtures=admixtures,
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found",
        )
    return updated


@router.post(
    "/models/{model_id}/layers/{layer_id}/split",
    response_model=LithoLayerSplitResponse,
)
async def split_layer(
    project_id: UUID,
    model_id: UUID,
    layer_id: UUID,
    request: LithoLayerSplitRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoLayerSplitResponse:
    """Split one accepted layer at a depth into two same-composition layers.

    Atomic: the top half keeps the original row (base shrunk to the split
    depth), the bottom half is a fresh accepted row ``[depth, original_base]`` on
    the same anchor + formation, committed in ONE transaction (the deferred
    no-overlap + contiguity constraints forbid a two-request split).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The lithostratigraphic model (path param).
    layer_id : UUID
        The layer to split (path param).
    request : LithoLayerSplitRequest
        Body with the split ``depth_m``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    LithoLayerSplitResponse
        The (shrunk) top layer + the new bottom layer.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to ``project_id``, or
        when the layer does not exist or is not in the URL model.
    HTTPException(422)
        When the split depth would leave either half thinner than the minimum
        thickness, or the commit trips a residual integrity constraint
        (``SplitError``).
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    try:
        result = await SplitLithoLayer(session).execute(
            project_id=project_id,
            model_id=model_id,
            layer_id=layer_id,
            depth_m=request.depth_m,
        )
    except SplitError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found",
        )
    return LithoLayerSplitResponse(
        top=LithoLayerResponse.model_validate(result.top),
        bottom=LithoLayerResponse.model_validate(result.bottom),
    )
