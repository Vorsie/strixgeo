"""Geology API — geotechnical subdivision endpoints (body-centric flow).

Three endpoints that expose the shipped body-centric geotech use cases:

* ``POST /models/{model_id}/geotech/subdivide-all-bodies`` — classify + materialise
  all in-corridor bodies in one shot (model_id = litho model).
* ``POST /models/{model_id}/geotech/divide-boreholes`` — TIN-divide borehole
  columns using the CPT geotech layers (model_id = litho model).
* ``POST /models/{model_id}/geotech/divide-boreholes/preview`` — the same
  planner, reported instead of written, so the engineer can see what packing
  each borehole would get before pressing the button.
* ``POST /models/{model_id}/geotech/auto-correlate`` — re-propose the automatic
  packing ties as UNAPPROVED suggestions, adding only (model_id = **geotech**
  model).

All require the model to belong to ``project_id`` (scope guard via
``get_in_project_or_404``); ``subdivide-all-bodies`` additionally requires
``kind='lithostratigraphic'`` and ``auto-correlate`` requires
``kind='geotechnical'``.

Mounted under ``/projects/{project_id}/geology`` by the package ``__init__``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    get_in_project_or_404,
    require_model_kind,
)
from groundmodel.api.schemas.project.geotech_band_edit import (
    GeotechBandEditPlanResponse,
    GeotechBandEditResponse,
    GeotechBandIntervalItem,
    GeotechBandWarningItem,
    MergeGeotechBandsRequest,
    SplitGeotechBandRequest,
)
from groundmodel.api.schemas.project.geotech_suggestion import (
    AutoCorrelateGeotechRequest,
    AutoCorrelateGeotechResponse,
    DivideBoreholePreviewBand,
    DivideBoreholePreviewColumn,
    DivideBoreholePreviewResponse,
    DivideBoreholeResponse,
    SubdivideAllBodiesRequest,
    SubdivideAllBodiesResponse,
)
from groundmodel.application.auto_correlate_geotech_edges import AutoCorrelateGeotechEdges
from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.application.geotech_band_edit_helpers import GeotechBandEditResult
from groundmodel.application.merge_geotech_bands import MergeGeotechBands
from groundmodel.application.preview_geotech_band_edit import PreviewGeotechBandEdit
from groundmodel.application.split_geotech_band import SplitGeotechBand
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.domain.services.geotech_band_reclassification import (
    BandEditPlan,
    GeotechBandEditError,
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
    bodies are deleted and rewritten on each call.  Geotech geometry is written
    as ``litho_layer`` rows (the LL→FC trigger mirrors the contacts) so it
    renders through the litho engine.

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
    require_model_kind(model, "lithostratigraphic", "geotech/subdivide-all-bodies")
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
        f"sections={result.section_count} "
        f"ties_reanchored={result.reanchored_tie_count} "
        f"ties_need_review={result.review_tie_reasons} "
        f"ties_lost={result.lost_tie_count} {result.lost_tie_reasons}"
    )
    return SubdivideAllBodiesResponse(
        geotech_model_id=result.geotech_model_id,
        created_formation_ids=result.created_formation_ids,
        layer_count=result.layer_count,
        body_count=result.body_count,
        split_body_count=result.split_body_count,
        one_class_body_count=result.one_class_body_count,
        borehole_only_count=result.borehole_only_count,
        section_count=result.section_count,
        reanchored_tie_count=result.reanchored_tie_count,
        review_tie_reasons=result.review_tie_reasons,
        lost_tie_count=result.lost_tie_count,
        lost_tie_reasons=result.lost_tie_reasons,
        lost_tie_labels=result.lost_tie_labels,
    )


@router.post(
    "/models/{model_id}/geotech/divide-boreholes",
    response_model=DivideBoreholeResponse,
    status_code=status.HTTP_200_OK,
    summary="TIN-divide borehole columns using existing CPT geotech layers",
    tags=["geotech"],
)
async def divide_boreholes(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> DivideBoreholeResponse:
    """Materialise TIN-divided geotech bands for all borehole columns.

    Reads the CPT geotech layers already in the geotech model (written by
    ``subdivide-all-bodies``), rebuilds the packing-transition surfaces, and
    materialises matching borehole bands via TIN interpolation per litho body
    group.  Prior borehole geotech layers are deleted before new ones are written
    (idempotent re-run).

    Run this **after** ``subdivide-all-bodies`` — and optionally after the
    engineer has manually correlated packing bands — so borehole bands reflect
    the final body membership and CPT packing structure.

    Parameters
    ----------
    project_id : UUID
        Project scope (path parameter from the router prefix).
    model_id : UUID
        The **lithostratigraphic** model whose geotech child model to update.
    session : AsyncSession
        Injected database session.

    Returns
    -------
    DivideBoreholeResponse
        Summary counts and newly created geotech formation ids.

    Raises
    ------
    HTTPException
        * 404 — litho model not found in project, or geotech model not yet created.
        * 422 — validation error in path/body parameters.
        * 500 — unexpected server error.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    try:
        result = await DivideBoreholes(session).execute(
            project_id=project_id,
            litho_model_id=model_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"divide_boreholes error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "divide_boreholes_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"divide_boreholes ok geotech_model={result.geotech_model_id} "
        f"divided_bh={result.divided_borehole_count} "
        f"single_bh={result.single_band_borehole_count} "
        f"layers={result.layer_count} "
        f"ties_reanchored={result.reanchored_tie_count} "
        f"ties_need_review={result.review_tie_reasons} "
        f"ties_lost={result.lost_tie_count} {result.lost_tie_reasons}"
    )
    return DivideBoreholeResponse(
        geotech_model_id=result.geotech_model_id,
        divided_borehole_count=result.divided_borehole_count,
        single_band_borehole_count=result.single_band_borehole_count,
        layer_count=result.layer_count,
        created_formation_ids=result.created_formation_ids,
        reanchored_tie_count=result.reanchored_tie_count,
        review_tie_reasons=result.review_tie_reasons,
        lost_tie_count=result.lost_tie_count,
        lost_tie_reasons=result.lost_tie_reasons,
        lost_tie_labels=result.lost_tie_labels,
    )


