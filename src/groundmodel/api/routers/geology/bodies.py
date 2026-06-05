"""Geology API — body endpoints (replaces lenses router).

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints (per spec §6)
-----------------------
POST /models/{mid}/bodies/detect
    DetectBodies — explicit bilateral-closure detection + reconcile.

POST /models/{mid}/bodies/suggest-pinch-outs
    SuggestBodyPinchOuts — ephemeral candidate generator (no DB writes).

GET  /models/{mid}/bodies
    List all ``BodyOrm`` rows for the model.

POST /models/{mid}/bodies
    Claim — calls ``ClaimBodyExtent`` (body must already exist — the
    resolver owns body creation; addressed by ``body_id``).

PATCH /models/{mid}/bodies/{bid}
    Update name — calls ``NameBody`` identified by body_id (fetches
    formation_id + body_ordinal from the existing row, then delegates).

DELETE /models/{mid}/bodies/{bid}
    Hard-delete a body row (``DeleteBody``).

DELETE /models/{mid}/bodies/{bid}/extents/{side}
    Clear one lateral extent (``ClearBodyExtent``).

GET  /models/{mid}/bodies/{bid}/boundary
    Fetch boundary shape + control nodes (``GetBodyBoundary``).

PUT  /models/{mid}/bodies/{bid}/boundary
    Full-replace boundary shape + nodes (``SaveBodyBoundary``).

POST /models/{mid}/bodies/{bid}/perpendicular-companion
    Auto-create a perpendicular companion section
    (``CreatePerpendicularCompanion``).

Plus the absence endpoints (kept from lenses.py; body-scoped but mounted
under the shared geology prefix for historical reasons):

GET  /formations/{formation_id}/absences
POST /formations/{formation_id}/absences
POST /models/{mid}/formations/{formation_id}/absences/recompute
POST /models/{mid}/recompute-all-absences

Route ordering note
-------------------
``/models/{model_id}/bodies/detect`` and
``/models/{model_id}/bodies/suggest-pinch-outs`` MUST appear BEFORE
``/models/{model_id}/bodies/{body_id}``; FastAPI matches routes in
declaration order and would otherwise capture ``"detect"`` /
``"suggest-pinch-outs"`` as the ``body_id`` path parameter.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.body import (
    BodyBoundaryNodeItem,
    BodyBoundaryResponse,
    BodyBoundaryWriteRequest,
    BodyListItem,
    ClaimBodyExtentRequest,
    ClearDetectedBodiesResponse,
    DetectBodiesResponse,
    MergeEnclosedLensResponse,
    NameBodyRequest,
    NameBodyResponse,
    PinchOutCandidateItem,
    SuggestPinchOutsResponse,
)
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.litho_lens import (
    FormationAbsenceItem,
    UpsertFormationAbsenceRequest,
    UpsertFormationAbsenceResponse,
)
from groundmodel.application.body_boundary import (
    BodyNoPrimarySectionError,
    BodyNotFoundError,
    BoundaryNode,
    GetBodyBoundary,
    SaveBodyBoundary,
)
from groundmodel.application.claim_body_extent import ClaimBodyExtent, ProvenanceViolationError
from groundmodel.application.clear_body_extent import ClearBodyExtent
from groundmodel.application.create_perpendicular_companion import CreatePerpendicularCompanion
from groundmodel.application.delete_body import DeleteBody
from groundmodel.application.delete_detected_bodies import DeleteDetectedBodies
from groundmodel.application.detect_bodies import DetectBodies
from groundmodel.application.merge_enclosed_lens_bodies import MergeEnclosedLensBodies
from groundmodel.application.name_body import NameBody
from groundmodel.application.recompute_all_absences_for_model import RecomputeAllAbsencesForModel
from groundmodel.application.recompute_formation_absences_for_body import (
    RecomputeFormationAbsencesForBody,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.suggest_body_pinch_outs import SuggestBodyPinchOuts
from groundmodel.application.upsert_formation_absence import UpsertFormationAbsence
from groundmodel.domain.services.body_geo_label import majority_geo_formation
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


async def _geo_labels_by_body(
    session: AsyncSession, litho_model_id: UUID, body_ids: list[UUID]
) -> dict[UUID, tuple[UUID | None, str | None]]:
    """Return each body's derived majority geological-formation label.

    A2: the geological name on a body is DERIVED, not stored — the geological
    formation owning the majority of the body's member-layer thickness,
    recomputed fresh on every read so it stays correct as bodies merge/split or
    the geological surfaces are edited. The caller injects the result into the
    ``BodyListItem`` response.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    litho_model_id : UUID
        The lithostratigraphic model the bodies belong to; its parent
        geological model supplies the chrono contacts.
    body_ids : list[UUID]
        The bodies to label.

    Returns
    -------
    dict[UUID, tuple[UUID | None, str | None]]
        ``body_id -> (geo_formation_id, geo_formation_name)``. A body absent
        from the map (or mapped to ``(None, None)``) has no resolvable
        geological label — e.g. no geological model is defined at its
        investigations.
    """
    if not body_ids:
        return {}

    litho_model = await session.get(GeologicalModelOrm, litho_model_id)
    geo_model_id = litho_model.parent_geological_model_id if litho_model else None
    if geo_model_id is None:
        return {}

    # Members per body: (investigation_id, depth_top_m, depth_base_m).
    member_rows = (
        await session.execute(
            select(
                LithoLayerOrm.body_id,
                func.coalesce(LithoLayerOrm.borehole_id, LithoLayerOrm.cpt_id),
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
            ).where(
                LithoLayerOrm.body_id.in_(body_ids),
                LithoLayerOrm.status == "accepted",
            )
        )
    ).all()
    members_by_body: dict[UUID, list[tuple[UUID, float, float]]] = defaultdict(list)
    for body_id, inv_id, top, base in member_rows:
        if body_id is not None and inv_id is not None:
            members_by_body[body_id].append((inv_id, top, base))

    # Geological contacts grouped per investigation, ascending by depth.
    contact_rows = (
        await session.execute(
            select(
                func.coalesce(FormationContactOrm.borehole_id, FormationContactOrm.cpt_id),
                FormationContactOrm.depth_top_m,
                FormationContactOrm.formation_id,
            ).where(FormationContactOrm.model_id == geo_model_id)
        )
    ).all()
    geo_contacts_by_inv: dict[UUID, list[tuple[float, UUID]]] = defaultdict(list)
    for inv_id, depth, fid in contact_rows:
        if inv_id is not None:
            geo_contacts_by_inv[inv_id].append((depth, fid))
    for entries in geo_contacts_by_inv.values():
        entries.sort(key=lambda t: t[0])

    # Names for whichever geological formations the majority can resolve to.
    geo_fids = {fid for entries in geo_contacts_by_inv.values() for _, fid in entries}
    names: dict[UUID, str] = {}
    if geo_fids:
        name_rows = (
            await session.execute(
                select(GeologicalFormationOrm.id, GeologicalFormationOrm.name).where(
                    GeologicalFormationOrm.id.in_(geo_fids)
                )
            )
        ).all()
        names = {fid: name for fid, name in name_rows}

    labels: dict[UUID, tuple[UUID | None, str | None]] = {}
    for body_id in body_ids:
        geo_fid = majority_geo_formation(members_by_body.get(body_id, []), geo_contacts_by_inv)
        labels[body_id] = (geo_fid, names.get(geo_fid) if geo_fid is not None else None)
    return labels


def _to_list_item(body: BodyOrm, geo_label: tuple[UUID | None, str | None]) -> BodyListItem:
    """Build a ``BodyListItem`` from a body row + its derived geo label."""
    item = BodyListItem.model_validate(body)
    item.geo_formation_id, item.geo_formation_name = geo_label
    return item


# ---------------------------------------------------------------------------
# List all bodies for a model
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/bodies",
    response_model=list[BodyListItem],
)
async def list_bodies(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[BodyListItem]:
    """List all body metadata rows for a lithostratigraphic model.

    Returns a lightweight list item for every ``BodyOrm`` row that belongs
    to this project + model pair, ordered by creation timestamp (oldest
    first).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[BodyListItem]
        All bodies in this model, oldest-first.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    stmt = (
        select(BodyOrm)
        .where(
            BodyOrm.app_project_id == project_id,
            BodyOrm.model_id == model_id,
        )
        .order_by(BodyOrm.created_at)
    )
    result = await session.execute(stmt)
    bodies = list(result.scalars().all())
    labels = await _geo_labels_by_body(session, model_id, [b.id for b in bodies])
    logger.debug(f"list_bodies: project={project_id} model={model_id} → {len(bodies)} body row(s)")
    return [_to_list_item(b, labels.get(b.id, (None, None))) for b in bodies]


