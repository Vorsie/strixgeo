"""Geology API routes — formations, models, formation contacts, validation.

The full REST surface the desktop client (and any future automation)
uses to read and write a project's geological model. All routes are
project-scoped (``/projects/{project_id}/geology/...``) so the URL
itself carries the access scope.

Mounted by ``api/main.py`` alongside the existing routers.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.formation_contact import (
    AutoPopulateFromStratigraphyRequest,
    AutoPopulateFromStratigraphyResponse,
    DeduplicateContactsResponse,
    FormationContactBatchUpdateRequest,
    FormationContactBatchUpdateResponse,
    FormationContactCreateRequest,
    FormationContactResponse,
    FormationContactUpdateRequest,
    FormationSurfaceResponse,
    GapIssueResponse,
    GapValidationResponse,
    RebuildSurfacesResponse,
)
from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationCreateRequest,
    GeologicalFormationResponse,
    GeologicalFormationUpdateRequest,
)
from groundmodel.api.schemas.project.geological_model import (
    GeologicalModelCreateRequest,
    GeologicalModelResponse,
    GeologicalModelUpdateRequest,
)
from groundmodel.api.schemas.project.geotechnical_unit import (
    GeotechnicalUnitCreateRequest,
    GeotechnicalUnitResponse,
    GeotechnicalUnitUpdateRequest,
)
from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    AutoPopulateContactsFromStratigraphy,
)
from groundmodel.application.create_formation_contact import (
    CreateFormationContact,
    DuplicateContactError,
)
from groundmodel.application.deduplicate_formation_contacts import (
    DeduplicateFormationContacts,
)
from groundmodel.application.delete_formation_contact import DeleteFormationContact
from groundmodel.application.rebuild_model_surfaces import RebuildModelSurfaces
from groundmodel.application.update_formation_contact import UpdateFormationContact
from groundmodel.application.update_formation_contacts_batch import (
    UpdateFormationContactsBatch,
)
from groundmodel.application.validate_borehole_stratigraphy import (
    ValidateBoreholeStratigraphy,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.geotechnical_unit_orm import (
    GeotechnicalUnitOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/geology", tags=["geology"])


# ---------------------------------------------------------------------------
# Formations
# ---------------------------------------------------------------------------


@router.post(
    "/formations",
    response_model=GeologicalFormationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_formation(
    project_id: UUID,
    request: GeologicalFormationCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalFormationOrm:
    """Create a new formation under the given project."""
    repo = GeologyRepository(session)
    formation = await repo.create_formation(
        project_id,
        name=request.name,
        color=request.color,
        code=request.code,
        display_order=request.display_order,
        regional_ref=request.regional_ref,
        description=request.description,
    )
    await session.commit()
    await session.refresh(formation)
    return formation


@router.get("/formations", response_model=list[GeologicalFormationResponse])
async def list_formations(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeologicalFormationOrm]:
    """List all formations defined for a project."""
    repo = GeologyRepository(session)
    return await repo.list_formations(project_id)


@router.patch(
    "/formations/{formation_id}",
    response_model=GeologicalFormationResponse,
)
async def update_formation(
    project_id: UUID,
    formation_id: UUID,
    request: GeologicalFormationUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalFormationOrm:
    """Partial update on a formation. Only fields present in the body are written."""
    repo = GeologyRepository(session)
    # Scope-check pre-update so a leaked id from another project doesn't
    # mutate a row this caller has no business touching.
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    # exclude_unset so omitted fields stay untouched and explicit null
    # only clears optional columns.
    patch = request.model_dump(exclude_unset=True)
    formation = await repo.update_formation(formation_id, patch)
    if formation is None:
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Formation not found")
    await session.commit()
    await session.refresh(formation)
    return formation


@router.delete("/formations/{formation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_formation(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a formation. Cascades to every contact that referenced it."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    await repo.delete_formation(formation_id)
    await session.commit()


# ---------------------------------------------------------------------------
# Geotechnical units — formation subdivision (structure only in v1)
# ---------------------------------------------------------------------------


@router.post(
    "/formations/{formation_id}/units",
    response_model=GeotechnicalUnitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_unit(
    project_id: UUID,
    formation_id: UUID,
    request: GeotechnicalUnitCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechnicalUnitOrm:
    """Create a new geotechnical unit under a formation.

    Scope guard: the formation must exist and belong to the URL's
    project. The unit's ``app_project_id`` is sourced from the parent
    formation (denormalised onto the row), not the URL — same data,
    one source of truth.
    """
    repo = GeologyRepository(session)
    formation = await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    unit = await repo.create_unit(
        app_project_id=formation.app_project_id,
        geological_formation_id=formation_id,
        name=request.name,
        color=request.color,
        code=request.code,
        display_order=request.display_order,
        description=request.description,
    )
    await session.commit()
    await session.refresh(unit)
    return unit


@router.get(
    "/formations/{formation_id}/units",
    response_model=list[GeotechnicalUnitResponse],
)
async def list_units(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeotechnicalUnitOrm]:
    """List the geotechnical units under one formation."""
    repo = GeologyRepository(session)
    # Scope-check the formation; a missing formation 404s rather than
    # silently returning an empty list under a wrong-project guess.
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    return await repo.list_units(geological_formation_id=formation_id)


@router.patch(
    "/formations/{formation_id}/units/{unit_id}",
    response_model=GeotechnicalUnitResponse,
)
async def update_unit(
    project_id: UUID,
    formation_id: UUID,
    unit_id: UUID,
    request: GeotechnicalUnitUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechnicalUnitOrm:
    """Partial update on a unit. Only fields present in the body are written."""
    repo = GeologyRepository(session)
    # Two-stage scope guard: the unit must point at this formation,
    # AND the formation must live in this project. Single 404 message
    # either way — we don't leak which boundary the caller hit.
    await get_in_project_or_404(
        repo.get_unit(unit_id),
        formation_id,
        detail="Unit not found",
        project_attr="geological_formation_id",
    )
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Unit not found"
    )
    patch = request.model_dump(exclude_unset=True)
    updated = await repo.update_unit(unit_id, patch)
    if updated is None:
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found")
    await session.commit()
    await session.refresh(updated)
    return updated


@router.delete(
    "/formations/{formation_id}/units/{unit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_unit(
    project_id: UUID,
    formation_id: UUID,
    unit_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a geotechnical unit."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_unit(unit_id),
        formation_id,
        detail="Unit not found",
        project_attr="geological_formation_id",
    )
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Unit not found"
    )
    await repo.delete_unit(unit_id)
    await session.commit()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


@router.post(
    "/models",
    response_model=GeologicalModelResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_model(
    project_id: UUID,
    request: GeologicalModelCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalModelOrm:
    """Create a new geological model under the given project."""
    repo = GeologyRepository(session)
    model = await repo.create_model(
        project_id,
        name=request.name,
        description=request.description,
        is_active=request.is_active,
        excluded_borehole_ids=request.excluded_borehole_ids,
    )
    await session.commit()
    await session.refresh(model)
    return model


@router.get("/models", response_model=list[GeologicalModelResponse])
async def list_models(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeologicalModelOrm]:
    """List all geological models for a project, active first."""
    repo = GeologyRepository(session)
    return await repo.list_models(project_id)


@router.patch("/models/{model_id}", response_model=GeologicalModelResponse)
async def update_model(
    project_id: UUID,
    model_id: UUID,
    request: GeologicalModelUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalModelOrm:
    """Partial update on a model. ``is_active`` lives on its own activate endpoint."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    patch = request.model_dump(exclude_unset=True)
    model = await repo.update_model(model_id, patch)
    if model is None:
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    await session.commit()
    await session.refresh(model)
    return model


