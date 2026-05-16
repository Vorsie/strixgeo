"""AHN4 (Netherlands) DEM provider — PDOK WCS grid sampler with tile cache.

Fetches tiles from the PDOK WCS at ``service.pdok.nl/rws/ahn/wcs/v1_0``
(coverage ``dtm_05m``, native CRS EPSG:28992 RD New, 0.5 m LiDAR DTM).
The AHN4 DTM (Digital Terrain Model) excludes vegetation and buildings —
it represents the bare ground, or the **water surface** over rivers/canals
(same limitation as DHMVII, same §11.4 documented approach).

PDOK WCS endpoint (verified against the PDOK service documentation and
the WCS GetCapabilities response):

    GET https://service.pdok.nl/rws/ahn/wcs/v1_0
        ?service=WCS&version=2.0.1
        &request=GetCoverage
        &coverageId=dtm_05m
        &subset=E(min,max)&subset=N(min,max)
        &format=image/tiff

Response format: single-body GeoTIFF (unlike DHMVII's multipart/related).
PDOK returns a plain ``image/tiff`` body without a multipart envelope.
NoData: ``3.4028234663852886e+38`` (IEEE 754 float32 max — PDOK uses this
sentinel for cells outside the AHN4 coverage or over permanent water).

Axis naming
-----------
PDOK WCS 2.0 uses ``E`` (Easting) and ``N`` (Northing) as the subset axis
names for EPSG:28992, not ``X`` and ``Y``.  This is a well-known quirk of
the OGC WCS 2.0 spec where axis names come from the CRS definition rather
than the conventional "X first" order.  The actual coordinate order in the
subset expression is still (min_easting, max_easting) and (min_northing,
max_northing), which is the same as the X/Y convention in Belgian Lambert.
"""

from __future__ import annotations

from io import BytesIO

import httpx
from PIL import Image

