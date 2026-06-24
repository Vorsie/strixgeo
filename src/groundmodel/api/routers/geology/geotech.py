"""Geology API — geotechnical subdivision endpoints (Slice 1, Task C3 + E4).

Four endpoints that expose the geotech-stage use cases:

* ``POST /models/{model_id}/geotech/build``   — build the geo-bounded skeleton
  from a lithostratigraphic model (model_id = litho model).
* ``POST /models/{model_id}/geotech/suggest`` — suggest NAD packing sub-units
  for an existing geotech model (model_id = geotech model).
* ``POST /models/{model_id}/contacts/accept-geotech-suggestions`` — persist
  accepted sub-units (model_id = geotech model).
* ``POST /models/{model_id}/geotech/subdivide-all-bodies`` — classify + materialise
  all in-corridor bodies in one shot (model_id = litho model).

All four require the model to belong to ``project_id`` (scope guard via
``get_in_project_or_404``).  Kind validation mirrors the litho endpoints:
``build`` and ``subdivide-all-bodies`` require ``kind='lithostratigraphic'``;
``suggest`` and ``accept`` require ``kind='geotechnical'``.

Mounted under ``/projects/{project_id}/geology`` by the package ``__init__``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.geotech_suggestion import (
    AcceptGeotechRequest,
    AcceptGeotechResponse,
    BuildGeotechRequest,
    BuildGeotechResponse,
    GeotechGhostSubUnitItem,
    GeotechInvestigationSuggestionItem,
    GeotechSegmentSuggestionItem,
    SubdivideAllBodiesRequest,
    SubdivideAllBodiesResponse,
    SuggestGeotechRequest,
)
from groundmodel.application.accept_geotech_suggestions import (
    AcceptedGeotechSubUnit,
    AcceptGeotechSegment,
    AcceptGeotechSuggestions,
)
from groundmodel.application.build_geotech_model_from_litho import BuildGeotechModelFromLitho
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.application.suggest_geotech_subdivision import (
    GeotechInvestigationSuggestion,
    SuggestGeotechSubdivision,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()


# ---------------------------------------------------------------------------
# Build endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/geotech/build",
    response_model=BuildGeotechResponse,
    status_code=status.HTTP_200_OK,
)
async def build_geotech_model(
    project_id: UUID,
    model_id: UUID,
    request: BuildGeotechRequest,
    session: AsyncSession = Depends(get_session),
) -> BuildGeotechResponse:
    """Build the geo-bounded geotech skeleton from a lithostratigraphic model.

    Creates (or reuses) the ``kind='geotechnical'`` sibling model under the
    given litho model, then lays down its structural skeleton — every
    section-scoped litho column divided at the geological boundaries —
    persisted as geotech ``FormationContact`` rows with ``nad_class=None``.

    Re-running this endpoint for the same ``(model_id, section_id)`` pair
    **replaces** the section's geotech skeleton contacts (idempotent re-build).
    Any NAD packing classifications previously accepted via
    ``accept-geotech-suggestions`` for this section will be CLOBBERED — this
    C1↔C2 re-build interaction is documented behaviour for Slice 1.  A
    Build-UX guard (warning before re-build when accepted contacts exist) is
    deferred to the frontend (Phase D).

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the litho model must belong to this project.
    model_id : UUID
        The **lithostratigraphic** model to subdivide.  Must be
        ``kind='lithostratigraphic'``; any other kind returns 422.
    request : BuildGeotechRequest
        Body with the ``section_id`` whose in-corridor investigations are built.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    BuildGeotechResponse
        Geotech model id, creation flag, and per-phase counts.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='lithostratigraphic'``.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/build "
        f"section_id={request.section_id}"
    )
    # Scope guard + kind check: get_in_project_or_404 returns the row so we
    # re-use it for the kind validation without a second session.get call.
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
                    "geotech/build requires kind='lithostratigraphic'"
                ),
                "actual_kind": model.kind,
            },
        )

    try:
        result = await BuildGeotechModelFromLitho(session).execute(
            project_id=project_id,
            litho_model_id=model_id,
            section_id=request.section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "build_geotech_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"build_geotech_model ok geotech_model={result.geotech_model_id} "
        f"created_model={result.created_model} "
        f"formations={len(result.created_formation_ids)} "
        f"contacts={len(result.created_contact_ids)} "
        f"divided={result.divided_contact_count}"
    )
    return BuildGeotechResponse(
        geotech_model_id=result.geotech_model_id,
        created_model=result.created_model,
        created_formation_ids=result.created_formation_ids,
        created_contact_ids=result.created_contact_ids,
        divided_contact_count=result.divided_contact_count,
    )