@router.post("/models/{model_id}/activate", response_model=GeologicalModelResponse)
async def activate_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> GeologicalModelOrm:
    """Mark this model active; clear ``is_active`` on every sibling in the project."""
    repo = GeologyRepository(session)
    model = await repo.set_active_model(project_id, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    await session.commit()
    await session.refresh(model)
    return model


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a model. Cascades to every contact under it."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    await repo.delete_model(model_id)
    await session.commit()


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
) -> FormationContactOrm:
    """Create a new formation contact under a model."""
    # Guard: model must exist and belong to the project.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    try:
        return await CreateFormationContact(session).execute(
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
        # 409 Conflict + the existing contact id in the response body
        # so the frontend can surface "an X contact already exists on
        # this borehole" and offer a "move it here" action via PATCH
        # rather than asking the user to manually find + delete the
        # duplicate.
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
) -> FormationContactOrm:
    """Partial update on a contact (depth, formation, anchor, confidence, notes).

    The anchor pair (``borehole_id`` / ``cpt_id``) is updatable so
    the section editor's drag-re-anchor flow works without a
    delete+create round-trip. Anchor updates require BOTH fields in
    the body — the unused side must be explicitly null — so the
    XOR invariant survives partial patches. The schema validator
    rejects malformed shapes with a 422.
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
    updated = await UpdateFormationContact(session).execute(
        contact_id, request.model_dump(exclude_unset=True)
    )
    if updated is None:
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    return updated


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
    """Delete a contact."""
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
    await DeleteFormationContact(session).execute(contact_id)


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


@router.post(
    "/models/{model_id}/contacts/auto-populate",
    response_model=AutoPopulateFromStratigraphyResponse,
)
async def auto_populate_from_stratigraphy(
    project_id: UUID,
    model_id: UUID,
    request: AutoPopulateFromStratigraphyRequest,
    session: AsyncSession = Depends(get_session),
) -> AutoPopulateFromStratigraphyResponse:
    """Seed the model with contacts derived from borehole stratigraphy.

    Caller passes the borehole id list (typically the boreholes
    projected onto the active cross-section). For each borehole the
    use case prefers FORMAL_STRATIGRAPHY and falls through to
    INFORMAL_STRATIGRAPHY only when no formal observation exists.
    Layers are idempotent via ``observation_layer_id``; re-running
    is a no-op. Auto-creates missing formations using the layer
    description as the name + a hash-derived default colour.
    """
    # Model scope guard up-front — same shape as the batch update
    # endpoint. Per-borehole project membership is also re-checked
    # by the use case's IN-query so a hand-crafted payload with an
    # out-of-project borehole id can't seed a contact.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
        project_id=project_id,
        model_id=model_id,
        borehole_ids=request.borehole_ids,
    )
    return AutoPopulateFromStratigraphyResponse(
        created_contact_ids=outcome.created_contact_ids,
        created_formation_ids=outcome.created_formation_ids,
        skipped_existing=outcome.skipped_existing,
        skipped_unmatched=outcome.skipped_unmatched,
        skipped_no_stratigraphy=outcome.skipped_no_stratigraphy,
    )


@router.post(
    "/models/{model_id}/contacts/dedupe",
    response_model=DeduplicateContactsResponse,
)
async def dedupe_existing_contacts(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> DeduplicateContactsResponse:
    """One-shot cleanup for legacy duplicate (anchor, formation) contacts.

    Walks every (model, anchor, formation) group with N>1 contacts
    and deletes all but the highest-priority survivor. Survivor
    rule (in order): manual_pick beats auto-derived; rows with
    observation_layer_id beat rows without; most recent created_at
    breaks remaining ties.

    Idempotent — running on a clean model is a no-op. Used to clean
    up duplicates created before the per-(model, anchor, formation)
    uniqueness rule landed.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    outcome = await DeduplicateFormationContacts(session).execute(model_id)
    return DeduplicateContactsResponse(
        inspected_groups=outcome.inspected_groups,
        duplicates_removed=outcome.duplicates_removed,
        removed_contact_ids=outcome.removed_contact_ids,
    )


