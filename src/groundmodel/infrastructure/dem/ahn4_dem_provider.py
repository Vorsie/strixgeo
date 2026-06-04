"""AHN4 (Netherlands) DEM provider — PDOK WCS grid sampler with tile cache.

Fetches tiles from the PDOK WCS at ``service.pdok.nl/rws/ahn/wcs/v1_0``
(coverage ``dtm_05m``, native CRS EPSG:28992 RD New, 0.5 m LiDAR DTM). The
AHN4 DTM excludes vegetation and buildings — it represents the bare ground, or
the **water surface** over rivers/canals (same §11.4 limitation as DHMVII).

The shared WCS-GetCoverage + tile-cache + GeoTIFF-decode pipeline lives in
:class:`WcsDemProvider`; this module supplies only the AHN4-specific constants
and the two behavioural hooks (plain-body TIFF validation + ``float32``-max
NoData threshold).

PDOK WCS endpoint:

    GET https://service.pdok.nl/rws/ahn/wcs/v1_0
        ?service=WCS&version=2.0.1&request=GetCoverage
        &coverageId=dtm_05m
        &subset=E(min,max)&subset=N(min,max)&format=image/tiff

Response: single-body GeoTIFF (no multipart envelope). NoData =
``3.4028234663852886e+38`` (IEEE 754 float32 max) for cells outside coverage or
over permanent water.

Axis naming
-----------
PDOK WCS 2.0 uses ``E`` (Easting) / ``N`` (Northing) as the subset axis names
for EPSG:28992 — a well-known OGC WCS 2.0 quirk where axis names come from the
CRS definition rather than the conventional "X first" order. The coordinate
order in the subset expression is still (min, max), matching the X/Y
convention in Belgian Lambert.
"""

from __future__ import annotations

from groundmodel.infrastructure.dem.dem_wcs_constants import (
    AHN4_COVERAGE_ID,
    AHN4_NODATA_THRESHOLD,
    AHN4_WCS_URL,
)
from groundmodel.infrastructure.dem.wcs_dem_provider import WcsDemProvider


class Ahn4DemProvider(WcsDemProvider):
    """Async WCS client for AHN4 DTM (NL) with tile-level caching."""

    WCS_URL = AHN4_WCS_URL
    COVERAGE_ID = AHN4_COVERAGE_ID
    AXIS_NAMES = ("E", "N")
    DEFAULT_RESOLUTION_M = 0.5
    LOG_LABEL = "AHN4 PDOK"

    @property
    def provider_id(self) -> str:
        """Cache sub-directory name — ``"ahn4"``."""
        return "ahn4"

    @property
    def native_epsg(self) -> int:
        """Native CRS — 28992 (Amersfoort / RD New)."""
        return 28992

    def _extract_tiff(self, content: bytes) -> bytes:
        """Validate + pass through PDOK's plain GeoTIFF body.

        PDOK returns the TIFF directly (no multipart envelope). A non-TIFF body
        is almost always an OWS ExceptionReport (XML) — surface a clear error.
        """
        if content[:2] not in (b"II", b"MM"):
            raise ValueError(
                f"AHN4 WCS response is not a GeoTIFF (first 2 bytes: {content[:2]!r}). "
                "The bbox may be outside the AHN4 coverage area (Netherlands only)."
            )
        return content

    def _is_nodata(self, value: float) -> bool:
        """PDOK uses the float32-max sentinel for NoData (threshold compare)."""
        return value >= AHN4_NODATA_THRESHOLD