# ---------------------------------------------------------------------------
# Detect bodies — explicit verb (MUST come before /{body_id} routes)
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/bodies/detect",
    response_model=DetectBodiesResponse,
)
async def detect_bodies(
    project_id: UUID,
    model_id: UUID,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> DetectBodiesResponse:
    """Run the explicit "Detect bodies" pass on a lithostratigraphic model.

    Materialises ``BodyOrm`` rows for bilateral-closure topologies in the
    user-approved contact-edge graph and removes rows whose body no longer
    matches.  Idempotent.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    section_id : UUID | None
        The active cross-section.  Body extents are section-scoped (2D): when
        given, each body closes to the NEAREST target on each side along this
        section's column order, and the reconcile only touches bodies whose
        source is on this section.  Omit for the section-less fallback (UUID
        ordering, model-wide reconcile) used by non-interactive callers.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    DetectBodiesResponse
        Counts of created, removed, and ordinal-skipped body rows.

    Raises
    ------
    HTTPException(404)
        Model not found in the project.
    HTTPException(422)
        Model is not lithostratigraphic.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    if model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Model {model_id} is of kind {model.kind!r}; "
                "body detection only runs on lithostratigraphic models."
            ),
        )
    # Run the resolver FIRST, then detect — mirroring the canonical reconcile
    # pattern in the startup sweep (api/main.py) and the bundle restore
    # (api/routers/project.py).  ``ResolveLithoInstances`` is the SOLE authority
    # that creates ``body`` rows (one per connected component) and stamps
    # ``litho_layer.body_id``; ``DetectBodies`` is a pure extent manager that
    # can only write onto resolver-owned bodies.  Without this, a "Detect" click
    # after the user clears all bodies finds ``body_id IS NULL`` on every framed
    # layer (the FK is ``ondelete=SET NULL``) and silently creates nothing — the
    # bodies, still implied by the intact correlation graph, only reappear on an
    # app restart.  Running the resolver here makes Detect self-healing.
    await ResolveLithoInstances(session).execute(model_id=model_id, commit=False)
    result = await DetectBodies(session).execute(
        project_id=project_id,
        model_id=model_id,
        prefer_section_id=section_id,
    )
    # Both use cases flush but do NOT commit (designed to compose inside larger
    # transactions).  This explicit endpoint owns the commit boundary.
    await session.commit()
    logger.success(
        f"detect_bodies: project={project_id} model={model_id} "
        f"created={result.bodies_created} removed={result.bodies_removed} "
        f"skipped_unresolved_ordinal={result.bodies_skipped_unresolved_ordinal}"
    )
    return DetectBodiesResponse(
        bodies_created=result.bodies_created,
        bodies_removed=result.bodies_removed,
        bodies_skipped_unresolved_ordinal=result.bodies_skipped_unresolved_ordinal,
    )


@router.post(
    "/models/{model_id}/bodies/merge-enclosed-lenses",
    response_model=MergeEnclosedLensResponse,
)
async def merge_enclosed_lenses(
    project_id: UUID,
    model_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> MergeEnclosedLensResponse:
    """Merge a lithology split only by a local lens into one body (Fill bands).

    For each enclosed lens on the active section whose lithology is ABSENT on a
    neighbour (a true pinch), correlates the bracketing host halves to that
    neighbour's continuous host and re-resolves, so they become one body. The
    lens stays its own body. Idempotent — re-running adds only new edges.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    section_id : UUID
        The active cross-section — defines column adjacency (section-scoped).
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    MergeEnclosedLensResponse
        Counts of created + skipped correlation edges.

    Raises
    ------
    HTTPException(404)
        Model not found in the project.
    HTTPException(422)
        Model is not lithostratigraphic.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    if model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Model {model_id} is of kind {model.kind!r}; "
                "lens merging only runs on lithostratigraphic models."
            ),
        )
    result = await MergeEnclosedLensBodies(session).execute(
        project_id=project_id,
        model_id=model_id,
        section_id=section_id,
    )
    logger.success(
        f"merge_enclosed_lenses: project={project_id} model={model_id} "
        f"created={result.edges_created} skipped={result.edges_skipped_existing}"
    )
    return MergeEnclosedLensResponse(
        edges_created=result.edges_created,
        edges_skipped_existing=result.edges_skipped_existing,
    )


