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

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from groundmodel.api.schemas.dem import DemSampleLineResponse, DemSamplePointResponse
from groundmodel.infrastructure.dem.dem_provider_factory import (
    NoDemProviderError,
    build_dem_provider,
)
from groundmodel.shared.config import settings
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

    return DemSampleLineResponse(
        source=provider.provider_id,
        samples=[
            DemSamplePointResponse(along_m=s.along_m, elevation_m=s.elevation_m) for s in samples
        ],
    )