from groundmodel.infrastructure.dem.dem_provider import DemProvider, DemZGrid
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dem_wcs_constants import (
    AHN4_COVERAGE_ID,
    AHN4_NODATA_THRESHOLD,
    AHN4_WCS_URL,
    WCS_BBOX_PADDING_M,
    WCS_TIMEOUT_SECONDS,
    WCS_VERSION,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class Ahn4DemProvider(DemProvider, GroundModelLogger):
    """Async WCS client for AHN4 DTM (NL) with tile-level caching.

    Parameters
    ----------
    cache : DemTileCache
        Pre-constructed cache bound to the AHN4 provider id.  The caller
        manages cache lifetime (typically a singleton injected from the
        application use case).

    Notes
    -----
    Construct once and reuse within a request — the underlying
    ``httpx.AsyncClient`` keeps connections warm (HTTP/2 multiplexing).
    Use as an async context manager or call ``close()`` explicitly.
    """

    def __init__(self, cache: DemTileCache) -> None:
        """Initialise the logger and the underlying HTTP client."""
        GroundModelLogger.__init__(self, __name__)
        self._cache = cache
        self._client = httpx.AsyncClient(
            http2=True,
            follow_redirects=True,
            timeout=WCS_TIMEOUT_SECONDS,
        )

    async def __aenter__(self) -> Ahn4DemProvider:
        """Context-manager entry — returns self unchanged."""
        return self

    async def __aexit__(self, *_exc: object) -> None:
        """Close the underlying httpx client on context exit."""
        await self._client.aclose()

    async def close(self) -> None:
        """Explicit close for callers that don't use the context manager."""
        await self._client.aclose()

    @property
    def provider_id(self) -> str:
        """Short identifier used as the cache sub-directory name.

        Returns
        -------
        str
            ``"ahn4"``.
        """
        return "ahn4"

    @property
    def native_epsg(self) -> int:
        """Provider's native CRS.

        Returns
        -------
        int
            28992 (EPSG:28992 — Amersfoort / RD New).
        """
        return 28992

    async def fetch_grid(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float = 0.5,
    ) -> DemZGrid:
        """Return an AHN4 DEM grid tile over the given bbox.

        Cache hit: deserialises the stored GeoTIFF from disk.
        Cache miss: fetches from the AHN4 PDOK WCS, writes to cache.

        Parameters
        ----------
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            Tile extents in EPSG:28992 (metres).
        resolution_m : float, optional
            Cell size in metres, default 0.5 m (AHN4 native resolution).

        Returns
        -------
        DemZGrid
            Grid with ``from_cache=True`` on a warm hit.

        Raises
        ------
        httpx.HTTPError
            On network transport failures.
        ValueError
            When the response body cannot be decoded as a valid GeoTIFF.
        """
        self.debug(
            f"AHN4 grid request: "
            f"bbox=({bbox_min_x:.1f},{bbox_min_y:.1f})→({bbox_max_x:.1f},{bbox_max_y:.1f}) "
            f"res={resolution_m}m"
        )

        padded_min_x = bbox_min_x - WCS_BBOX_PADDING_M
        padded_min_y = bbox_min_y - WCS_BBOX_PADDING_M
        padded_max_x = bbox_max_x + WCS_BBOX_PADDING_M
        padded_max_y = bbox_max_y + WCS_BBOX_PADDING_M

        cached = self._cache.get(
            padded_min_x, padded_min_y, padded_max_x, padded_max_y, resolution_m
        )
        if cached is not None:
            self.debug(f"AHN4 tile cache: warm hit ({len(cached)} B)")
            return _decode_tiff(
                cached,
                padded_min_x,
                padded_min_y,
                padded_max_x,
                padded_max_y,
                from_cache=True,
            )

        # PDOK WCS 2.0 uses E/N axis names for EPSG:28992.
        params = {
            "service": "WCS",
            "version": WCS_VERSION,
            "request": "GetCoverage",
            "coverageId": AHN4_COVERAGE_ID,
            "subset": [
                f"E({padded_min_x:.3f},{padded_max_x:.3f})",
                f"N({padded_min_y:.3f},{padded_max_y:.3f})",
            ],
            "format": "image/tiff",
        }
        self.debug(
            f"AHN4 PDOK WCS GetCoverage: "
            f"E({padded_min_x:.3f},{padded_max_x:.3f}) "
            f"N({padded_min_y:.3f},{padded_max_y:.3f})"
        )
        resp = await self._client.get(AHN4_WCS_URL, params=params)
        self.debug(f"AHN4 PDOK WCS response: status={resp.status_code} size={len(resp.content)} B")
        resp.raise_for_status()

        # PDOK returns a plain GeoTIFF body (not multipart).
        tiff_bytes = resp.content
        if tiff_bytes[:2] not in (b"II", b"MM"):
            # Likely an OWS ExceptionReport (XML).  Surface a clear error.
            raise ValueError(
                f"AHN4 WCS response is not a GeoTIFF (first 2 bytes: {tiff_bytes[:2]!r}). "
                "The bbox may be outside the AHN4 coverage area (Netherlands only)."
            )
        self.debug(f"AHN4 PDOK WCS: plain GeoTIFF {len(tiff_bytes)} B")

        self._cache.put(
            padded_min_x, padded_min_y, padded_max_x, padded_max_y, resolution_m, tiff_bytes
        )

        grid = _decode_tiff(
            tiff_bytes,
            padded_min_x,
            padded_min_y,
            padded_max_x,
            padded_max_y,
            from_cache=False,
        )
        self.success(
            f"AHN4 grid fetched: {grid.n_cols}×{grid.n_rows} px, "
            f"res={grid.resolution_m:.2f}m, "
            f"none_cells={sum(1 for v in grid.values if v is None)}"
        )
        return grid


def _decode_tiff(
    tiff_bytes: bytes,
    bbox_min_x: float,
    bbox_min_y: float,
    bbox_max_x: float,
    bbox_max_y: float,
    *,
    from_cache: bool,
) -> DemZGrid:
    """Decode a plain GeoTIFF blob into a ``DemZGrid``.

    Parameters
    ----------
    tiff_bytes : bytes
        Raw GeoTIFF bytes from the WCS or cache.
    bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
        The padded bbox the TIFF was requested for.
    from_cache : bool
        Propagated to ``DemZGrid.from_cache``.

    Returns
    -------
    DemZGrid
        Decoded elevation grid with AHN4 NoData cells mapped to ``None``.
    """
    img = Image.open(BytesIO(tiff_bytes))
    n_cols, n_rows = img.size

    if n_cols == 0 or n_rows == 0:
        return DemZGrid(
            bbox_min_x=bbox_min_x,
            bbox_min_y=bbox_min_y,
            bbox_max_x=bbox_max_x,
            bbox_max_y=bbox_max_y,
            resolution_m=0.5,
            n_cols=0,
            n_rows=0,
            values=(),
            from_cache=from_cache,
        )

    resolution_m = (bbox_max_x - bbox_min_x) / n_cols

    raw: list[float | None] = []
    for row in range(n_rows):
        for col in range(n_cols):
            v = float(img.getpixel((col, row)))  # type: ignore[arg-type]
            raw.append(None if v >= AHN4_NODATA_THRESHOLD else v)

    return DemZGrid(
        bbox_min_x=bbox_min_x,
        bbox_min_y=bbox_min_y,
        bbox_max_x=bbox_max_x,
        bbox_max_y=bbox_max_y,
        resolution_m=resolution_m,
        n_cols=n_cols,
        n_rows=n_rows,
        values=tuple(raw),
        from_cache=from_cache,
    )