# ---------------------------------------------------------------------------
# Suggest pinch-outs — ephemeral (MUST come before /{body_id} routes)
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/bodies/suggest-pinch-outs",
    response_model=SuggestPinchOutsResponse,
)
async def suggest_body_pinch_outs(
    project_id: UUID,
    model_id: UUID,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> SuggestPinchOutsResponse:
    """Run SuggestBodyPinchOuts — returns ephemeral candidates, no DB writes.

    Scans bodies whose source pair has zero approved correlations in some
    direction and emits one ``PinchOutCandidateItem`` per adjacent
    neighbour in that direction.  The frontend renders them as ghost
    wedges; click-to-commit fires ``POST .../bodies`` (ClaimBodyExtent).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    section_id : UUID | None
        Active cross-section. When given, adjacency follows the section's
        along-axis column order (so suggestions target the neighbouring
        column, not a UUID-random one). Omit for the section-agnostic
        fallback.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    SuggestPinchOutsResponse
        Zero or more pinch-out candidates.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or belongs to a different project.
    """
    # Router-level scope guard: must return 404 (not 422) for a cross-project
    # model id — consistent with every other model-scoped endpoint in this
    # router.  Without this guard the use case's internal load_scoped_or_raise
    # would raise ValueError, which the except block below maps to 422.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        candidates = await SuggestBodyPinchOuts(session).execute(
            project_id=project_id,
            model_id=model_id,
            section_id=section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "suggest_pinch_outs_error", "message": str(exc)},
        ) from exc

    logger.debug(
        f"suggest_body_pinch_outs: project={project_id} model={model_id} "
        f"→ {len(candidates)} candidate(s)"
    )
    return SuggestPinchOutsResponse(
        candidates=[
            PinchOutCandidateItem(
                body_id=c.body_id,
                source_investigation_id=c.source_investigation_id,
                above_contact_id=c.above_contact_id,
                below_contact_id=c.below_contact_id,
                below_depth_m=c.below_depth_m,
                side=c.side,
                kind=c.kind,
                suggested_neighbour_investigation_id=c.suggested_neighbour_investigation_id,
            )
            for c in candidates
        ]
    )


