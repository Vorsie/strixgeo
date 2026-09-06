"""Geology API — stratigraphy + litho-suggestion operations.

Extracted verbatim from ``contacts.py`` (debt #178/#201): auto-populate /
discover from stratigraphy, contact dedupe, clear litho model, seed litho
from parent, suggest / accept / batch-accept litho suggestions. Mounted
under the shared ``/projects/{project_id}/geology`` prefix by this
package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    get_in_project_or_404,
    litho_layer_write_conflict,
    require_model_kind,
)
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.formation_contact import (
    AutoPopulateFromStratigraphyRequest,
    AutoPopulateFromStratigraphyResponse,
    ClearLithoModelResponse,
    DeduplicateContactsResponse,
    DiscoverFromStratigraphyRequest,
    DiscoverFromStratigraphyResponse,
    FormalCodeItem,
    FormationCandidateItem,
    LumpingCollisionItem,
    SeedLithoFromParentRequest,
    SeedLithoFromParentResponse,
)
from groundmodel.api.schemas.project.litho_suggestion import (
    AcceptLithoSuggestionsRequest,
    AcceptLithoSuggestionsResponse,
    BatchAcceptLithoAnchorResult,
    BatchAcceptLithoSuggestionsRequest,
    BatchAcceptLithoSuggestionsResponse,
    LithoLayerSuggestionItem,
    LithoSuggestionRequest,
    LithoSuggestionResponse,
)
from groundmodel.application.accept_litho_suggestions import AcceptLithoSuggestions
from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    AutoPopulateContactsFromStratigraphy,
    build_formal_informal_bridge,
)
from groundmodel.application.batch_accept_litho_suggestions import (
    BatchAcceptAnchorInput,
    BatchAcceptLithoSuggestions,
)
from groundmodel.application.clear_litho_model import ClearLithoModel
from groundmodel.application.deduplicate_formation_contacts import (
    DeduplicateFormationContacts,
)
from groundmodel.application.discover_formations_from_stratigraphy import (
    DiscoverFormationsFromStratigraphy,
)
from groundmodel.application.rebuild_model_surfaces import RebuildModelSurfaces
from groundmodel.application.recompute_all_absences_for_model import (
    RecomputeAllAbsencesForModel,
)
from groundmodel.application.seed_litho_from_geological_model import (
    SeedLithoFromGeologicalModel,
)
from groundmodel.application.suggest_litho_contacts import (
    InvalidModelKindError,
    InvestigationNotFoundError,
    SuggestLithoContacts,
)
from groundmodel.domain.services.litho_segmentation import LithoLayerSuggestion
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.auto_populate_mode import AutoPopulateMode
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()


def _to_domain_suggestions(
    items: list[LithoLayerSuggestionItem],
) -> list[LithoLayerSuggestion]:
    """Convert API suggestion items into domain ``LithoLayerSuggestion`` objects.

    Shared by the single-accept and batch-accept handlers (extracted on the
    second copy) so both decode the wire shape identically.

    Parameters
    ----------
    items : list[LithoLayerSuggestionItem]
        Suggestion items from an accept request body.

    Returns
    -------
    list[LithoLayerSuggestion]
        Domain suggestions ready for the accept use case.
    """
    return [
        LithoLayerSuggestion(
            depth_top_m=item.depth_top_m,
            depth_base_m=item.depth_base_m,
            suggested_lithology=item.suggested_lithology,
            suggested_nad_class=item.suggested_nad_class,
            mean_qc_mpa=item.mean_qc_mpa,
            dr_pct=item.dr_pct,
            confidence=SuggestionConfidence(item.confidence.value),
            source=item.source,
            suggested_admixtures=tuple(
                Admixture(soil_code=adm.soil_code, amount=adm.amount, locally=adm.locally)
                for adm in item.suggested_admixtures
            ),
        )
        for item in items
    ]


def _to_collision_items(collisions: Iterable[Any]) -> list[LumpingCollisionItem]:
    """Map domain lumping collisions to their API response schema.

    Shared by the auto-populate and discover-from-stratigraphy handlers
    (extracted on the second copy) so both encode the wire shape
    identically.

    Parameters
    ----------
    collisions
        Iterable of domain collision objects exposing the six
        ``LumpingCollisionItem`` fields.

    Returns
    -------
    list[LumpingCollisionItem]
        API-boundary mirror of each collision.
    """
    return [
        LumpingCollisionItem(
            borehole_id=col.borehole_id,
            target_formation_key=col.target_formation_key,
            target_formation_name=col.target_formation_name,
            colliding_raw_names=col.colliding_raw_names,
            kept_top_m=col.kept_top_m,
            dropped_count=col.dropped_count,
        )
        for col in collisions
    ]


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

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model to seed — must belong to ``project_id``.
    request : AutoPopulateFromStratigraphyRequest
        Body with ``borehole_ids``, optional ``selected_keys`` /
        ``manual_map`` / ``section_id``, the ``create_missing_formations``
        flag, and ``mode`` (``add`` — the default — never deletes;
        ``overwrite`` removes the formations not in ``selected_keys``).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    AutoPopulateFromStratigraphyResponse
        Created / found / deleted ids, the per-reason skip counts,
        lumping collisions, and optionally the updated section row.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
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
        mode=request.mode,
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
        collisions=_to_collision_items(outcome.collisions),
        updated_section=updated_section_response,
        deleted_formation_names=outcome.deleted_formation_names,
        mode=AutoPopulateMode(outcome.mode),
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
                formal_codes=[
                    FormalCodeItem(
                        code=fc.code,
                        count=fc.count,
                        catalog_name=fc.catalog_name,
                    )
                    for fc in c.formal_codes
                ],
            )
            for c in candidates
        ],
        collisions=_to_collision_items(collisions),
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

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model to dedupe — must belong to ``project_id``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    DeduplicateContactsResponse
        The inspected-group count, the removed-duplicate count, and the
        list of removed contact ids.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
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
    "/models/{model_id}/layers/seed-from-parent",
    response_model=SeedLithoFromParentResponse,
)
async def seed_litho_from_parent(
    project_id: UUID,
    model_id: UUID,
    request: SeedLithoFromParentRequest,
    session: AsyncSession = Depends(get_session),
) -> SeedLithoFromParentResponse:
    """Copy the parent geological model's contacts into a lithostratigraphic model.

    Dormant endpoint (debt #60): the frontend caller was removed 2026-07-12;
    retained for external scripts / a future automated litho-seed workflow.
    The model must be ``kind='lithostratigraphic'`` with a non-null
    ``parent_model_id``; any other shape returns 422. Only
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
        ``parent_model_id``.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}"
        f"/layers/seed-from-parent borehole_ids={len(request.borehole_ids)}"
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
                merge_same_lithology=request.merge_same_lithology,
                use_normalised_qc=request.use_normalised_qc,
            )
            investigation_type = "cpt"
        else:
            layers = await use_case.execute_for_borehole(
                model_id=model_id,
                borehole_id=request.borehole_id,  # type: ignore[arg-type]
                minimum_layer_thickness_m=request.minimum_layer_thickness_m,
                merge_same_lithology=request.merge_same_lithology,
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
    "/models/{model_id}/layers/accept-litho-suggestions",
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
        Created/found formation + contact ids and optionally the updated
        section.

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
    require_model_kind(model, "lithostratigraphic", "accept-litho-suggestions")

    # Convert API suggestion items back to domain objects so the use case
    # can operate on typed data rather than raw dicts.
    domain_suggestions = _to_domain_suggestions(request.suggestions)

    try:
        result = await AcceptLithoSuggestions(session).execute(
            project_id=project_id,
            litho_model_id=model_id,
            suggestions=domain_suggestions,
            cpt_id=request.cpt_id,
            borehole_id=request.borehole_id,
            section_id=request.section_id,
            defer_inference=request.defer_inference,
            couple_tolerance_m=request.couple_tolerance_m,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "accept_litho_error", "message": str(exc)},
        ) from exc
    except IntegrityError as exc:
        # The no-overlap exclusion fires when the accepted layers would overlap
        # existing accepted layers on the same investigation column — pre-seeded
        # contacts (manual or fixture) and segmenter-derived contacts sharing a
        # formation key (same litho_main_soil_code + empty admixture signature)
        # produce overlapping depth intervals. Any OTHER violation is a rejected
        # write, not a conflict; the helper tells them apart.
        raise litho_layer_write_conflict(
            exc,
            overlap_message=(
                "Accepted layers would overlap an existing accepted layer on the same "
                "investigation column. Re-clear the column (DELETE /contacts) or choose "
                "a different anchor before re-accepting."
            ),
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

    # Auto-rebuild geo surfaces for formations whose contacts were snapped by
    # the coupling step (#162 Task 4).  The snap directly mutates
    # geo_contact.depth_top_m without going through UpdateFormationContact, so
    # the normal mark_surfaces_stale+Build-on-click path doesn't fire.  We
    # trigger the rebuild here — once per accept, scoped to the affected
    # parent geo model — so the geo model stays self-consistent immediately.
    # RebuildModelSurfaces.execute does not accept only_formation_ids scoping;
    # it rebuilds the whole model.  Guarded on non-empty so no-coupling accepts
    # (most accepts) pay zero extra cost.
    if result.touched_geo_formation_ids and model.parent_model_id is not None:
        await RebuildModelSurfaces(session).execute(model.parent_model_id)

    return AcceptLithoSuggestionsResponse(
        created_formation_ids=result.created_formation_ids,
        found_formation_ids=result.found_formation_ids,
        created_contact_ids=result.created_contact_ids,
        found_contact_ids=result.found_contact_ids,
        updated_section=updated_section_response,
    )


@router.post(
    "/models/{model_id}/layers/batch-accept-litho-suggestions",
    response_model=BatchAcceptLithoSuggestionsResponse,
    status_code=status.HTTP_200_OK,
)
async def batch_accept_litho_suggestions(
    project_id: UUID,
    model_id: UUID,
    request: BatchAcceptLithoSuggestionsRequest,
    session: AsyncSession = Depends(get_session),
) -> BatchAcceptLithoSuggestionsResponse:
    """Accept many anchors' litho suggestions in one transaction (#153 batch lever).

    The single-accept endpoint commits once per anchor, so the frontend's
    "accept all" cost one HTTP round-trip + one commit per investigation.  This
    endpoint accepts every anchor in a single transaction (one commit), seeds
    the section once with the aggregated contact ids, and runs the inference
    recompute once — collapsing an N-anchor bulk accept from ``N + 2`` calls to
    a single call.

    Per-anchor ``ValueError`` (bad investigation id, etc.) is reported in that
    anchor's ``error`` field; the rest of the batch still commits.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Lithostratigraphic model — must be ``kind='lithostratigraphic'`` and
        belong to ``project_id``.
    request : BatchAcceptLithoSuggestionsRequest
        The per-anchor suggestion lists plus an optional shared ``section_id``
        and the ``run_inference`` flag.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BatchAcceptLithoSuggestionsResponse
        Per-anchor results, aggregate counts, the updated section, and whether
        inference ran.

    Raises
    ------
    HTTPException(422)
        When the model is not ``kind='lithostratigraphic'``.
    HTTPException(404)
        When the model does not belong to the project.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    require_model_kind(model, "lithostratigraphic", "batch-accept-litho-suggestions")

    # Convert each anchor's suggestion items to domain objects.
    anchor_inputs = [
        BatchAcceptAnchorInput(
            suggestions=_to_domain_suggestions(anchor.suggestions),
            cpt_id=anchor.cpt_id,
            borehole_id=anchor.borehole_id,
        )
        for anchor in request.anchors
    ]

    try:
        batch_result = await BatchAcceptLithoSuggestions(session).execute(
            project_id=project_id,
            litho_model_id=model_id,
            anchors=anchor_inputs,
            couple_tolerance_m=request.couple_tolerance_m,
        )
    except IntegrityError as exc:
        # Same translation as the single-anchor accept above; the whole
        # batch-transaction is rolled back either way.
        raise litho_layer_write_conflict(
            exc,
            overlap_message=(
                "One or more anchors produced accepted layers that would overlap "
                "existing accepted layers on the same investigation column. "
                "Re-clear affected CPTs (DELETE /contacts) before re-accepting."
            ),
        ) from exc

    # Aggregate the created/found contact ids across all anchors and seed the
    # section ONCE (one array rewrite instead of one per anchor).
    anchor_results: list[BatchAcceptLithoAnchorResult] = []
    all_contact_ids: set[UUID] = set()
    # Formations this batch touched — drives the incremental recompute (#155)
    # so inference re-runs only for affected formations, not the whole model.
    affected_formation_ids: set[UUID] = set()
    totals = {
        "created_contacts": 0,
        "found_contacts": 0,
        "created_formations": 0,
        "failed": 0,
    }
    for outcome in batch_result.outcomes:
        r = outcome.result
        if r is None:
            totals["failed"] += 1
            anchor_results.append(
                BatchAcceptLithoAnchorResult(
                    cpt_id=outcome.cpt_id,
                    borehole_id=outcome.borehole_id,
                    error=outcome.error,
                )
            )
            continue
        all_contact_ids.update(r.created_contact_ids)
        all_contact_ids.update(r.found_contact_ids)
        affected_formation_ids.update(r.created_formation_ids)
        affected_formation_ids.update(r.found_formation_ids)
        totals["created_contacts"] += len(r.created_contact_ids)
        totals["found_contacts"] += len(r.found_contact_ids)
        totals["created_formations"] += len(r.created_formation_ids)
        anchor_results.append(
            BatchAcceptLithoAnchorResult(
                cpt_id=outcome.cpt_id,
                borehole_id=outcome.borehole_id,
                created_formation_ids=r.created_formation_ids,
                found_formation_ids=r.found_formation_ids,
                created_contact_ids=r.created_contact_ids,
                found_contact_ids=r.found_contact_ids,
            )
        )

    # Explicit-content invariant: union every accepted contact id into the
    # section in a single update (mirrors the single-accept seed, batched).
    updated_section_response = None
    if request.section_id is not None and all_contact_ids:
        updated = await CrossSectionRepository(session).union_seeded_contact_ids(
            request.section_id,
            project_id,
            all_contact_ids,
            operation="BatchAcceptLithoSuggestions",
        )
        if updated is not None:
            updated_section_response = CrossSectionResponse.model_validate(updated)

    # One INCREMENTAL inference recompute for the whole batch (#155): only the
    # formations this accept touched, not every formation in the model. On an
    # established model the accept touches a handful of formations while the
    # model may hold dozens, so this turns the per-accept inference from
    # O(model size) into O(accepted) — the dominant cost on real projects.
    inference_ran = False
    if request.run_inference and affected_formation_ids:
        await RecomputeAllAbsencesForModel(session).execute(
            project_id=project_id,
            model_id=model_id,
            only_formation_ids=list(affected_formation_ids),
        )
        inference_ran = True

    # Auto-rebuild geo surfaces once for the whole batch (#162 Task 4): mirrors
    # the single-accept path.  The batch use case already aggregated all
    # touched_geo_formation_ids across anchors so this fires once, not per anchor.
    # RebuildModelSurfaces.execute rebuilds the whole geo model (no
    # only_formation_ids scoping); guarded on non-empty + parent present.
    if batch_result.touched_geo_formation_ids and model.parent_model_id is not None:
        await RebuildModelSurfaces(session).execute(model.parent_model_id)

    return BatchAcceptLithoSuggestionsResponse(
        anchors=anchor_results,
        total_created_contacts=totals["created_contacts"],
        total_found_contacts=totals["found_contacts"],
        total_created_formations=totals["created_formations"],
        failed_anchor_count=totals["failed"],
        inference_ran=inference_ran,
        updated_section=updated_section_response,
    )
