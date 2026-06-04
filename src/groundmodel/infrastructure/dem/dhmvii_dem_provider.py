"""DHMVII (Flanders) DEM provider — WCS grid sampler with tile cache.

Fetches tiles from the Geopunt WCS at ``geo.api.vlaanderen.be/DHMV/wcs``
(coverage ``DHMVII_DTM_1m``, native CRS EPSG:31370 Lambert72, 1 m LiDAR DTM).
The shared WCS-GetCoverage + tile-cache + GeoTIFF-decode pipeline lives in
:class:`WcsDemProvider`; this module supplies only the DHMVII-specific
constants and the two behavioural hooks (multipart TIFF extraction +
``-9999`` NoData sentinel).

Water-body confidence
---------------------
DHMVII reports the **water surface** over rivers and canals (Schelde,
Albertkanaal, …) — not the bed. NoData cells (DHMVII reports −9999.0) are
mapped to ``None``; the clip domain service emits a ValidationIssue for any
TIN vertex landing on a ``None`` cell near a formation contact. This is the
§11.4 documented approach — per-waterway bed data is out of G7 scope.

WCS endpoint (verified live 2026-05-11):

    GET https://geo.api.vlaanderen.be/DHMV/wcs
        ?service=WCS&version=2.0.1&request=GetCoverage
        &coverageId=DHMVII_DTM_1m
        &subset=X(min,max)&subset=Y(min,max)&format=image/tiff

Response: multipart/related — GML metadata part then ``image/tiff`` part,
split by ``parse_wcs_multipart``.
"""

from __future__ import annotations

from groundmodel.infrastructure.dem.dem_wcs_constants import (
    DHMVII_COVERAGE_ID,
    DHMVII_NODATA,
    DHMVII_WCS_URL,
)
from groundmodel.infrastructure.dem.dhmvii_sampler import parse_wcs_multipart
from groundmodel.infrastructure.dem.wcs_dem_provider import WcsDemProvider


class DhmviiDemProvider(WcsDemProvider):
    """Async WCS client for DHMVII II (BE/Flanders) with tile-level caching."""

    WCS_URL = DHMVII_WCS_URL
    COVERAGE_ID = DHMVII_COVERAGE_ID
    AXIS_NAMES = ("X", "Y")
    DEFAULT_RESOLUTION_M = 1.0
    LOG_LABEL = "DHMVII"

    @property
    def provider_id(self) -> str:
        """Cache sub-directory name — ``"dhmvii"``."""
        return "dhmvii"

    @property
    def native_epsg(self) -> int:
        """Native CRS — 31370 (BD72 / Belgian Lambert 1972)."""
        return 31370

    def _extract_tiff(self, content: bytes) -> bytes:
        """Pull the ``image/tiff`` part out of DHMVII's multipart/related body."""
        return parse_wcs_multipart(content)

    def _is_nodata(self, value: float) -> bool:
        """DHMVII reports −9999.0 for NoData cells (sentinel equality)."""
        return value == DHMVII_NODATA