# ---------------------------------------------------------------------------
# Claim a body extent (body must already exist — resolver owns creation)
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/bodies",
    response_model=BodyListItem,
    status_code=status.HTTP_201_CREATED,
)
async def claim_body_extent(
    project_id: UUID,
    model_id: UUID,
    request: ClaimBodyExtentRequest,
    session: AsyncSession = Depends(get_session),
) -> BodyListItem:
    """Claim a lateral extent on an existing body.

    Sets one side (left or right) of the body identified by ``body_id`` to
    the requested kind.  The body must already exist — the resolver
    (``ResolveLithoInstances``) owns body creation, so every accepted
    instance carries a body before any claim gesture is possible.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Must be a lithostratigraphic model in this project.
    request : ClaimBodyExtentRequest
        body_id, side, kind, optional source_investigation_id, optional
        neighbour_inv_id, optional primary_section_id.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BodyListItem
        The updated body row.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(409)
        When a detector-set ``to_target`` extent would be overwritten
        (provenance violation — user must call ClearBodyExtent first).
    HTTPException(422)
        On other validation failure (invalid side/kind, missing neighbour,
        unknown body id, scope guard failures for investigation ids).
    """
    # Router-level model scope guard: must return 404 (not 422) for a
    # cross-project model id.  Without this, the use case's internal
    # load_scoped_or_raise would raise ValueError → 422.
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        body = await ClaimBodyExtent(session).execute(
            project_id=project_id,
            model_id=model_id,
            body_id=request.body_id,
            source_investigation_id=request.source_investigation_id,
            side=request.side,
            kind=request.kind,
            neighbour_inv_id=request.neighbour_inv_id,
            primary_section_id=request.primary_section_id,
            anchor_layer_id=request.anchor_layer_id,
        )
    except ProvenanceViolationError as exc:
        # Provenance rule §5.2: detector-set extent cannot be overwritten
        # without an explicit ClearBodyExtent call.  409 signals a conflict
        # state the user must explicitly resolve (distinct from 422 which
        # signals a plain validation error the client sent bad data for).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "provenance_violation", "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "claim_body_extent_error", "message": str(exc)},
        ) from exc

    logger.success(
        f"claim_body_extent: project={project_id} model={model_id} "
        f"body={body.id} side={request.side} kind={request.kind}"
    )
    labels = await _geo_labels_by_body(session, model_id, [body.id])
    return _to_list_item(body, labels.get(body.id, (None, None)))


