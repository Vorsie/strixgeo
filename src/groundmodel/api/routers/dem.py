"""DEM sampling API — elevation profile along a line.

One endpoint today: ``GET /dem/sample`` returns evenly-spaced
elevation samples between two endpoints. Used by the cross-section
panel to draw the ground-surface polyline.

Source selection rides the provider factory (#234): EPSG 31370 →
DHMVII (BE/Flanders), EPSG 28992 → AHN4 (NL) — the same stack the
ground-surface build uses, including the disk tile cache, so
re-opening a section serves its strip from disk. An unsupported CRS
returns a clear 400 so the frontend can surface "no DEM source for
this project's CRS" without knowing the mapping.
"""

from __future__ import annotations

from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.dem import DemSampleLineResponse, DemSamplePointResponse
from groundmodel.application.load_bed_overrides import load_bed_override_polygons
from groundmodel.domain.services.bed_override import bed_level_at
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

router = APIRouter(prefix="/dem", tags=["dem"])

# Maximum samples per request — guards against malicious / runaway
# requests asking for 10⁶-point profiles. 2000 is enough for any
# realistic screen-pixel density on a 4K monitor.
_MAX_SAMPLES = 2000


@router.get("/sample", response_model=DemSampleLineResponse)
async def sample_along_line(
    start_x: float = Query(..., description="Line start X in the project CRS."),
    start_y: float = Query(..., description="Line start Y in the project CRS."),
    end_x: float = Query(..., description="Line end X in the project CRS."),
    end_y: float = Query(..., description="Line end Y in the project CRS."),
    epsg: int = Query(..., description="EPSG of the endpoint coordinates."),
    n_samples: int = Query(200, ge=2, le=_MAX_SAMPLES),
    project_id: UUID | None = Query(
        None,
        description=(
            "Optional project scope. When given, the project's manual bed-level "
            "overrides are applied — a sample inside a bed polygon reads the bed "
            "level instead of the DEM, so the section line shows the dredged bed "
            "where the section crosses the polygon (owner ruling 2026-09-06)."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> DemSampleLineResponse:
    """Return ``n_samples`` evenly-spaced elevations along the requested line.

    Source is auto-selected from ``epsg`` via the DEM provider
    factory:

    * 31370 (Belgian Lambert 72) → DHMVII (Flanders).
    * 28992 (Amersfoort / RD New) → AHN4 (Netherlands).
    * Any other CRS → 400 with a "no DEM provider" message.

    Transport errors against the upstream provider surface as 5xx
    with a category-only detail so the desktop client can distinguish
    "service down" from "bad request".

    Parameters
    ----------
    start_x : float
        Line start X in the project CRS.
    start_y : float
        Line start Y in the project CRS.
    end_x : float
        Line end X in the project CRS.
    end_y : float
        Line end Y in the project CRS.
    epsg : int
        EPSG of the endpoint coordinates; selects the DEM provider.
    n_samples : int
        Number of evenly-spaced samples to return (default 200, clamped to
        ``2 <= n_samples <= _MAX_SAMPLES``).

    Returns
    -------
    DemSampleLineResponse
        The selected provider id plus ``n_samples`` points, each carrying
        its along-line distance and sampled elevation.

    Raises
    ------
    HTTPException(400)
        When ``epsg`` has no DEM provider (``NoDemProviderError``), or the
        two endpoints are identical (zero-length line).
    HTTPException(422)
        When the line's extent cannot be a real place in the project CRS —
        origin-anchored / section-space coordinates, a non-finite bound, or a
        span beyond the per-tile cap. The refused extent is named in the
        detail; no upstream request is made.
    HTTPException(502)
        When the upstream provider returns an error or a malformed /
        non-TIFF response.
    HTTPException(503)
        When the DEM service is unreachable (connection error).
    HTTPException(504)
        When the DEM request times out.
    """
    try:
        provider = build_dem_provider(
            epsg,
            settings.dem_cache_dir,
            max_cache_bytes=settings.dem_cache_max_bytes,
        )
    except NoDemProviderError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        ) from err
    if start_x == end_x and start_y == end_y:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Line endpoints must be distinct (length > 0).",
        )

    try:
        async with provider as p:
            samples = await p.sample_along_line(
                start_x=start_x,
                start_y=start_y,
                end_x=end_x,
                end_y=end_y,
                n_samples=n_samples,
            )
    # An impossible extent is the CALLER's bug, not the DEM service's — say so
    # with the numbers, at 422, so the next occurrence is diagnosable from the
    # response alone instead of looking like an upstream outage.
    except DemExtentRefusedError as err:
        logger.warning(f"DEM sample refused: {err}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except DemUpstreamRecentlyFailedError as err:
        logger.warning(f"DEM sample suppressed: {err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(err),
        ) from err
    # User-facing detail stays category-only; the specific httpx
    # exception + message lives in the server-side log (debt #43).
    except httpx.ConnectError as err:
        logger.warning(f"DEM provider connect error: {type(err).__name__}: {err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot reach the DEM service",
        ) from err
    except httpx.TimeoutException as err:
        logger.warning(f"DEM provider timeout: {type(err).__name__}: {err}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="DEM service timed out",
        ) from err
    except (httpx.HTTPStatusError, httpx.RequestError) as err:
        logger.warning(f"DEM provider upstream error: {type(err).__name__}: {err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DEM service responded with an error",
        ) from err
    except ValueError as err:
        # Malformed multipart / non-TIFF from upstream — 502, not 500.
        logger.warning(f"DEM provider malformed response: {err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DEM service returned a malformed response",
        ) from err

    # Apply the project's manual bed-level overrides, if a project was named.
    # A sample whose (x, y) falls inside a bed polygon reads the drawn bed
    # level instead of the DEM's water surface — that is what makes the section
    # DEM line show the bed where the section crosses the polygon.
    bed_overrides = (
        await load_bed_override_polygons(session, project_id) if project_id is not None else []
    )
    if bed_overrides:
        # Each sample sits at fraction (along / line length) along the line; the
        # provider samples the same evenly-spaced points, so recover (x, y)
        # from the along-distance to test polygon membership.
        line_length = ((end_x - start_x) ** 2 + (end_y - start_y) ** 2) ** 0.5
        adjusted: list[DemSamplePointResponse] = []
        for s in samples:
            frac = (s.along_m / line_length) if line_length > 0 else 0.0
            x = start_x + frac * (end_x - start_x)
            y = start_y + frac * (end_y - start_y)
            level = bed_level_at(bed_overrides, x, y)
            elevation = level if level is not None else s.elevation_m
            adjusted.append(DemSamplePointResponse(along_m=s.along_m, elevation_m=elevation))
        logger.info(
            f"DEM sample: applied {len(bed_overrides)} bed override(s) for project {project_id}"
        )
        return DemSampleLineResponse(source=provider.provider_id, samples=adjusted)

    return DemSampleLineResponse(
        source=provider.provider_id,
        samples=[
            DemSamplePointResponse(along_m=s.along_m, elevation_m=s.elevation_m) for s in samples
        ],
    )
