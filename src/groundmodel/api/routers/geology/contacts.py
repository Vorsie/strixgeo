"""Geology API — formation-contact CRUD + batch update.

Split from the former 1,100-line ``geology.py`` monolith (debt #40); the
stratigraphy/litho-suggestion operations moved on to ``litho_ops.py``
(debt #178/#201). Mounted under the shared
``/projects/{project_id}/geology`` prefix by this package's ``__init__``;
paths are unchanged.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    get_in_project_or_404,
)
from groundmodel.api.schemas.project.formation_contact import (
    FormationContactBatchUpdateRequest,
    FormationContactBatchUpdateResponse,
    FormationContactCreateRequest,
    FormationContactResponse,
    FormationContactUpdateRequest,
)
from groundmodel.application.create_formation_contact import (
    CreateFormationContact,
    DuplicateContactError,
)
from groundmodel.application.delete_formation_contact import DeleteFormationContact
from groundmodel.application.update_formation_contact import UpdateFormationContact
from groundmodel.application.update_formation_contacts_batch import (
    UpdateFormationContactsBatch,
)
from groundmodel.domain.value_objects.formation_contact_result import (
    FormationContactResult,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()


# ---------------------------------------------------------------------------
# Formation contacts
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/contacts",
    response_model=FormationContactResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact(
    project_id: UUID,
    model_id: UUID,
    request: FormationContactCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> FormationContactResult:
    """Create a new formation contact under a model.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model — must belong to ``project_id``.
    request : FormationContactCreateRequest
        Body with anchor, formation, depth, and an optional
        ``section_id`` (explicit-content invariant).
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    FormationContactResult
        Snapshot of the created contact row (HTTP 201).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(409)
        When a contact for this (anchor, formation) already exists
        in the model.  The response body carries ``existing_contact_id``
        so the frontend can offer "move" instead of a hard failure.
    HTTPException(400)
        When both anchor fields are set or both are null (XOR violated
        by a non-API caller that bypassed the Pydantic schema check).
    """
    # Guard: model must exist and belong to the project.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    try:
        contact = await CreateFormationContact(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=request.formation_id,
            depth_top_m=request.depth_top_m,
            borehole_id=request.borehole_id,
            cpt_id=request.cpt_id,
            source=request.source,
            confidence=request.confidence,
            observation_id=request.observation_id,
            observation_layer_id=request.observation_layer_id,
            notes=request.notes,
        )
    except DuplicateContactError as err:
        # 409 Conflict + the existing contact id so the frontend can offer
        # "move it here" via PATCH rather than a hard failure.
        #
        # Explicit-content invariant + debt #57: the user explicitly drew
        # on this section, so the SURVIVOR contact (the existing id this
        # dedup resolved to) must appear on it — otherwise the draw yields
        # a 409 and nothing renders, leaving a ghost id out of the seeded
        # set. Seed the survivor's id before raising; the 409 still tells
        # the frontend it was a dedup so it can message "used existing".
        if request.section_id is not None:
            await CrossSectionRepository(session).union_seeded_contact_ids(
                request.section_id,
                project_id,
                {err.existing_contact_id},
                operation="create_contact dedup",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "duplicate_contact",
                "message": (
                    "A contact for this formation already exists on this "
                    "investigation. Drag the existing one to move it, or "
                    "delete it first."
                ),
                "existing_contact_id": str(err.existing_contact_id),
            },
        ) from err
    except ValueError as err:
        # Defence-in-depth ValueError from the repository's XOR check
        # — Pydantic should have already rejected this at the 422
        # boundary, so reaching here means a non-API caller bypassed
        # the request schema.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err

    # Explicit-content invariant (owner directive 2026-05-17): when the user
    # manually draws a contact on a section the editor passes section_id, so
    # the new contact's id joins that section's seeded set (union — re-drawing
    # after an undo keeps the rest of the set). Non-fatal: a seeding failure
    # leaves the set stale but the 201 stands.
    if request.section_id is not None:
        await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            {contact.id},
            operation="create_contact",
        )

    return contact


@router.get(
    "/models/{model_id}/contacts",
    response_model=list[FormationContactResponse],
)
async def list_contacts(
    project_id: UUID,
    model_id: UUID,
    borehole_id: UUID | None = None,
    formation_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[FormationContactOrm]:
    """List contacts in a model, optionally filtered by borehole / formation.

    The ``project_id`` in the URL is a scope guard: we reject if the
    model doesn't belong to the project, preventing trivial id-guessing
    across projects.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model whose contacts are listed.
    borehole_id : UUID | None
        Optional filter — only contacts anchored to this borehole.
    formation_id : UUID | None
        Optional filter — only contacts for this formation.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[FormationContactOrm]
        Matching contact rows (serialised as
        ``list[FormationContactResponse]``).

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to the
        project.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    repo = GeologyRepository(session)
    return await repo.list_contacts(model_id, borehole_id=borehole_id, formation_id=formation_id)