# ---------------------------------------------------------------------------
# Update body name (PATCH)
# ---------------------------------------------------------------------------


@router.patch(
    "/models/{model_id}/bodies/{body_id}",
    response_model=NameBodyResponse,
)
async def update_body(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    request: NameBodyRequest,
    session: AsyncSession = Depends(get_session),
) -> NameBodyResponse:
    """Update a body's human-readable name.

    Fetches the existing ``BodyOrm`` row to derive ``formation_id`` and
    ``body_ordinal``, then delegates to ``NameBody`` (which creates or
    updates the row idempotently).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        Primary key of the body to rename.
    request : NameBodyRequest
        name (required), optional primary_section_id.  The
        ``formation_id`` and ``body_ordinal`` fields from the schema
        are ignored here — they are derived from the existing body row.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    NameBodyResponse
        The body_id and a ``was_created`` flag (always False for this
        endpoint — the body must already exist to be addressed by id).

    Raises
    ------
    HTTPException(404)
        When the body does not exist or belongs to a different
        project / model.
    HTTPException(422)
        On NameBody validation failure (formation not found, etc.).
    """
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    try:
        result = await NameBody(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=body.formation_id,
            body_ordinal=body.body_ordinal,
            name=request.name,
            primary_section_id=request.primary_section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "name_body_error", "message": str(exc)},
        ) from exc

    return NameBodyResponse(body_id=result.body_id, was_created=result.was_created)


# ---------------------------------------------------------------------------
# Delete body
# ---------------------------------------------------------------------------