@router.post(
    "/models/{model_id}/geotech/divide-boreholes/preview",
    response_model=DivideBoreholePreviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Preview the borehole packing bands 'Divide boreholes' would write (no write)",
    tags=["geotech"],
)
async def preview_divide_boreholes(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> DivideBoreholePreviewResponse:
    """Answer what packing each borehole would get, without writing anything.

    ``Subdivide all bodies`` leaves every borehole column empty on the geotech
    axis (its borehole-mediated edges are deferred to this verb), so until now
    the engineer had to press an idempotent-but-destructive rebuild blind to
    find out what the boreholes would be classified as.  This endpoint runs the
    SAME planner ``divide-boreholes`` commits — ``DivideBoreholes.plan`` — and
    reports its bands, so the ghosts drawn from this response are the rows the
    button writes.

    Also reports what a commit would do to the accepted packing ties anchored on
    a borehole (carried / flagged / lost), because those are destroyed and
    re-created by the rebuild and the engineer should not learn that afterwards.

    Nothing is persisted: only ``SELECT``\\ s are issued and the session is
    rolled back when the request ends.

    Parameters
    ----------
    project_id : UUID
        Project scope (path parameter from the router prefix).
    model_id : UUID
        The **lithostratigraphic** model whose geotech child model would be
        updated — the same id ``divide-boreholes`` takes.
    session : AsyncSession
        Injected database session.

    Returns
    -------
    DivideBoreholePreviewResponse
        Per-borehole planned bands + the summary and tie-carry counts.

    Raises
    ------
    HTTPException
        * 404 — litho model not found in project, or the geotech model does not
          exist yet (``Subdivide all bodies`` has not run).
        * 500 — unexpected server error.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/divide-boreholes/preview"
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = DivideBoreholes(session)
    try:
        plan = await use_case.plan(project_id=project_id, litho_model_id=model_id)
        tie_plan = await use_case.preview_tie_carry(plan)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"preview_divide_boreholes error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "divide_boreholes_preview_error", "message": str(exc)},
        ) from exc

    columns = plan.columns()
    logger.info(
        f"preview_divide_boreholes ok geotech_model={plan.geotech_model_id} "
        f"boreholes={len(columns)} bands={plan.layer_count} "
        f"divided={plan.divided_borehole_count} single={plan.single_band_borehole_count} "
        f"ties_carried={len(tie_plan.matched)} ties_lost={len(tie_plan.lost)}"
    )
    return DivideBoreholePreviewResponse(
        geotech_model_id=plan.geotech_model_id,
        columns=[
            DivideBoreholePreviewColumn(
                borehole_id=column.borehole_id,
                name=column.name,
                bands=[
                    DivideBoreholePreviewBand(
                        depth_top_m=band.depth_top_m,
                        depth_base_m=band.depth_base_m,
                        nad_class=band.nad_class,
                        source=band.source,
                        confidence=band.confidence,
                    )
                    for band in column.bands
                ],
            )
            for column in columns
        ],
        borehole_count=len(columns),
        divided_borehole_count=plan.divided_borehole_count,
        single_band_borehole_count=plan.single_band_borehole_count,
        layer_count=plan.layer_count,
        carried_tie_count=len(tie_plan.matched),
        review_tie_reasons=tie_plan.review_reason_counts(),
        lost_tie_count=len(tie_plan.lost),
        lost_tie_reasons=tie_plan.loss_reason_counts(),
    )


@router.post(
    "/models/{model_id}/geotech/auto-correlate",
    response_model=AutoCorrelateGeotechResponse,
    status_code=status.HTTP_200_OK,
    summary="Auto-propose geotech packing correlations as unapproved suggestions",
    tags=["geotech"],
)
async def auto_correlate_geotech(
    project_id: UUID,
    model_id: UUID,
    body: AutoCorrelateGeotechRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> AutoCorrelateGeotechResponse:
    """Re-derive the automatic geotech packing ties as UNAPPROVED suggestions.

    The geotech counterpart of the litho ``contact-correlations/auto`` verb.
    Inside each correlated litho unit, the two columns' NAD packing-class
    sequences are aligned by the shipped sequence-match rule and each aligned
    position becomes a proposed edge.  Proposals insert with
    ``user_approved=False``, so they render as suggestions until the engineer
    promotes them with the accept verb — nothing enters the body resolver until
    then.

    **It adds; it does not reconcile.**  Every correlation already on the model
    — drawn by hand, accepted earlier, or written by ``subdivide-all-bodies`` —
    is left exactly as it is and reported under ``edges_skipped_existing``.  The
    endpoint is therefore safe to press at any point during a hand-correlation
    session, unlike ``subdivide-all-bodies``, which wipes the whole geotech
    model before rebuilding it.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        The **geotechnical** model whose packing bands are correlated.  Any
        other kind returns 422.
    body : AutoCorrelateGeotechRequest | None
        Optional ``section_id`` to restrict the run to one section; omitted or
        ``None`` runs across every section of the project.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    AutoCorrelateGeotechResponse
        Proposed / skipped-existing counts the frontend toasts, plus the two
        diagnostic skip reasons.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not ``kind='geotechnical'``, or has no
        lithostratigraphic parent to read approved correlations from.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/auto-correlate "
        f"section={body.section_id if body is not None else None}"
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    try:
        result = await AutoCorrelateGeotechEdges(session).execute(
            project_id=project_id,
            model_id=model_id,
            section_id=body.section_id if body is not None else None,
        )
    except ValueError as exc:
        # Non-geotech model, parentless geotech model, or out-of-project — the
        # use case rejects it with the reason.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "auto_correlate_geotech_error", "message": str(exc)},
        ) from exc

    logger.info(
        f"auto_correlate_geotech ok model={model_id} proposed={result.edges_proposed} "
        f"skipped_existing={result.edges_skipped_existing} "
        f"sections={result.sections_processed}"
    )
    return AutoCorrelateGeotechResponse(
        edges_proposed=result.edges_proposed,
        edges_skipped_existing=result.edges_skipped_existing,
        sections_processed=result.sections_processed,
        skipped_no_lcs=result.skipped_no_lcs,
        skipped_empty_stack=result.skipped_empty_stack,
    )


