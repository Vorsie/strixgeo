"""DHMVII (Flanders) DEM provider — WCS grid sampler with tile cache.

Fetches tiles from the Geopunt WCS at ``geo.api.vlaanderen.be/DHMV/wcs``
(coverage ``DHMVII_DTM_1m``, native CRS EPSG:31370 Lambert72, 1 m LiDAR
DTM).  The WCS request shape, multipart response parsing, and GeoTIFF
decoding are carried over from the cross-section sampler
(``dhmvii_sampler.py``) and adapted for 2D grid output rather than 1D
line profiles.

Tile cache
----------
Tiles are cached on disk via ``DemTileCache`` (keyed by bbox + resolution).
A cold tile triggers one WCS fetch; subsequent requests for the same bbox
are served from disk.  Cache directory = ``<userData>/dem-cache/`` (same
root as the DOV XML cache).  The caller is responsible for injecting the
correct root directory.

Water-body confidence
---------------------
DHMVII reports the **water surface** over rivers and canals (Schelde,
Albertkanaal, …) — not the bed.  The grid has no built-in flag for water
cells.  The provider marks every NoData cell (DHMVII reports −9999.0 in
those pixels) as ``None`` in ``DemZGrid.values``; the clip domain service
emits a ValidationIssue for any TIN vertex that lands on a ``None`` cell
near a formation contact to signal potential water-surface contamination.
This is the §11.4 documented approach — per-waterway bed data is out of
G7 scope.

WCS endpoint (verified live 2026-05-11 and cross-checked against the
cross-section sampler's production use):

    GET https://geo.api.vlaanderen.be/DHMV/wcs
        ?service=WCS&version=2.0.1
        &request=GetCoverage
        &coverageId=DHMVII_DTM_1m
        &subset=X(min,max)&subset=Y(min,max)
        &format=image/tiff

Response: multipart/related — GML metadata part then ``image/tiff`` part.
The parsing helper ``parse_wcs_multipart`` from ``dhmvii_sampler`` is
imported directly; the TIFF blob is then decoded by Pillow.
"""

from __future__ import annotations

from io import BytesIO

import httpx
from PIL import Image

from groundmodel.infrastructure.dem.dem_provider import DemProvider, DemZGrid
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dem_wcs_constants import (
    DHMVII_COVERAGE_ID,
    DHMVII_NODATA,
    DHMVII_WCS_URL,
    WCS_BBOX_PADDING_M,
    WCS_TIMEOUT_SECONDS,
    WCS_VERSION,
)
from groundmodel.infrastructure.dem.dhmvii_sampler import parse_wcs_multipart
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DhmviiDemProvider(DemProvider, GroundModelLogger):
    """Async WCS client for DHMVII II (BE/Flanders) with tile-level caching.

    Parameters
    ----------
    cache : DemTileCache
        Pre-constructed cache bound to the DHMVII provider id.  The caller
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

    async def __aenter__(self) -> DhmviiDemProvider:
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
            ``"dhmvii"``.
        """
        return "dhmvii"

    @property
    def native_epsg(self) -> int:
        """Provider's native CRS.

        Returns
        -------
        int
            31370 (EPSG:31370 — BD72 / Belgian Lambert 1972).
        """
        return 31370

    async def fetch_grid(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float = 1.0,
    ) -> DemZGrid:
        """Return a DEM grid tile over the given bbox, using the disk cache.

        Cache hit: deserialises the stored GeoTIFF from disk.
        Cache miss: fetches from the DHMVII WCS, writes to cache, then
        deserialises.

        Parameters
        ----------
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            Tile extents in EPSG:31370 (metres).
        resolution_m : float, optional
            Cell size in metres, default 1 m (the DHMVII native resolution).
            Passed as metadata — the WCS server always returns its native
            1 m resolution regardless; the value is stored on the grid for
            the clip rule's awareness.

        Returns
        -------
        DemZGrid
            Grid with ``from_cache=True`` on a warm hit.

        Raises
        ------
        httpx.HTTPError
            On network transport failures.
        ValueError
            When the WCS response has no image/tiff part (server
            ExceptionReport — bbox outside Flanders, invalid params, etc.).
        """
        self.debug(
            f"DHMVII grid request: "
            f"bbox=({bbox_min_x:.1f},{bbox_min_y:.1f})→({bbox_max_x:.1f},{bbox_max_y:.1f}) "
            f"res={resolution_m}m"
        )

        # Add padding so edge pixels have a bilinear neighbour.
        padded_min_x = bbox_min_x - WCS_BBOX_PADDING_M
        padded_min_y = bbox_min_y - WCS_BBOX_PADDING_M
        padded_max_x = bbox_max_x + WCS_BBOX_PADDING_M
        padded_max_y = bbox_max_y + WCS_BBOX_PADDING_M

        cached = self._cache.get(
            padded_min_x, padded_min_y, padded_max_x, padded_max_y, resolution_m
        )
        if cached is not None:
            self.debug(f"DHMVII tile cache: warm hit ({len(cached)} B)")
            return _decode_tiff(
                cached,
                padded_min_x,
                padded_min_y,
                padded_max_x,
                padded_max_y,
                from_cache=True,
            )

        params = {
            "service": "WCS",
            "version": WCS_VERSION,
            "request": "GetCoverage",
            "coverageId": DHMVII_COVERAGE_ID,
            "subset": [
                f"X({padded_min_x:.3f},{padded_max_x:.3f})",
                f"Y({padded_min_y:.3f},{padded_max_y:.3f})",
            ],
            "format": "image/tiff",
        }
        self.debug(
            f"DHMVII WCS GetCoverage: "
            f"X({padded_min_x:.3f},{padded_max_x:.3f}) "
            f"Y({padded_min_y:.3f},{padded_max_y:.3f})"
        )
        resp = await self._client.get(DHMVII_WCS_URL, params=params)
        self.debug(f"DHMVII WCS response: status={resp.status_code} size={len(resp.content)} B")
        resp.raise_for_status()

        tiff_bytes = parse_wcs_multipart(resp.content)
        self.debug(f"DHMVII WCS: TIFF blob {len(tiff_bytes)} B")

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
            f"DHMVII grid fetched: {grid.n_cols}×{grid.n_rows} px, "
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
    """Decode a GeoTIFF blob into a ``DemZGrid``.

    Uses Pillow to read the pixel values; derives pixel size from the bbox
    and TIFF dimensions (the WCS server returns integer-pixel rectangles so
    the size is always exact).  NoData sentinel (−9999) is mapped to
    ``None``.

    Parameters
    ----------
    tiff_bytes : bytes
        Raw GeoTIFF content from the WCS response or cache.
    bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
        The bbox the TIFF was requested for (padded bbox).
    from_cache : bool
        Propagated to ``DemZGrid.from_cache``.

    Returns
    -------
    DemZGrid
        Decoded grid.
    """
    img = Image.open(BytesIO(tiff_bytes))
    n_cols, n_rows = img.size  # Pillow: (width, height)

    if n_cols == 0 or n_rows == 0:
        return DemZGrid(
            bbox_min_x=bbox_min_x,
            bbox_min_y=bbox_min_y,
            bbox_max_x=bbox_max_x,
            bbox_max_y=bbox_max_y,
            resolution_m=1.0,
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
            raw.append(None if v == DHMVII_NODATA else v)

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