@router.delete(
    "/models/{model_id}/bodies",
    response_model=ClearDetectedBodiesResponse,
)
async def delete_detected_bodies_endpoint(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ClearDetectedBodiesResponse:
    """Bulk-delete the purely-detected bodies of a litho model.

    Backs the Sections toolbar's "Delete all detected lenses" action: it
    clears every machine-suggested body wedge in one gesture while
    preserving the interpretation the engineer committed.

    Preserve rules (spec §5.2, identical to the ``DetectBodies`` reconcile):

    * user-named bodies (``name`` set), and
    * bodies with a user-claimed extent kind
      (``pinch_out_halfway`` / ``extrapolated`` / ``open``)

    are left intact.  Only purely-detected (``to_target`` / unset) bodies go.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    ClearDetectedBodiesResponse
        Count of bodies deleted + count preserved.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    deleted, preserved = await DeleteDetectedBodies(session).execute(
        project_id=project_id,
        model_id=model_id,
    )
    return ClearDetectedBodiesResponse(bodies_deleted=deleted, bodies_preserved=preserved)


@router.delete(
    "/models/{model_id}/bodies/{body_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_body_endpoint(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Hard-delete the ``BodyOrm`` metadata row for a body.

    Absence rows and synthetic contacts scoped to the formation are
    intentionally preserved — they belong to the body's formation, not to
    the label row.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The ``BodyOrm`` row to delete.
    session : AsyncSession
        Database session provided by DI.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project, or when the body
        row does not exist or belongs to a different project/model.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    # Scope-check the body row before delegating (DeleteBody performs its
    # own scope guard but returns False instead of raising; we want a 404).
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    await DeleteBody(session).execute(
        project_id=project_id,
        model_id=model_id,
        body_id=body_id,
    )


# ---------------------------------------------------------------------------
# Clear one lateral extent
# ---------------------------------------------------------------------------


@router.delete(
    "/models/{model_id}/bodies/{body_id}/extents/{side}",
    response_model=BodyListItem | None,
)
async def clear_body_extent(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    side: str,
    session: AsyncSession = Depends(get_session),
) -> BodyOrm | None:
    """Clear one lateral extent back to NULL.

    Reaps the body row when both extents are NULL and the name is empty.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard (validated via model 404 check).
    body_id : UUID
        The body whose extent is to be cleared.
    side : str
        ``"left"`` or ``"right"``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BodyListItem | None
        The updated body row, or ``null`` when the body was reaped.

    Raises
    ------
    HTTPException(404)
        Model or body not found in scope.
    HTTPException(422)
        Invalid ``side`` value.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    try:
        body = await ClearBodyExtent(session).execute(
            project_id=project_id,
            model_id=model_id,
            body_id=body_id,
            side=side,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "clear_body_extent_error", "message": str(exc)},
        ) from exc

    return body


# ---------------------------------------------------------------------------
# Boundary shape — GET + PUT
# ---------------------------------------------------------------------------


def _boundary_response(state) -> BodyBoundaryResponse:  # noqa: ANN001 — internal mapper
    """Map a ``BodyBoundaryState`` (domain) to the API response schema."""
    return BodyBoundaryResponse(
        body_id=state.body_id,
        render_style=state.render_style,  # type: ignore[arg-type]
        primary_section_id=state.primary_section_id,
        upper_nodes=[
            BodyBoundaryNodeItem(along_m=n.along_m, elevation_m=n.elevation_m)
            for n in state.upper_nodes
        ],
        lower_nodes=[
            BodyBoundaryNodeItem(along_m=n.along_m, elevation_m=n.elevation_m)
            for n in state.lower_nodes
        ],
    )


@router.get(
    "/models/{model_id}/bodies/{body_id}/boundary",
    response_model=BodyBoundaryResponse,
)
async def get_body_boundary(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> BodyBoundaryResponse:
    """Return the user-authored boundary shape for a body.

    Empty node lists + ``render_style='straight'`` when no custom shape
    is stored yet.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The body whose boundary is requested.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BodyBoundaryResponse

    Raises
    ------
    HTTPException(404)
        When the body is not found in the project + model scope.
    """
    try:
        state = await GetBodyBoundary(session).execute(
            project_id=project_id, model_id=model_id, body_id=body_id
        )
    except BodyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": str(exc)},
        ) from exc
    return _boundary_response(state)


@router.put(
    "/models/{model_id}/bodies/{body_id}/boundary",
    response_model=BodyBoundaryResponse,
)
async def put_body_boundary(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    request: BodyBoundaryWriteRequest,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> BodyBoundaryResponse:
    """Full-replace the boundary shape + nodes for a body.

    Sorts and re-indexes the node lists server-side.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The body whose boundary is being updated.
    request : BodyBoundaryWriteRequest
        upper/lower nodes + render style.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BodyBoundaryResponse
        The saved state.

    Raises
    ------
    HTTPException(404)
        Body not found in scope.
    HTTPException(422)
        Body has no primary section.
    """
    try:
        state = await SaveBodyBoundary(session).execute(
            project_id=project_id,
            model_id=model_id,
            body_id=body_id,
            upper_nodes=[BoundaryNode(n.along_m, n.elevation_m) for n in request.upper_nodes],
            lower_nodes=[BoundaryNode(n.along_m, n.elevation_m) for n in request.lower_nodes],
            render_style=request.render_style,
            prefer_section_id=section_id,
        )
    except BodyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": str(exc)},
        ) from exc
    except BodyNoPrimarySectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_primary_section", "message": str(exc)},
        ) from exc
    return _boundary_response(state)


