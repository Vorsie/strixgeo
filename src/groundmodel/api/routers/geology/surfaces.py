"""Geology API — TIN rebuild, surface listing, gap/crossing validation, DEM ground-surface.

Split from the former 1,100-line geology.py monolith (debt #40).
Mounted under the shared /projects/{project_id}/geology prefix by
this package __init__; paths are unchanged.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.dem import GroundSurfaceBuildResponse
from groundmodel.api.schemas.project.formation_contact import (
    CrossingValidationResponse,
    FormationSurfaceResponse,
    GapIssueResponse,
    GapValidationResponse,
    RebuildSurfacesResponse,
)
from groundmodel.application.build_ground_surface import BuildGroundSurface
from groundmodel.application.build_model_ground_sampler import build_model_ground_sampler
from groundmodel.application.load_bed_overrides import load_bed_override_polygons
from groundmodel.application.rebuild_model_surfaces import RebuildModelSurfaces
from groundmodel.application.validate_borehole_stratigraphy import (
    ValidateBoreholeStratigraphy,
)
from groundmodel.application.validate_model_crossings import ValidateModelCrossings
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.dem.dem_provider_factory import (
    NoDemProviderError,
    build_dem_provider,
)
from groundmodel.shared.config import settings
from groundmodel.shared.exceptions import (
    DemExtentRefusedError,
    DemUpstreamRecentlyFailedError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# /projects/{project_id}/geology parent router (paths unchanged).
router = APIRouter()


def _to_gap_issues(issues: Iterable[Any]) -> list[GapIssueResponse]:
    """Map domain validation issues to their API response schema.

    One conversion for the three handlers that surface
    ``ValidationIssue``-shaped domain objects (gap validation, crossing
    validation, ground-surface build) — previously the same 7-line
    comprehension lived in all three.

    Parameters
    ----------
    issues
        Iterable of domain issues exposing ``kind``, ``detail``,
        ``depth_m``, ``contact_ids`` and ``formation_ids``.

    Returns
    -------
    list[GapIssueResponse]
        API-boundary mirror of each issue.
    """
    return [
        GapIssueResponse(
            kind=i.kind,
            detail=i.detail,
            depth_m=i.depth_m,
            contact_ids=list(i.contact_ids),
            formation_ids=list(i.formation_ids),
        )
        for i in issues
    ]


@router.post(
    "/models/{model_id}/surfaces/rebuild",
    response_model=RebuildSurfacesResponse,
)
async def rebuild_model_surfaces(
    project_id: UUID,
    model_id: UUID,
    method: str = Query(
        "tin",
        pattern="^tin$",
        description=(
            "Surface interpolation method. v1.0 ships TIN only; the "
            "param scaffolds for kriging / RBF / GemPy in Phase 5+ "
            "without a contract bump."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> RebuildSurfacesResponse:
    """Build the geological model — recompute every formation's TIN cache.

    The PRIMARY way the user materialises their picks into surfaces.
    Per-contact mutations no longer auto-recompute (on-click build
    pivot); they flip ``is_stale=True`` and the section view renders
    the stale cache faded + dashed until this endpoint clears it.

    Also covers escape-hatch use: anchor elevation edited without a
    contact mutation, suspected drift, etc. Idempotent — calling on
    a clean model returns ``formations_rebuilt=0``.

    Method param scaffolds the future kriging selector. v1 enforces
    ``method=tin`` via regex; an unknown value returns 422.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model whose formation surfaces are rebuilt.
    method : str
        Surface interpolation method. Constrained to ``"tin"`` by the
        query regex in v1.0; scaffolds kriging / RBF / GemPy for
        Phase 5+.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    RebuildSurfacesResponse
        Counts of formations considered, rebuilt, and reordered.
        ``formations_rebuilt=0`` when the model was already clean.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to the
        project.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    # Method dispatch is a no-op today; keeps the call site shape
    # ready for Phase 5's per-method use cases without revisiting
    # the route.
    _ = method
    # Build the ground surface (DEM + manual bed overrides) so each formation
    # TIN is cut where it crosses the ground (owner ruling 2026-09-06). The
    # helper is best-effort: it returns None on any DEM failure, and the rebuild
    # then produces unclipped surfaces exactly as before.
    ground_sampler = await build_model_ground_sampler(session, project_id, model_id)
    outcome = await RebuildModelSurfaces(session).execute(model_id, ground_sampler=ground_sampler)
    return RebuildSurfacesResponse(
        formations_considered=outcome.formations_considered,
        formations_rebuilt=outcome.formations_rebuilt,
        formations_reordered=outcome.formations_reordered,
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

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model whose cached surfaces are returned.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[FormationSurfaceResponse]
        One entry per cached TIN surface in the model.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to the
        project.
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

    Parameters
    ----------
    project_id : UUID
        Project scope guard — both the model and the borehole must
        belong to this project.
    model_id : UUID
        Geological model providing the formation contacts.
    borehole_id : UUID
        Borehole whose stratigraphy is validated.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    GapValidationResponse
        The model/borehole ids plus the list of gap/overlap issues
        (empty list ⇒ a clean stratigraphy).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to ``project_id``, or the borehole
        does not belong to ``project_id`` (VULN-11).
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    # Borehole scope guard — prevent cross-project id enumeration (VULN-11).
    await get_in_project_or_404(
        session.get(BoreholeOrm, borehole_id),
        project_id,
        detail="Borehole not found",
    )
    issues = await ValidateBoreholeStratigraphy(session).execute(model_id, borehole_id)
    return GapValidationResponse(
        model_id=model_id,
        borehole_id=borehole_id,
        issues=_to_gap_issues(issues),
    )


@router.get(
    "/models/{model_id}/validate/crossings",
    response_model=CrossingValidationResponse,
)
async def validate_no_crossings(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CrossingValidationResponse:
    """Check that no two formation surfaces violate stratigraphic order.

    Walks every cached TIN in the model and looks for pairs where the
    younger formation's surface dips below the older's anywhere in the
    shared (x, y) footprint — a violation of the geological
    superposition rule. Returns the list of ``formation_crossing``
    issues; empty list ⇒ all surfaces stack consistently. Editor
    surfaces these as inline warnings.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model whose cached surfaces are checked.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CrossingValidationResponse
        The model id plus the list of ``formation_crossing`` issues
        (empty list ⇒ all surfaces stack consistently).

    Raises
    ------
    HTTPException(404)
        When the model does not exist or does not belong to the
        project.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    issues = await ValidateModelCrossings(session).execute(model_id)
    return CrossingValidationResponse(
        model_id=model_id,
        issues=_to_gap_issues(issues),
    )


# ---------------------------------------------------------------------------
# Ground-surface build (G7 DEM clip)
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/ground-surface/build",
    response_model=GroundSurfaceBuildResponse,
)
async def build_ground_surface(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> GroundSurfaceBuildResponse:
    """Sample the DEM over the model's investigation hull and return a TIN.

    The returned TIN is used by ``Geology3DViewer`` as the scene base in
    place of the flat ``EllipsoidTerrainProvider``. The mesh is built from
    the DEM (DHMVII for BE/EPSG:31370, AHN4 for NL/EPSG:28992) sampled on
    a 10 m regular grid inside the axis-aligned bbox of all investigations
    anchored to this model.

    The surface is **not persisted** — it is derivable from the DEM tile
    cache and the project's investigation locations; calling this endpoint
    again is idempotent (the WCS tile is served from the local cache on
    subsequent calls). No ``.gmproj`` or ``format_version`` change.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model — must belong to ``project_id``.

    Returns
    -------
    GroundSurfaceBuildResponse
        TIN vertices + triangles + provider provenance + validation issues.
        ``vertices`` is empty when the project's CRS has no DEM provider
        (``provider_id = "none"``) or the model has no in-scope
        investigations with known (x, y).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(503)
        When the WCS endpoint is unreachable or returns a non-2xx status
        and no cached tile exists.
    """
    logger.info(f"POST /projects/{project_id}/geology/models/{model_id}/ground-surface/build")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )

    # Resolve the project's horizontal EPSG to select the DEM provider.
    # We read the project row directly here — the project ORM is already
    # pulled in by the session for the scope guard above.

    project_row = await session.get(ProjectOrm, project_id)
    epsg: int = (
        project_row.default_horizontal_epsg
        if project_row is not None and project_row.default_horizontal_epsg is not None
        else 31370  # default to Belgian Lambert when not set
    )

    try:
        provider = build_dem_provider(
            epsg,
            settings.dem_cache_dir,
            max_cache_bytes=settings.dem_cache_max_bytes
            if settings.dem_cache_max_bytes > 0
            else None,
        )
    except NoDemProviderError:
        logger.info(
            f"ground-surface build: no DEM provider for EPSG:{epsg} "
            f"(project={project_id}) — returning empty surface"
        )
        return GroundSurfaceBuildResponse(
            vertices=[],
            triangles=[],
            provider_id="none",
            from_cache=False,
            issues=[],
        )

    # Manual bed-level overrides (owner ruling 2026-09-06): inside a bed
    # polygon the 3D ground surface reads the drawn bed level instead of the
    # DEM's water surface. Empty list → the surface is on the raw DEM as before.
    bed_overrides = await load_bed_override_polygons(session, project_id)

    try:
        async with provider:
            result = await BuildGroundSurface(
                session, provider, bed_overrides=bed_overrides
            ).execute(project_id, model_id)
    # The model's investigation hull produced an extent that cannot be a real
    # place (coordinates outside the CRS domain, a runaway span). That is a
    # data problem in THIS model, not a DEM outage — 422 with the numbers.
    except DemExtentRefusedError as exc:
        logger.warning(
            f"ground-surface build: refused extent for model={model_id}: {exc} "
            f"(check the investigation coordinates anchoring this model)"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except DemUpstreamRecentlyFailedError as exc:
        logger.warning(f"ground-surface build: suppressed for model={model_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"ground-surface build: WCS request failed "
            f"status={exc.response.status_code} for project={project_id}: "
            f"{exc.response.text[:500]}"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"DEM provider returned HTTP {exc.response.status_code}. "
                "Check network connectivity or try again later."
            ),
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.error(f"ground-surface build: provider error for project={project_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"DEM provider error: {exc}",
        ) from exc

    logger.info(
        f"ground-surface build: model={model_id} "
        f"{len(result.vertices)} vertices {len(result.triangles)} triangles "
        f"provider={result.provider_id} from_cache={result.from_cache} "
        f"issues={len(result.issues)}"
    )
    return GroundSurfaceBuildResponse(
        vertices=[list(v) for v in result.vertices],
        triangles=[list(t) for t in result.triangles],
        provider_id=result.provider_id,
        from_cache=result.from_cache,
        issues=_to_gap_issues(result.issues),
    )