@router.post(
    "/models/{model_id}/surfaces/rebuild",
    response_model=RebuildSurfacesResponse,
)
async def rebuild_model_surfaces(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> RebuildSurfacesResponse:
    """Manual escape hatch — force-recompute every formation's TIN cache.

    The auto-recompute hooks attached to every contact-mutating use
    case keep the cache fresh on the happy path. Click this when
    that path was bypassed (anchor elevation edited without a
    contact mutation, bundle restored, suspected stale checksum).
    Idempotent — running on a clean model returns
    ``formations_rebuilt=0``.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    outcome = await RebuildModelSurfaces(session).execute(model_id)
    return RebuildSurfacesResponse(
        formations_considered=outcome.formations_considered,
        formations_rebuilt=outcome.formations_rebuilt,
    )


@router.get(
    "/models/{model_id}/surfaces",
    response_model=list[FormationSurfaceResponse],
)
async def list_model_surfaces(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[FormationSurfaceResponse]:
    """Return every cached TIN surface in this model.

    The section-view consumer fetches this once on section load,
    indexes by formation_id, and slices each surface against the
    section line for off-line-pick-aware polylines.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    repo = GeologyRepository(session)
    rows = await repo.list_surfaces(model_id)
    return [FormationSurfaceResponse.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# No-gaps validation
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/boreholes/{borehole_id}/validate",
    response_model=GapValidationResponse,
)
async def validate_no_gaps(
    project_id: UUID,
    model_id: UUID,
    borehole_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> GapValidationResponse:
    """Check that a borehole's formation contacts form a clean stratigraphy.

    Returns the list of issues found (empty list ⇒ all good). The
    editor calls this on save; the response surfaces as inline warnings
    in the section view.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    issues = await ValidateBoreholeStratigraphy(session).execute(model_id, borehole_id)
    return GapValidationResponse(
        model_id=model_id,
        borehole_id=borehole_id,
        issues=[
            GapIssueResponse(
                kind=i.kind,
                detail=i.detail,
                depth_m=i.depth_m,
                contact_ids=list(i.contact_ids),
            )
            for i in issues
        ],
    )
