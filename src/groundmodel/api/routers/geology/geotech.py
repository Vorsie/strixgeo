"""Geology API — geotechnical subdivision endpoints (body-centric flow).

Two endpoints that expose the shipped body-centric geotech use cases:

* ``POST /models/{model_id}/geotech/subdivide-all-bodies`` — classify + materialise
  all in-corridor bodies in one shot (model_id = litho model).
* ``POST /models/{model_id}/geotech/divide-boreholes`` — TIN-divide borehole
  columns using the CPT geotech layers (model_id = litho model).

Both require the model to belong to ``project_id`` (scope guard via
``get_in_project_or_404``); ``subdivide-all-bodies`` additionally requires
``kind='lithostratigraphic'``.

Mounted under ``/projects/{project_id}/geology`` by the package ``__init__``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.geotech_suggestion import (
    DivideBoreholeResponse,
    SubdivideAllBodiesRequest,
    SubdivideAllBodiesResponse,
)
from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
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
        section_count=result.section_count,
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
        f"layers={result.layer_count}"
    )
    return DivideBoreholeResponse(
        geotech_model_id=result.geotech_model_id,
        divided_borehole_count=result.divided_borehole_count,
        single_band_borehole_count=result.single_band_borehole_count,
        layer_count=result.layer_count,
        created_formation_ids=result.created_formation_ids,
    )