@router.patch(
    "/models/{model_id}/contacts/{contact_id}",
    response_model=FormationContactResponse,
)
async def update_contact(
    project_id: UUID,
    model_id: UUID,
    contact_id: UUID,
    request: FormationContactUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> FormationContactResponse | JSONResponse:
    """Partial update on a contact (depth, formation, anchor, confidence, notes).

    The anchor pair (``borehole_id`` / ``cpt_id``) is updatable so
    the section editor's drag-re-anchor flow works without a
    delete+create round-trip. Anchor updates require BOTH fields in
    the body — the unused side must be explicitly null — so the
    XOR invariant survives partial patches. The schema validator
    rejects malformed shapes with a 422.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model that owns the contact.
    contact_id : UUID
        Contact to update; its ``model_id`` must match the URL.
    request : FormationContactUpdateRequest
        Partial patch; only fields explicitly set in the body are
        applied (``exclude_unset``).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    FormationContactResponse | JSONResponse
        The updated contact snapshot, whose ``deleted_contact_ids`` names any
        peer boundaries a cross-merge deleted (empty on a plain update / a
        drag-up that crossed nothing).  When a drag-down cross-merge absorbed
        the dragger into the formation above, returns HTTP 200 with
        ``{"absorbed": true, "deleted_contact_ids": [...]}`` instead — the
        renderer prunes both the dragger and the named peers at once.

    Raises
    ------
    HTTPException(404)
        When the contact does not belong to the model, the model does
        not belong to the project, or the row vanishes between the
        scope check and the update (TOCTOU race).
    """
    # Two-stage scope guard: the contact's model_id must match the URL,
    # AND the model itself must live in the URL's project. Single 404
    # message either way — we don't leak which boundary the caller hit.
    await get_in_project_or_404(
        session.get(FormationContactOrm, contact_id),
        model_id,
        detail="Contact not found",
        project_attr="model_id",
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Contact not found",
    )
    use_case = UpdateFormationContact(session)
    updated = await use_case.execute(contact_id, request.model_dump(exclude_unset=True))
    # Every id the cross-merge deleted, so the renderer drops the crossed
    # boundaries from the section at once (installer #20 dogfeed 2026-09-06).
    deleted_ids = [str(i) for i in use_case.deleted_contact_ids]
    if updated is None:
        if use_case.absorbed:
            # Drag-down cross-merge: the dragger was absorbed by the formation
            # above.  Return 200 naming the peers the merge deleted — replaces
            # the former bare 204, which forced the renderer to refetch blindly
            # and left the crossed peers on screen (deleting them again 404'd).
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"absorbed": True, "deleted_contact_ids": deleted_ids},
            )
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    # Survivor path (plain update or drag-up cross-merge): attach the deleted
    # peer ids to the response so the renderer prunes them immediately.
    response = FormationContactResponse.model_validate(updated)
    response.deleted_contact_ids = list(use_case.deleted_contact_ids)
    return response


@router.delete(
    "/models/{model_id}/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_contact(
    project_id: UUID,
    model_id: UUID,
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a contact.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model that owns the contact.
    contact_id : UUID
        Contact to delete; its ``model_id`` must match the URL.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    None
        HTTP 204 No Content on success.

    Raises
    ------
    HTTPException(404)
        When the contact does not belong to the model, or the model
        does not belong to the project.
    """
    await get_in_project_or_404(
        session.get(FormationContactOrm, contact_id),
        model_id,
        detail="Contact not found",
        project_attr="model_id",
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Contact not found",
    )
    await DeleteFormationContact(session).execute(
        contact_id,
        project_id=project_id,
        model_id=model_id,
    )


@router.put(
    "/models/{model_id}/contacts/batch",
    response_model=FormationContactBatchUpdateResponse,
)
async def update_contacts_batch(
    project_id: UUID,
    model_id: UUID,
    request: FormationContactBatchUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> FormationContactBatchUpdateResponse:
    """All-or-nothing batch PATCH for N contacts.

    The section editor's multi-drag flow ships every selected
    contact's new (depth_top_m, anchor) in one call so a partial
    failure can't strand half the selection mid-move. The use case
    validates every entry's scope before mutating; any miss returns
    404 without touching the DB. On success, one commit covers the
    whole list and the response returns the updated rows in input
    order so the client can patch its local state by index.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model that owns every contact in the batch.
    request : FormationContactBatchUpdateRequest
        Body carrying the list of per-contact updates (each entry a
        ``contact_id`` plus its patch fields).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    FormationContactBatchUpdateResponse
        The updated contact rows in input order.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project, or any contact
        in the batch is not found in this model (all-or-nothing — no
        rows are mutated).
    """
    # Model scope guard up front — the use case re-checks per-contact
    # but failing on a wrong model_id here gives a cleaner error
    # message and skips an unnecessary DB read.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    entries = [
        (
            entry.contact_id,
            entry.model_dump(exclude={"contact_id"}, exclude_unset=True),
        )
        for entry in request.updates
    ]

    updated = await UpdateFormationContactsBatch(session).execute(model_id, entries)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more contacts not found in this model",
        )
    return FormationContactBatchUpdateResponse(
        contacts=[FormationContactResponse.model_validate(c) for c in updated]
    )