# ---------------------------------------------------------------------------
# Perpendicular companion section
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/bodies/{body_id}/perpendicular-companion",
    response_model=CrossSectionResponse,
)
async def create_perpendicular_companion(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Auto-create a perpendicular companion cross-section for a body.

    Creates a new cross-section perpendicular to the body's primary section,
    centred on the body's formation-contact centroid.  Idempotent — returns
    the existing companion section (HTTP 200) when one already exists; a
    freshly created companion returns HTTP 201.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        The ``BodyOrm`` row that defines the body.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    CrossSectionResponse
        The companion section (newly created or pre-existing).

    Raises
    ------
    HTTPException(404)
        When the model or body is not found in the project scope.
    HTTPException(422)
        When ``primary_section_id`` is null on the body, or when the
        primary section has been deleted.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    # Load and scope-check the body row.
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    try:
        result = await CreatePerpendicularCompanion(session).execute(
            project_id=project_id,
            model_id=model_id,
            body_id=body_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "companion_error", "message": str(exc)},
        ) from exc

    response = CrossSectionResponse.model_validate(result.companion_section)
    response.companion_lens_name = body.name

    http_status = status.HTTP_200_OK if result.already_existed else status.HTTP_201_CREATED
    return JSONResponse(
        status_code=http_status,
        content=response.model_dump(mode="json"),
    )


# ---------------------------------------------------------------------------
# Formation absence — list
# ---------------------------------------------------------------------------


@router.get(
    "/formations/{formation_id}/absences",
    response_model=list[FormationAbsenceItem],
)
async def list_formation_absences(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[FormationAbsenceOrm]:
    """Return all absence records for a formation in this project.

    Used by the "Inspect body" panel to display which investigations are
    absent for this formation and their confidence source
    (``'inferred'`` / ``'manual'`` / ``'observed'``).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    formation_id : UUID
        The geological formation whose absences are requested.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[FormationAbsenceItem]
        All absence rows for this formation, ordered by investigation_kind
        then investigation_id for deterministic rendering.

    Raises
    ------
    HTTPException(404)
        When the formation does not belong to the project.
    """
    formation = await session.get(GeologicalFormationOrm, formation_id)
    if formation is None or formation.app_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "formation_not_found",
                "message": f"Formation {formation_id} not found.",
            },
        )
    stmt = (
        select(FormationAbsenceOrm)
        .where(FormationAbsenceOrm.formation_id == formation_id)
        .order_by(
            FormationAbsenceOrm.investigation_kind,
            FormationAbsenceOrm.investigation_id,
        )
    )
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    logger.debug(f"list_formation_absences: formation={formation_id} → {len(rows)} absence(s)")
    return rows


# ---------------------------------------------------------------------------
# Formation absence — upsert
# ---------------------------------------------------------------------------


