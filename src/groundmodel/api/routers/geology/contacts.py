"""Geology API — formation-contact CRUD, batch, auto-populate, dedupe.

Split from the former 1,100-line ``geology.py`` monolith (debt
#40). Mounted under the shared ``/projects/{project_id}/geology``
prefix by this package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.formation_contact import (
    AutoPopulateFromStratigraphyRequest,
    AutoPopulateFromStratigraphyResponse,
    ClearLithoModelResponse,
    DeduplicateContactsResponse,
    DiscoverFromStratigraphyRequest,
    DiscoverFromStratigraphyResponse,
    FormationCandidateItem,
    FormationContactBatchUpdateRequest,
    FormationContactBatchUpdateResponse,
    FormationContactCreateRequest,
    FormationContactResponse,
    FormationContactUpdateRequest,
    LumpingCollisionItem,
    PinchOutExtrapolationRequest,
    PinchOutExtrapolationResponse,
    SeedLithoFromParentRequest,
    SeedLithoFromParentResponse,
)
from groundmodel.api.schemas.project.litho_suggestion import (
    AcceptLithoSuggestionsRequest,
    AcceptLithoSuggestionsResponse,
    LithoLayerSuggestionItem,
    LithoSuggestionRequest,
    LithoSuggestionResponse,
)
from groundmodel.application.accept_litho_suggestions import AcceptLithoSuggestions
from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    AutoPopulateContactsFromStratigraphy,
    build_formal_informal_bridge,
)
from groundmodel.application.clear_litho_model import ClearLithoModel
from groundmodel.application.create_formation_contact import (
    CreateFormationContact,
    DuplicateContactError,
)
from groundmodel.application.deduplicate_formation_contacts import (
    DeduplicateFormationContacts,
)
from groundmodel.application.delete_formation_contact import DeleteFormationContact
from groundmodel.application.discover_formations_from_stratigraphy import (
    DiscoverFormationsFromStratigraphy,
)
from groundmodel.application.extrapolate_pinch_out import ExtrapolatePinchOut
from groundmodel.application.seed_litho_from_geological_model import (
    SeedLithoFromGeologicalModel,
)
from groundmodel.application.suggest_litho_contacts import (
    InvalidModelKindError,
    InvestigationNotFoundError,
    SuggestLithoContacts,
)
from groundmodel.application.update_formation_contact import UpdateFormationContact
from groundmodel.application.update_formation_contacts_batch import (
    UpdateFormationContactsBatch,
)
from groundmodel.domain.services.litho_segmentation import LithoLayerSuggestion
from groundmodel.domain.value_objects.admixture import Admixture
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
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence
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
) -> FormationContactOrm:
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
    FormationContactOrm
        The created contact row (HTTP 201).

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
    is a no-op. When ``create_missing_formations`` is true (the
    Fill-from-boreholes default) an unmatched layer mints a formation
    from its description + a hash-derived colour; when false (the
    Sections "Seed from stratigraphy" path) it is skipped and counted
    in ``skipped_not_in_model`` — Seed never creates formations
    (CLAUDE.md explicit-content invariant).
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

    # Compute the formal↔informal bridge once per request so discover≡apply≡seed holds.
    # build_formal_informal_bridge is a read-only SELECT over the project's boreholes;
    # it returns {} when no dual-stream borehole exists (Decision 1, 2026-05-18).
    bridge = await build_formal_informal_bridge(session, project_id=project_id)
    outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
        project_id=project_id,
        model_id=model_id,
        borehole_ids=request.borehole_ids,
        selected_keys=request.selected_keys,
        manual_map=request.manual_map,
        section_id=request.section_id,
        bridge=bridge or None,
        create_missing_formations=request.create_missing_formations,
    )

    # Explicit-content invariant (owner directive 2026-05-17):
    # when a section_id was provided (the "Seed from stratigraphy" path),
    # PATCH the section's seeded_formation_contact_ids = union(existing ∪
    # newly-created ∪ pre-existing-found) so formation content is gated
    # correctly on the next BuildSectionSnapshot call.
    #
    # The use case already committed its own transaction (contacts + stale
    # flags). The section PATCH runs in the same session but as a separate
    # flush/commit so the two operations remain independent and the section
    # commit doesn't interleave with contact creation.
    updated_section_response: CrossSectionResponse | None = None
    if request.section_id is not None:
        new_ids = frozenset(outcome.created_contact_ids) | frozenset(outcome.found_contact_ids)
        updated = await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            set(new_ids),
            operation="Seed",
        )
        if updated is not None:
            # Echo the patched section back so the frontend updates its
            # local copy in this one round-trip (no follow-up GET).
            updated_section_response = CrossSectionResponse.model_validate(updated)

    return AutoPopulateFromStratigraphyResponse(
        created_contact_ids=outcome.created_contact_ids,
        created_formation_ids=outcome.created_formation_ids,
        deleted_formation_ids=outcome.deleted_formation_ids,
        skipped_existing=outcome.skipped_existing,
        skipped_unmatched=outcome.skipped_unmatched,
        skipped_no_stratigraphy=outcome.skipped_no_stratigraphy,
        skipped_not_in_model=outcome.skipped_not_in_model,
        collisions=[
            LumpingCollisionItem(
                borehole_id=col.borehole_id,
                target_formation_key=col.target_formation_key,
                target_formation_name=col.target_formation_name,
                colliding_raw_names=col.colliding_raw_names,
                kept_top_m=col.kept_top_m,
                dropped_count=col.dropped_count,
            )
            for col in outcome.collisions
        ],
        updated_section=updated_section_response,
    )


@router.post(
    "/models/{model_id}/contacts/discover-from-stratigraphy",
    response_model=DiscoverFromStratigraphyResponse,
)
async def discover_from_stratigraphy(
    project_id: UUID,
    model_id: UUID,
    request: DiscoverFromStratigraphyRequest,
    session: AsyncSession = Depends(get_session),
) -> DiscoverFromStratigraphyResponse:
    """Return candidate formation names from borehole stratigraphy — read-only.

    Runs the same FORMAL_STRATIGRAPHY-preferred / INFORMAL_STRATIGRAPHY-
    fallback / surface-layers-skipped scan as the auto-populate endpoint but
    commits nothing.  The result feeds ``FormationSelectionDialog`` so the
    user can curate which formations to keep before any mutation fires.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model — must belong to ``project_id``.  Required so the
        scope guard is consistent with sibling contact endpoints even though
        this endpoint does not write to the model.
    request : DiscoverFromStratigraphyRequest
        Body with ``borehole_ids`` list (1..500).

    Returns
    -------
    DiscoverFromStratigraphyResponse
        ``candidates`` list sorted by ``borehole_count`` descending then
        ``name`` ascending.  Empty list when no borehole carries stratigraphy.
        Always 200 — the endpoint never errors on empty results.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}"
        f"/contacts/discover-from-stratigraphy borehole_ids={len(request.borehole_ids)}"
    )
    # Model scope guard — prevents leaking candidate names across projects
    # via a hand-crafted payload with an out-of-project model_id.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    # Compute the formal↔informal bridge once per request (same as apply path)
    # so the discover preview and the write path see identical effective keys.
    bridge = await build_formal_informal_bridge(session, project_id=project_id)
    candidates, collisions = await DiscoverFormationsFromStratigraphy(session).execute(
        project_id=project_id,
        borehole_ids=request.borehole_ids,
        manual_map=request.manual_map,
        bridge=bridge or None,
    )
    logger.info(
        f"discover-from-stratigraphy done: {len(candidates)} candidate(s), "
        f"{len(collisions)} collision(s) for model={model_id}"
    )
    return DiscoverFromStratigraphyResponse(
        candidates=[
            FormationCandidateItem(
                name=c.name,
                regional_ref=c.regional_ref,
                key=c.key,
                borehole_count=c.borehole_count,
            )
            for c in candidates
        ],
        collisions=[
            LumpingCollisionItem(
                borehole_id=col.borehole_id,
                target_formation_key=col.target_formation_key,
                target_formation_name=col.target_formation_name,
                colliding_raw_names=col.colliding_raw_names,
                kept_top_m=col.kept_top_m,
                dropped_count=col.dropped_count,
            )
            for col in collisions
        ],
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


@router.delete(
    "/models/{model_id}/contacts",
    response_model=ClearLithoModelResponse,
    status_code=status.HTTP_200_OK,
)
async def clear_litho_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ClearLithoModelResponse:
    """Clear ALL content from a lithostratigraphic model in one atomic call.

    Extends debt #94 — the original "wipe contacts" only removed
    ``FormationContact`` rows, leaving litho formation rows, correlation
    edges, and TIN surfaces behind.  After the old wipe the inspector still
    showed every litho unit and the wipe-pill disappeared (gated on
    ``lithoContacts.length > 0``), leaving the user with orphan units and
    no affordance to clear them.

    This endpoint removes, in a single transaction, all of:

    * ``FormationContact`` rows for the model.
    * ``LithoCorrelationEdge`` rows for the model.
    * ``FormationSurface`` rows for the model.
    * Litho ``GeologicalFormation`` rows (``litho_main_soil_code IS NOT NULL``)
      that become orphans after the contact delete — i.e. formations that
      have no remaining contacts in any other model.  Formations shared with
      a second litho model are preserved.

    Geological formations and the lithostratigraphic model row itself are
    never touched.  After a successful clear the model is empty and ready
    for a fresh "Suggest litho" pass.

    The operation is irreversible; the caller MUST present a confirmation
    dialog before invoking this endpoint.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — model must belong to this project.
    model_id : UUID
        Lithostratigraphic model whose content is cleared.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    ClearLithoModelResponse
        ``{ contacts, edges, surfaces, formations }`` — per-table deletion
        counts.  All zero when the model was already empty (idempotent
        no-op).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(
        f"DELETE /projects/{project_id}/geology/models/{model_id}/contacts (clear-litho-model)"
    )
    # Model scope guard — same pattern as every sibling contact endpoint.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    result = await ClearLithoModel(session).execute(project_id, model_id)
    await session.commit()
    logger.info(
        f"clear_litho_model ok model_id={model_id} "
        f"contacts={result.contacts} edges={result.edges} "
        f"surfaces={result.surfaces} formations={result.formations}"
    )
    return ClearLithoModelResponse(
        contacts=result.contacts,
        edges=result.edges,
        surfaces=result.surfaces,
        formations=result.formations,
    )


@router.post(
    "/models/{model_id}/contacts/seed-from-parent",
    response_model=SeedLithoFromParentResponse,
)
async def seed_litho_from_parent(
    project_id: UUID,
    model_id: UUID,
    request: SeedLithoFromParentRequest,
    session: AsyncSession = Depends(get_session),
) -> SeedLithoFromParentResponse:
    """Copy the parent geological model's contacts into a lithostratigraphic model.

    Called from the Sections editor's "Seed from geology" button (litho axis).
    The model must be ``kind='lithostratigraphic'`` with a non-null
    ``parent_geological_model_id``; any other shape returns 422. Only
    borehole-anchored contacts are copied; the copy carries
    ``source='geological_model_seed'`` and ``confidence='medium'``.
    Re-running is idempotent: existing (formation, borehole) pairs in the
    litho model are skipped and counted in ``skipped_existing``.

    When ``section_id`` is provided, unions
    ``created_contact_ids ∪ found_contact_ids`` and PATCHes the section's
    ``seeded_formation_contact_ids`` (explicit-content invariant) — same
    contract as the existing auto-populate Seed path.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Lithostratigraphic model to seed — must belong to ``project_id``.
    request : SeedLithoFromParentRequest
        Body with ``borehole_ids`` list and optional ``section_id``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    SeedLithoFromParentResponse
        Created contact ids, skipped count, and optionally the updated
        section row.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='lithostratigraphic'`` or has no
        ``parent_geological_model_id``.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}"
        f"/contacts/seed-from-parent borehole_ids={len(request.borehole_ids)}"
        + (f" section_id={request.section_id}" if request.section_id else "")
    )
    # Model scope guard — prevents tampering across projects.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    try:
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=project_id,
            model_id=model_id,
            # Pass the list through verbatim. An empty list means "no
            # boreholes in scope → create nothing" (the documented schema
            # contract); coercing [] → None would silently seed the ENTIRE
            # parent model across every project borehole — an over-seed bug.
            borehole_ids=request.borehole_ids,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": str(exc),
            },
        ) from exc

    # Explicit-content invariant (owner directive 2026-05-17): when a
    # section_id is provided, union created ∪ found contact ids and PATCH the
    # section's seeded_formation_contact_ids — identical contract to the
    # existing auto-populate Seed path (debt #57).
    updated_section_response: CrossSectionResponse | None = None
    if request.section_id is not None:
        seed_ids = frozenset(outcome.created_contact_ids) | frozenset(outcome.found_contact_ids)
        updated = await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            set(seed_ids),
            operation="LithoSeed",
        )
        if updated is not None:
            updated_section_response = CrossSectionResponse.model_validate(updated)

    return SeedLithoFromParentResponse(
        created_contact_ids=outcome.created_contact_ids,
        skipped_existing=outcome.skipped_existing,
        updated_section=updated_section_response,
    )