# ---------------------------------------------------------------------------
# Suggest endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/geotech/suggest",
    response_model=list[GeotechInvestigationSuggestionItem],
    status_code=status.HTTP_200_OK,
)
async def suggest_geotech_subdivision(
    project_id: UUID,
    model_id: UUID,
    request: SuggestGeotechRequest,
    session: AsyncSession = Depends(get_session),
) -> list[GeotechInvestigationSuggestionItem]:
    """Suggest NAD packing sub-units for a geotech model's skeleton segments.

    Read-only — returns an ephemeral list of investigation suggestions with
    ghost sub-units for each geo-bounded skeleton segment.  Nothing is written.

    CPT investigations receive NAD class suggestions derived from the CPT's qc
    series.  Borehole investigations receive a single carry-through ghost per
    segment with ``nad_class=None`` (no qc → unclassifiable).

    The model must have ``kind='geotechnical'``; any other kind returns 422.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The **geotechnical** model whose skeleton contacts are processed.  Must
        be ``kind='geotechnical'``; any other kind returns 422.
    request : SuggestGeotechRequest
        Body with the ``section_id`` whose in-corridor investigations are
        processed.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[GeotechInvestigationSuggestionItem]
        One entry per in-corridor investigation with at least one skeleton
        contact.  Empty list when no skeleton contacts exist (run build first).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='geotechnical'``.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/suggest "
        f"section_id={request.section_id}"
    )
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    if model.kind != "geotechnical":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": (
                    f"Model {model_id} has kind='{model.kind}'; "
                    "geotech/suggest requires kind='geotechnical'"
                ),
                "actual_kind": model.kind,
            },
        )

    try:
        suggestions: list[GeotechInvestigationSuggestion] = await SuggestGeotechSubdivision(
            session
        ).execute(
            project_id=project_id,
            geotech_model_id=model_id,
            section_id=request.section_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "suggest_geotech_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"suggest_geotech_subdivision ok geotech_model={model_id} investigations={len(suggestions)}"
    )
    return [
        GeotechInvestigationSuggestionItem(
            investigation_id=inv.investigation_id,
            is_cpt=inv.is_cpt,
            segments=[
                GeotechSegmentSuggestionItem(
                    segment_top_m=seg.segment_top_m,
                    segment_base_m=seg.segment_base_m,
                    source_litho_formation_id=seg.source_litho_formation_id,
                    source_geo_formation_id=seg.source_geo_formation_id,
                    ghost_sub_units=[
                        GeotechGhostSubUnitItem(
                            depth_top_m=sub.depth_top_m,
                            depth_base_m=sub.depth_base_m,
                            nad_class=sub.nad_class,
                            source_litho_formation_id=sub.source_litho_formation_id,
                            source_geo_formation_id=sub.source_geo_formation_id,
                        )
                        for sub in seg.ghost_sub_units
                    ],
                )
                for seg in inv.segments
            ],
        )
        for inv in suggestions
    ]


# ---------------------------------------------------------------------------
# Accept endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/contacts/accept-geotech-suggestions",
    response_model=AcceptGeotechResponse,
    status_code=status.HTTP_200_OK,
)
async def accept_geotech_suggestions(
    project_id: UUID,
    model_id: UUID,
    request: AcceptGeotechRequest,
    session: AsyncSession = Depends(get_session),
) -> AcceptGeotechResponse:
    """Persist accepted NAD packing sub-units for a geotech model.

    Takes the user-accepted segments (from the ``geotech/suggest`` response)
    and writes the classified ``geological_formation`` rows + ``FormationContact``
    rows.  Orphaned skeleton formations (``nad_class=None``) whose contacts were
    all retargeted to classified formations are deleted.

    Re-calling for the same investigation segment is idempotent: the half-open
    ``[seg_top, seg_base)`` range is deleted before rewriting, and
    formation find-or-create is DB-backed so no duplicate rows accumulate.

    The model must have ``kind='geotechnical'``; any other kind returns 422.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The **geotechnical** model the accepted contacts belong to.  Must be
        ``kind='geotechnical'``; any other kind returns 422.
    request : AcceptGeotechRequest
        Body with the ``section_id`` and the accepted ``segments`` list.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    AcceptGeotechResponse
        Created formation ids, created contact ids, deleted skeleton ids.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='geotechnical'``.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}"
        f"/contacts/accept-geotech-suggestions "
        f"section_id={request.section_id} segments={len(request.segments)}"
    )
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    if model.kind != "geotechnical":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": (
                    f"Model {model_id} has kind='{model.kind}'; "
                    "accept-geotech-suggestions requires kind='geotechnical'"
                ),
                "actual_kind": model.kind,
            },
        )

    # Convert API DTOs to use-case domain DTOs.
    domain_segments = [
        AcceptGeotechSegment(
            investigation_id=seg.investigation_id,
            segment_top_m=seg.segment_top_m,
            segment_base_m=seg.segment_base_m,
            sub_units=[
                AcceptedGeotechSubUnit(
                    investigation_id=sub.investigation_id,
                    depth_top_m=sub.depth_top_m,
                    depth_base_m=sub.depth_base_m,
                    nad_class=sub.nad_class,
                    source_litho_formation_id=sub.source_litho_formation_id,
                    source_geo_formation_id=sub.source_geo_formation_id,
                )
                for sub in seg.sub_units
            ],
        )
        for seg in request.segments
    ]

    try:
        result = await AcceptGeotechSuggestions(session).execute(
            project_id=project_id,
            geotech_model_id=model_id,
            section_id=request.section_id,
            segments=domain_segments,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "accept_geotech_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"accept_geotech_suggestions ok geotech_model={model_id} "
        f"formations={len(result.created_formation_ids)} "
        f"contacts={len(result.created_contact_ids)} "
        f"deleted_skeletons={len(result.deleted_skeleton_ids)}"
    )
    return AcceptGeotechResponse(
        created_formation_ids=result.created_formation_ids,
        created_contact_ids=result.created_contact_ids,
        deleted_skeleton_ids=result.deleted_skeleton_ids,
    )