@router.post(
    "/formations/{formation_id}/absences",
    response_model=UpsertFormationAbsenceResponse,
    status_code=status.HTTP_200_OK,
)
async def upsert_formation_absence(
    project_id: UUID,
    formation_id: UUID,
    request: UpsertFormationAbsenceRequest,
    session: AsyncSession = Depends(get_session),
) -> UpsertFormationAbsenceResponse:
    """Create or promote a formation absence row.

    Supports two gestures from the "Inspect body" panel:

    * **Confirm absence** — promotes an existing ``source='inferred'``
      row to ``source='manual'``.  The inference engine will not
      overwrite it on the next recompute.
    * **Manual absence** — adds a ``source='manual'`` or
      ``source='observed'`` row for an investigation the engine did not
      infer.

    ``source='inferred'`` is rejected — that source belongs to the
    inference engine.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    formation_id : UUID
        The geological formation to record absence for.
    request : UpsertFormationAbsenceRequest
        investigation_id, investigation_kind, source.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    UpsertFormationAbsenceResponse
        The absence row id and a ``was_created`` flag.

    Raises
    ------
    HTTPException(422)
        When ``source`` is not allowed, the formation is not found, or
        the investigation is not found.
    """
    try:
        result = await UpsertFormationAbsence(session).execute(
            project_id=project_id,
            formation_id=formation_id,
            investigation_id=request.investigation_id,
            investigation_kind=request.investigation_kind,
            source=request.source,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "absence_upsert_error", "message": str(exc)},
        ) from exc

    return UpsertFormationAbsenceResponse(
        absence_id=result.absence_id,
        was_created=result.was_created,
    )


# ---------------------------------------------------------------------------
# Formation absence — recompute for one body
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/formations/{formation_id}/absences/recompute",
    status_code=status.HTTP_200_OK,
)
async def recompute_formation_absences(
    project_id: UUID,
    model_id: UUID,
    formation_id: UUID,
    body_ordinal: int = 0,
    section_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Re-run the inference engine for a body and apply the delta.

    Idempotent — safe to call multiple times.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model that owns the body.
    formation_id : UUID
        The formation whose body is being re-evaluated.
    body_ordinal : int
        Zero-based ordinal from the resolver (defaults to 0).
    section_id : UUID | None
        Section that defines the corridor.  Required.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    dict
        ``written``, ``retracted``, ``skipped_no_data`` counts.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When ``section_id`` is missing or the formation is not found.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    if section_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "missing_section_id", "message": "section_id is required"},
        )

    try:
        result = await RecomputeFormationAbsencesForBody(session).execute(
            project_id=project_id,
            model_id=model_id,
            formation_id=formation_id,
            body_ordinal=body_ordinal,
            section_id=section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "recompute_error", "message": str(exc)},
        ) from exc

    return {
        "written": result.written_count,
        "retracted": result.retracted_count,
        "skipped_no_data": result.skipped_no_data_count,
    }


# ---------------------------------------------------------------------------
# Formation absence — bulk recompute for entire model
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/recompute-all-absences",
    status_code=status.HTTP_200_OK,
)
async def recompute_all_absences_for_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Re-run absence inference for every formation with contacts in the model.

    Designed as the one-shot finaliser for ``defer_inference=True``
    bulk-accept flows.  The model must be ``kind='lithostratigraphic'``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model to recompute.  Must belong to
        ``project_id`` and have ``kind='lithostratigraphic'``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    dict
        ``formations_processed``, ``total_written``, ``total_retracted``,
        ``total_wedge_tips_created``, ``total_wedge_tips_deleted`` counts.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model kind is not ``'lithostratigraphic'``.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Geological model not found",
    )

    # Kind guard: must be lithostratigraphic — callers that accidentally
    # pass a geological model_id get a clear 422 rather than a silent no-op.
    model = await session.get(GeologicalModelOrm, model_id)
    if model is not None and model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "wrong_model_kind",
                "message": (
                    f"Model {model_id} has kind='{model.kind}'; "
                    f"recompute-all-absences requires kind='{MODEL_KIND_LITHOSTRATIGRAPHIC}'."
                ),
            },
        )

    try:
        result = await RecomputeAllAbsencesForModel(session).execute(
            project_id=project_id,
            model_id=model_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "recompute_all_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"recompute_all_absences_for_model: project={project_id} model={model_id} → "
        f"formations_processed={result.formations_processed} "
        f"written={result.total_written} retracted={result.total_retracted} "
        f"wedge_tips_created={result.total_wedge_tips_created}"
    )
    return {
        "formations_processed": result.formations_processed,
        "total_written": result.total_written,
        "total_retracted": result.total_retracted,
        "total_wedge_tips_created": result.total_wedge_tips_created,
        "total_wedge_tips_deleted": result.total_wedge_tips_deleted,
    }