# ---------------------------------------------------------------------------
# Hand split / merge of packing sub-bands (owner spec 2026-08-01)
# ---------------------------------------------------------------------------


def _plan_payload(plan: BandEditPlan) -> GeotechBandEditPlanResponse:
    """Map a domain :class:`BandEditPlan` onto its response schema.

    Parameters
    ----------
    plan : BandEditPlan
        The planned (or committed) edit.

    Returns
    -------
    GeotechBandEditPlanResponse
        The wire shape, identical for preview and commit so the UI renders one
        component for both.
    """
    return GeotechBandEditPlanResponse(
        kind=plan.kind,
        parent_top_m=plan.parent_top_m,
        parent_base_m=plan.parent_base_m,
        intervals=[
            GeotechBandIntervalItem(
                depth_top_m=interval.depth_top_m,
                depth_base_m=interval.depth_base_m,
                median_qc_mpa=interval.median_qc_mpa,
                nad_class=interval.nad_class,
                previous_nad_class=interval.previous_nad_class,
                class_changed=interval.class_changed,
                unclassifiable_reason=interval.unclassifiable_reason,
            )
            for interval in plan.intervals
        ],
        warnings=[
            GeotechBandWarningItem(
                code=warning.code,
                message=warning.message,
                depth_top_m=warning.depth_top_m,
                depth_base_m=warning.depth_base_m,
                band_id=warning.band_id,
            )
            for warning in plan.warnings
        ],
    )


