"""DEM sampling API — elevation profile along a line.

One endpoint today: ``GET /dem/sample`` returns evenly-spaced
elevation samples between two endpoints. Used by the cross-section
panel to draw the ground-surface polyline.

Source selection: ``DHMVII`` for EPSG 31370 (Belgium). AHN
(EPSG 28992 / NL) is reserved as a sibling source — the endpoint
returns a clear 400 when called with an unsupported CRS, so the
frontend can surface "no DEM source for this project's CRS" without
having to know the mapping.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from groundmodel.api.schemas.dem import DemSampleLineResponse, DemSamplePointResponse
from groundmodel.infrastructure.dem.dhmvii_sampler import DhmviiSampler
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

    Source is auto-selected from ``epsg``:

    * 31370 (Belgian Lambert 72) → DHMVII (Flanders).
    * Any other CRS → 400 with a "no DEM source mapped" message.
      AHN slots in here once the implementation lands.

    Transport errors against the upstream provider surface as 5xx
    with the upstream type in the detail so the desktop client can
    distinguish "service down" from "bad request".
    """
    if epsg != 31370:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No DEM source mapped for EPSG:{epsg}. Supported today: "
                f"EPSG:31370 (DHMVII / Flanders)."
            ),
        )
    if start_x == end_x and start_y == end_y:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Line endpoints must be distinct (length > 0).",
        )

    try:
        async with DhmviiSampler() as sampler:
            samples = await sampler.sample_along_line(
                start_x=start_x,
                start_y=start_y,
                end_x=end_x,
                end_y=end_y,
                n_samples=n_samples,
            )
    # User-facing detail stays category-only; the specific httpx
    # exception + message lives in the server-side log (debt #43).
    except httpx.ConnectError as err:
        logger.warning(f"DHMVII connect error: {type(err).__name__}: {err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot reach DHMVII",
        ) from err
    except httpx.TimeoutException as err:
        logger.warning(f"DHMVII timeout: {type(err).__name__}: {err}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="DHMVII timed out",
        ) from err
    except (httpx.HTTPStatusError, httpx.RequestError) as err:
        logger.warning(f"DHMVII upstream error: {type(err).__name__}: {err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DHMVII responded with an error",
        ) from err
    except ValueError as err:
        # Malformed multipart from upstream — surface as 502, not 500.
        logger.warning(f"DHMVII malformed multipart: {err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DHMVII returned a malformed response",
        ) from err

    return DemSampleLineResponse(
        source="dhmvii",
        samples=[
            DemSamplePointResponse(along_m=s.along_m, elevation_m=s.elevation_m) for s in samples
        ],
    )