# ---------------------------------------------------------------------------
# Subdivide-all-bodies endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/geotech/subdivide-all-bodies",
    response_model=SubdivideAllBodiesResponse,
    status_code=status.HTTP_200_OK,
)
async def subdivide_all_bodies(
    project_id: UUID,
    model_id: UUID,
    request: SubdivideAllBodiesRequest,
    session: AsyncSession = Depends(get_session),
) -> SubdivideAllBodiesResponse:
    """Classify and materialise geotech NAD bodies for all litho bodies in the model.

    Runs ``SubdivideAllBodies`` (Task E3) which groups geo-bounded litho picks
    by ``(body_id, source_geo_formation_id)``, applies the B-policy aggregator
    to decide consistent-split vs one-class per group, interpolates split
    surfaces onto every column, and materialises real geotech spatial bodies
    via ``litho_layer`` + edge inserts so they render through the litho engine.

    This operation is **model-wide** (not section-scoped): geotech layers are
    written once per investigation (section-independent) and correlation edges
    are derived per-section from the litho model's approved edges.  Borehole-
    only body groups are extrapolated from the nearest same-lithology CPT when
    one overlaps the borehole's depth range.

    The endpoint is idempotent: the entire geotech model's layers, edges, and
    bodies are deleted and rewritten on each call.  Unlike ``geotech/build``
    (which writes ``FormationContact`` rows via the skeleton path), this endpoint
    writes ``litho_layer`` rows directly; the two paths write to different tables
    and may both exist in the project.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the litho model must belong to this project.
    model_id : UUID
        The **lithostratigraphic** model whose bodies are subdivided.  Must be
        ``kind='lithostratigraphic'``; any other kind returns 422.
    request : SubdivideAllBodiesRequest
        Body with ``litho_model_id`` (same as the URL ``model_id``; retained
        in the request body for forward-compatibility).
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    SubdivideAllBodiesResponse
        Geotech model id, created formation ids, and per-phase counts.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='lithostratigraphic'``, or a domain
        error is raised during materialisation.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}"
        f"/geotech/subdivide-all-bodies (model-wide)"
    )
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
                    "geotech/subdivide-all-bodies requires kind='lithostratigraphic'"
                ),
                "actual_kind": model.kind,
            },
        )
    # The body carries litho_model_id for forward-compatibility; the URL
    # model_id is authoritative. Reject a mismatched body rather than silently
    # discard it (the handler always uses the URL id).
    if request.litho_model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "mismatched_model_id",
                "message": (
                    f"Body litho_model_id={request.litho_model_id} does not match "
                    f"URL model_id={model_id}"
                ),
            },
        )

    try:
        result = await SubdivideAllBodies(session).execute(
            project_id=project_id,
            litho_model_id=model_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "subdivide_all_bodies_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"subdivide_all_bodies ok geotech_model={result.geotech_model_id} "
        f"layers={result.layer_count} bodies={result.body_count} "
        f"split={result.split_body_count} one_class={result.one_class_body_count} "
        f"borehole_only={result.borehole_only_count} "
        f"extrapolated={result.extrapolated_borehole_count} "
        f"sections={result.section_count}"
    )
    return SubdivideAllBodiesResponse(
        geotech_model_id=result.geotech_model_id,
        created_formation_ids=result.created_formation_ids,
        layer_count=result.layer_count,
        body_count=result.body_count,
        split_body_count=result.split_body_count,
        one_class_body_count=result.one_class_body_count,
        borehole_only_count=result.borehole_only_count,
        extrapolated_borehole_count=result.extrapolated_borehole_count,
        section_count=result.section_count,
    )