def _edit_payload(result: GeotechBandEditResult) -> GeotechBandEditResponse:
    """Map a committed :class:`GeotechBandEditResult` onto its response schema.

    Parameters
    ----------
    result : GeotechBandEditResult
        The committed edit.

    Returns
    -------
    GeotechBandEditResponse
        The wire shape.
    """
    return GeotechBandEditResponse(
        geotech_model_id=result.geotech_model_id,
        investigation_id=result.investigation_id,
        plan=_plan_payload(result.plan),
        layer_ids=list(result.layer_ids),
        created_layer_ids=list(result.created_layer_ids),
        deleted_layer_ids=list(result.deleted_layer_ids),
        deleted_edge_ids=list(result.deleted_edge_ids),
    )


async def _require_geotech_model(
    session: AsyncSession, project_id: UUID, model_id: UUID, verb: str
) -> None:
    """Scope + kind guard shared by the four band-edit endpoints.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    project_id : UUID
        Project the model must belong to.
    model_id : UUID
        The model being addressed.
    verb : str
        Short verb name interpolated into the 422 message.
    """
    model = await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    require_model_kind(model, "geotechnical", verb)


def _band_edit_422(exc: GeotechBandEditError) -> HTTPException:
    """Turn a hierarchy breach into the structured 422 the UI shows verbatim.

    Parameters
    ----------
    exc : GeotechBandEditError
        The domain rejection.

    Returns
    -------
    HTTPException
        A 422 carrying the domain message unaltered.
    """
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "geotech_band_edit_rejected", "message": str(exc)},
    )


@router.post(
    "/models/{model_id}/geotech/bands/preview-split",
    response_model=GeotechBandEditPlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Preview splitting a packing band (no write)",
    tags=["geotech"],
)
async def preview_split_geotech_band(
    project_id: UUID,
    model_id: UUID,
    request: SplitGeotechBandRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechBandEditPlanResponse:
    """Answer what a proposed split would do, without writing anything.

    Returns, per resulting half, the representative (MEDIAN) qc, the re-derived
    NAD class, the class the material carries today, and the plain-language
    consequence of the move. When the cone resistance cannot answer over a half,
    that half reports a null class with a reason rather than a guessed class.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The **geotechnical** model the band belongs to.
    request : SplitGeotechBandRequest
        Band id + proposed boundary depth.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    GeotechBandEditPlanResponse
        The previewed intervals + advisory warnings.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not geotechnical, the band sits on a borehole (no cone
        resistance, so no class can be re-derived), or the depth falls outside
        the band's own litho body (the hierarchy is not overrulable).
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/bands/preview-split "
        f"band={request.band_id} depth={request.split_depth_m}"
    )
    await _require_geotech_model(session, project_id, model_id, "geotech/bands/preview-split")
    try:
        plan = await PreviewGeotechBandEdit(session).preview_split(
            project_id=project_id,
            geotech_model_id=model_id,
            band_id=request.band_id,
            split_depth_m=request.split_depth_m,
        )
    except GeotechBandEditError as exc:
        raise _band_edit_422(exc) from exc
    return _plan_payload(plan)


@router.post(
    "/models/{model_id}/geotech/bands/preview-merge",
    response_model=GeotechBandEditPlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Preview merging two adjacent packing bands (no write)",
    tags=["geotech"],
)
async def preview_merge_geotech_bands(
    project_id: UUID,
    model_id: UUID,
    request: MergeGeotechBandsRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechBandEditPlanResponse:
    """Answer what a proposed merge would do, without writing anything.

    The merged interval's class is re-derived from the qc over the UNION, so it
    may differ from both inputs. The warnings say, per input band, whether the
    material it now shares a layer with pulls its representative qc DOWN or UP,
    and what class results.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The **geotechnical** model the bands belong to.
    request : MergeGeotechBandsRequest
        The adjacent pair to merge.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    GeotechBandEditPlanResponse
        The previewed merged interval + advisory warnings.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not geotechnical, the bands sit on a borehole (no cone
        resistance, so no class can be re-derived), or the two bands are not
        adjacent within one geo-bounded litho body.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/bands/preview-merge "
        f"upper={request.upper_band_id} lower={request.lower_band_id}"
    )
    await _require_geotech_model(session, project_id, model_id, "geotech/bands/preview-merge")
    try:
        plan = await PreviewGeotechBandEdit(session).preview_merge(
            project_id=project_id,
            geotech_model_id=model_id,
            upper_band_id=request.upper_band_id,
            lower_band_id=request.lower_band_id,
        )
    except GeotechBandEditError as exc:
        raise _band_edit_422(exc) from exc
    return _plan_payload(plan)


