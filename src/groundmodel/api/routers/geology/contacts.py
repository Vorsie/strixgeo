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
from groundmodel.api.schemas.project.formation_contact import (
    AutoPopulateFromStratigraphyRequest,
    AutoPopulateFromStratigraphyResponse,
    DeduplicateContactsResponse,
    DiscoverFromStratigraphyRequest,
    DiscoverFromStratigraphyResponse,
    FormationCandidateItem,
    FormationContactBatchUpdateRequest,
    FormationContactBatchUpdateResponse,
    FormationContactCreateRequest,
    FormationContactResponse,
    FormationContactUpdateRequest,
)
from groundmodel.api.schemas.project.litho_suggestion import (
    LithoLayerSuggestionItem,
    LithoSuggestionRequest,
    LithoSuggestionResponse,
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
from groundmodel.application.discover_formations_from_stratigraphy import (
    DiscoverFormationsFromStratigraphy,
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
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
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
        selected_keys=request.selected_keys,
    )
    return AutoPopulateFromStratigraphyResponse(
        created_contact_ids=outcome.created_contact_ids,
        created_formation_ids=outcome.created_formation_ids,
        deleted_formation_ids=outcome.deleted_formation_ids,
        skipped_existing=outcome.skipped_existing,
        skipped_unmatched=outcome.skipped_unmatched,
        skipped_no_stratigraphy=outcome.skipped_no_stratigraphy,
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
    candidates = await DiscoverFormationsFromStratigraphy(session).execute(
        project_id=project_id,
        borehole_ids=request.borehole_ids,
    )
    logger.info(
        f"discover-from-stratigraphy done: {len(candidates)} candidate(s) for model={model_id}"
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
        ]
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
            )
            for lyr in layers
        ],
    )