@router.post(
    "/models/{model_id}/contacts/suggest-litho",
    response_model=LithoSuggestionResponse,
)
async def suggest_litho_contacts(
    project_id: UUID,
    model_id: UUID,
    request: LithoSuggestionRequest,
    session: AsyncSession = Depends(get_session),
) -> LithoSuggestionResponse:
    """Suggest lithostratigraphic layer contacts for one CPT or borehole.

    Read-only — returns a ranked list of suggested layer intervals
    derived from Robertson 2015/2009 SBT segmentation (CPT) or DOV
    hoofdnaam→lithology mapping (borehole).  Nothing is written; the
    user accepts suggestions via the normal contact-create flow.

    The model must have ``kind='lithostratigraphic'``; any other kind
    returns 422. The target investigation must exist and have usable
    series data; a missing investigation returns 404.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Lithostratigraphic model to target.
    request : LithoSuggestionRequest
        Body with exactly one of ``cpt_id`` / ``borehole_id`` plus
        optional segmenter tuning parameters.

    Returns
    -------
    LithoSuggestionResponse
        ``layers`` list ordered top to bottom; empty list when no
        layers can be resolved (undefined data, sub-threshold series).

    Raises
    ------
    HTTPException(422)
        When the model is not ``kind='lithostratigraphic'``.
    HTTPException(404)
        When the model does not belong to the project, or the
        investigation does not exist / has no usable data.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    use_case = SuggestLithoContacts(session)
    try:
        if request.cpt_id is not None:
            layers = await use_case.execute_for_cpt(
                model_id=model_id,
                cpt_id=request.cpt_id,
                minimum_layer_thickness_m=request.minimum_layer_thickness_m,
                gunsat_kNm3=request.gunsat_kNm3,
                gwater_kNm3=request.gwater_kNm3,
                dr_compression_factor=request.dr_compression_factor,
            )
            investigation_type = "cpt"
        else:
            layers = await use_case.execute_for_borehole(
                model_id=model_id,
                borehole_id=request.borehole_id,  # type: ignore[arg-type]
                minimum_layer_thickness_m=request.minimum_layer_thickness_m,
            )
            investigation_type = "borehole"
    except InvalidModelKindError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": str(exc),
                "actual_kind": exc.actual_kind,
            },
        ) from exc
    except InvestigationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    from groundmodel.api.schemas.project.litho_suggestion.litho_layer_suggestion_item import (
        AdmixtureItem,
    )

    return LithoSuggestionResponse(
        investigation_type=investigation_type,
        minimum_layer_thickness_m=request.minimum_layer_thickness_m,
        layers=[
            LithoLayerSuggestionItem(
                depth_top_m=lyr.depth_top_m,
                depth_base_m=lyr.depth_base_m,
                suggested_lithology=lyr.suggested_lithology,
                suggested_nad_class=lyr.suggested_nad_class,
                mean_qc_mpa=lyr.mean_qc_mpa,
                dr_pct=lyr.dr_pct,
                confidence=lyr.confidence,
                source=lyr.source,
                # Phase 1: surface admixtures from borehole path.
                # CPT path always produces an empty tuple.
                # parent_formation_id + spans_boundary are resolved at Accept
                # time (straddle detection runs in AcceptLithoSuggestions);
                # the suggest endpoint leaves them at their safe defaults.
                suggested_admixtures=[
                    AdmixtureItem(
                        soil_code=adm.soil_code,
                        amount=adm.amount,
                        locally=adm.locally,
                    )
                    for adm in lyr.suggested_admixtures
                ],
            )
            for lyr in layers
        ],
    )


@router.post(
    "/models/{model_id}/contacts/accept-litho-suggestions",
    response_model=AcceptLithoSuggestionsResponse,
    status_code=status.HTTP_200_OK,
)
async def accept_litho_suggestions(
    project_id: UUID,
    model_id: UUID,
    request: AcceptLithoSuggestionsRequest,
    session: AsyncSession = Depends(get_session),
) -> AcceptLithoSuggestionsResponse:
    """Bulk-accept litho suggestions, committing formations + contacts.

    Converts the caller-provided suggestion list into committed
    ``GeologicalFormation`` (litho unit) rows + ``FormationContact`` rows in
    the lithostratigraphic model.  The operation is bulk + idempotent:
    re-accepting the same suggestions for the same investigation is a
    read-heavy no-op (find-or-create key matches → existing rows returned).

    Suggestions whose depth interval spans a geological-formation boundary
    are automatically split into two contacts — one per parent formation —
    using the parent model's cached TIN surfaces to locate the boundary.
    When the TIN is stale/absent the boundary is approximated from
    depth-ordered contacts on the investigation (``stale_tin_fallback_count``
    in the response; rebuild the geological model to improve precision).

    When ``section_id`` is provided, all created + found contact ids are
    unioned into the section's ``seeded_formation_contact_ids`` so they
    appear on the section immediately (explicit-content invariant). The caller
    must forward ``updated_section`` via ``applyUpdatedSection``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Lithostratigraphic model — must be ``kind='lithostratigraphic'`` and
        belong to ``project_id``.
    request : AcceptLithoSuggestionsRequest
        Body with one anchor (``cpt_id`` XOR ``borehole_id``), optional
        ``section_id``, and the suggestion list.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    AcceptLithoSuggestionsResponse
        Created/found formation + contact ids, straddle statistics, and
        optionally the updated section.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='lithostratigraphic'``.
    """
    # One scoped fetch — get_in_project_or_404 returns the row (non-None,
    # project-matched) so the kind guard reuses it instead of a second
    # session.get (review B2).
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    if model.kind != "lithostratigraphic":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": (
                    f"Model {model_id} has kind='{model.kind}'; "
                    "accept-litho-suggestions requires kind='lithostratigraphic'"
                ),
            },
        )

    # Convert API suggestion items back to domain objects so the use case
    # can operate on typed data rather than raw dicts.
    domain_suggestions: list[LithoLayerSuggestion] = []
    for item in request.suggestions:
        admixtures = tuple(
            Admixture(
                soil_code=adm.soil_code,
                amount=adm.amount,
                locally=adm.locally,
            )
            for adm in item.suggested_admixtures
        )
        domain_suggestions.append(
            LithoLayerSuggestion(
                depth_top_m=item.depth_top_m,
                depth_base_m=item.depth_base_m,
                suggested_lithology=item.suggested_lithology,
                suggested_nad_class=item.suggested_nad_class,
                mean_qc_mpa=item.mean_qc_mpa,
                dr_pct=item.dr_pct,
                confidence=SuggestionConfidence(item.confidence.value),
                source=item.source,
                suggested_admixtures=admixtures,
            )
        )

    try:
        result = await AcceptLithoSuggestions(session).execute(
            project_id=project_id,
            litho_model_id=model_id,
            suggestions=domain_suggestions,
            cpt_id=request.cpt_id,
            borehole_id=request.borehole_id,
            section_id=request.section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "accept_litho_error", "message": str(exc)},
        ) from exc

    # Explicit-content invariant: seed section after the use case committed.
    updated_section_response = None
    if request.section_id is not None:
        all_contact_ids = set(result.created_contact_ids) | set(result.found_contact_ids)
        updated = await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            all_contact_ids,
            operation="AcceptLithoSuggestions",
        )
        if updated is not None:
            updated_section_response = CrossSectionResponse.model_validate(updated)

    return AcceptLithoSuggestionsResponse(
        created_formation_ids=result.created_formation_ids,
        found_formation_ids=result.found_formation_ids,
        created_contact_ids=result.created_contact_ids,
        found_contact_ids=result.found_contact_ids,
        straddle_split_count=result.straddle_split_count,
        stale_tin_fallback_count=result.stale_tin_fallback_count,
        extrapolated_formation_ids=result.extrapolated_formation_ids,
        orphan_formation_ids=result.orphan_formation_ids,
        updated_section=updated_section_response,
    )


@router.post(
    "/models/{model_id}/contacts/pinch-out",
    response_model=PinchOutExtrapolationResponse,
    status_code=status.HTTP_200_OK,
)
async def extrapolate_pinch_out(
    project_id: UUID,
    model_id: UUID,
    request: PinchOutExtrapolationRequest,
    session: AsyncSession = Depends(get_session),
) -> PinchOutExtrapolationResponse:
    """Commit synthetic contacts at a formation's pinch-out tip.

    When a formation pinches out laterally (field jargon: "wigs out"),
    this endpoint extrapolates the formation's top along its local dip
    until it meets the next-deeper formation's top (thickness → 0) and
    commits two provenance-tagged synthetic contacts so the 3D TIN /
    DXF / Plaxis / .gmproj all wedge consistently.

    Two contacts are created rather than one so that the Delaunay
    triangulation in ``compute_tin`` can form a non-degenerate wedge
    triangle: a single point on the section line may be collinear with
    existing contacts and produce a zero-volume wedge. The second
    contact is offset ``offset_m`` perpendicular to the section line —
    geologically negligible (1 m default) but guaranteed to break the
    collinearity.

    Both contacts carry ``source='pinch_out_extrapolation'`` and
    ``confidence='low'`` and are immediately added to the section's
    ``seeded_formation_contact_ids`` (explicit-content invariant).

    The affected formation's TIN surface is marked stale; the user
    clicks "Build 3D model" to materialise the wedge geometry.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model that owns both formations' contacts.
    request : PinchOutExtrapolationRequest
        Body with formation ids, section, direction, and optional
        geometry overrides.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    PinchOutExtrapolationResponse
        Created contact ids, tip geometry, and the updated section.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(409)
        When synthetic contacts for this formation already exist in
        the model (idempotent — returns existing ids, no duplicate).
    HTTPException(422)
        When the geometry is uncomputable: missing TIN, empty slice,
        or diverging surfaces.
    """
    # Model scope guard — same shape as all sibling contact endpoints.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    try:
        result = await ExtrapolatePinchOut(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=request.formation_id,
            target_formation_id=request.target_formation_id,
            section_id=request.section_id,
            direction=request.direction,
            dip_override_m_per_m=request.dip_override_m_per_m,
            offset_m=request.offset_m,
            dry_run=request.dry_run,
        )
    except ValueError as exc:
        # Use case raises ValueError for uncomputable geometry or missing
        # data (no TIN, empty slice, diverging surfaces). Map to 422 so
        # the frontend can surface a meaningful message to the engineer.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "pinch_out_geometry_error",
                "message": str(exc),
            },
        ) from exc

    # Section-seeding (explicit-content invariant): the user explicitly
    # invoked the tool on THIS section, so the created (or pre-existing
    # idempotent) contact ids must land in its seeded set. Pattern
    # matches AcceptLithoSuggestions / autoPopulate / discoverFromStrat
    # (debt #62 item 3 — the use case no longer returns an ORM section
    # row, the router owns the seed + serialise). Dry-runs return
    # created_contact_ids=[] so the union is a no-op then.
    updated_section_response: CrossSectionResponse | None = None
    if request.section_id is not None and result.created_contact_ids:
        seed_ids = {cid for cid in result.created_contact_ids}
        updated = await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            seed_ids,
            operation="PinchOut",
        )
        if updated is not None:
            updated_section_response = CrossSectionResponse.model_validate(updated)

    # Idempotent re-invocation: the use case detected pre-existing synthetic
    # contacts for this formation and returned them without creating more.
    # Surface as 409 (mirrors the create-contact dedupe-409 contract) so the
    # frontend knows it was a no-op; the body still carries the existing ids
    # + the section so the client can load/render them.
    if result.was_idempotent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "pinch_out_already_exists",
                "message": (
                    "Synthetic pinch-out contacts already exist for this "
                    "formation in this model; returning the existing ones."
                ),
                "existing_contact_ids": [str(cid) for cid in result.created_contact_ids],
                # The idempotent use-case path STILL seeds the section
                # (explicit-content invariant). Echo the patched section so
                # the client can refresh its local seeded set — otherwise
                # the pre-existing synthetic contacts stay invisible on
                # this section until a reload (review B2/S3).
                "updated_section": (
                    updated_section_response.model_dump(mode="json")
                    if updated_section_response is not None
                    else None
                ),
            },
        )

    return PinchOutExtrapolationResponse(
        created_contact_ids=result.created_contact_ids,
        tip_elevation_m=result.tip_elevation_m,
        tip_along_m=result.tip_along_m,
        updated_section=updated_section_response,
    )