@router.post(
    "/models/{model_id}/geotech/bands/split",
    response_model=GeotechBandEditResponse,
    status_code=status.HTTP_200_OK,
    summary="Split a packing band by hand and re-derive both halves",
    tags=["geotech"],
)
async def split_geotech_band(
    project_id: UUID,
    model_id: UUID,
    request: SplitGeotechBandRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechBandEditResponse:
    """Commit a hand split. Only the edited column is rewritten.

    Both halves are reclassified from the CPT qc over their own extent; a
    correlation on the edited band is dropped only where the new class no longer
    matches its partner. A band thinner than the configured minimum is committed
    with a warning — a manual edit overrules that rule.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The **geotechnical** model the band belongs to.
    request : SplitGeotechBandRequest
        Band id + boundary depth.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    GeotechBandEditResponse
        The committed plan, resulting row ids, and dropped correlations.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not geotechnical, the band sits on a borehole (no cone
        resistance, so no class can be re-derived), or the depth breaches the
        hierarchy.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/bands/split "
        f"band={request.band_id} depth={request.split_depth_m}"
    )
    await _require_geotech_model(session, project_id, model_id, "geotech/bands/split")
    try:
        result = await SplitGeotechBand(session).execute(
            project_id=project_id,
            geotech_model_id=model_id,
            band_id=request.band_id,
            split_depth_m=request.split_depth_m,
        )
    except GeotechBandEditError as exc:
        raise _band_edit_422(exc) from exc
    logger.info(
        f"split_geotech_band ok investigation={result.investigation_id} "
        f"layers={len(result.layer_ids)} dropped_edges={len(result.deleted_edge_ids)}"
    )
    return _edit_payload(result)


@router.post(
    "/models/{model_id}/geotech/bands/merge",
    response_model=GeotechBandEditResponse,
    status_code=status.HTTP_200_OK,
    summary="Merge two adjacent packing bands by hand and re-derive the union",
    tags=["geotech"],
)
async def merge_geotech_bands(
    project_id: UUID,
    model_id: UUID,
    request: MergeGeotechBandsRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechBandEditResponse:
    """Commit a hand merge. Only the edited column is rewritten.

    The merged band's class is re-derived from the qc over the union. The
    absorbed band's correlations go with it; the surviving band keeps the
    correlations whose partner still carries the merged class.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The **geotechnical** model the bands belong to.
    request : MergeGeotechBandsRequest
        The adjacent pair to merge.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    GeotechBandEditResponse
        The committed plan, the surviving row id, the absorbed row id, and the
        dropped correlations.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the model is not geotechnical, the bands sit on a borehole (no cone
        resistance, so no class can be re-derived), or the merge would cross a
        litho or geological contact.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/geotech/bands/merge "
        f"upper={request.upper_band_id} lower={request.lower_band_id}"
    )
    await _require_geotech_model(session, project_id, model_id, "geotech/bands/merge")
    try:
        result = await MergeGeotechBands(session).execute(
            project_id=project_id,
            geotech_model_id=model_id,
            upper_band_id=request.upper_band_id,
            lower_band_id=request.lower_band_id,
        )
    except GeotechBandEditError as exc:
        raise _band_edit_422(exc) from exc
    logger.info(
        f"merge_geotech_bands ok investigation={result.investigation_id} "
        f"absorbed={result.deleted_layer_ids} dropped_edges={len(result.deleted_edge_ids)}"
    )
    return _edit_payload(result)
