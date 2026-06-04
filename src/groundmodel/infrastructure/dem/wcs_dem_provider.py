"""Shared base for WCS-backed DEM grid providers with tile caching.

The two concrete DEM providers — ``DhmviiDemProvider`` (BE/Flanders, Geopunt
WCS) and ``Ahn4DemProvider`` (NL, PDOK WCS) — run an identical pipeline:
construct an HTTP/2 ``httpx`` client, pad the bbox, serve from the disk tile
cache on a warm hit, otherwise issue a WCS ``GetCoverage`` request, extract the
GeoTIFF, cache it, and decode it (via Pillow) into a ``DemZGrid`` with NoData
cells mapped to ``None``.

This base owns that pipeline once. Subclasses declare the per-source CONSTANTS
as class attributes (WCS URL, coverage id, subset axis names, default
resolution, log label) and override the two genuine behavioural hooks:

* :meth:`_extract_tiff` — DHMVII returns multipart/related (GML + TIFF parts),
  PDOK returns a plain ``image/tiff`` body. Each pulls the raw TIFF bytes out
  of the response (and validates them) its own way.
* :meth:`_is_nodata` — DHMVII uses a ``-9999`` sentinel (equality), PDOK uses a
  ``float32``-max threshold (``>=``).

Architecture
------------
Lives in ``infrastructure/dem/`` — may import ``httpx`` + ``Pillow`` but never
``domain/`` or ``application/``. ``DemProvider`` itself is a pure ABC; concrete
providers (and so this base) inherit ``GroundModelLogger`` directly.
"""

from __future__ import annotations

from io import BytesIO
from typing import ClassVar, Self

import httpx
from PIL import Image

from groundmodel.infrastructure.dem.dem_provider import DemProvider, DemZGrid
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dem_wcs_constants import (
    WCS_BBOX_PADDING_M,
    WCS_TIMEOUT_SECONDS,
    WCS_VERSION,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class WcsDemProvider(DemProvider, GroundModelLogger):
    """Common WCS-GetCoverage + tile-cache + GeoTIFF-decode pipeline.

    Subclasses MUST set the five class attributes below and implement
    :meth:`_extract_tiff` and :meth:`_is_nodata`, plus the ``provider_id`` /
    ``native_epsg`` properties required by :class:`DemProvider`.

    Notes
    -----
    Construct once and reuse within a request — the underlying
    ``httpx.AsyncClient`` keeps connections warm (HTTP/2 multiplexing). Use as
    an async context manager or call :meth:`close` explicitly.
    """

    # --- per-source declarations (subclasses MUST set) ---
    #: WCS service endpoint URL.
    WCS_URL: ClassVar[str]
    #: WCS ``coverageId`` for the DTM coverage.
    COVERAGE_ID: ClassVar[str]
    #: Subset axis names (x_axis, y_axis) — ``("X", "Y")`` for Lambert72,
    #: ``("E", "N")`` for RD New (PDOK WCS 2.0 axis-naming quirk).
    AXIS_NAMES: ClassVar[tuple[str, str]]
    #: Native cell size in metres, used when the caller omits ``resolution_m``.
    DEFAULT_RESOLUTION_M: ClassVar[float]
    #: Short label for log lines (e.g. ``"DHMVII"`` / ``"AHN4 PDOK"``).
    LOG_LABEL: ClassVar[str]

    def __init__(self, cache: DemTileCache) -> None:
        """Initialise the logger (named after the concrete module) and HTTP client.

        Parameters
        ----------
        cache : DemTileCache
            Pre-constructed cache bound to this provider's id. The caller
            manages cache lifetime (typically a singleton injected from the
            application use case).
        """
        GroundModelLogger.__init__(self, self.__class__.__module__)
        self._cache = cache
        self._client = httpx.AsyncClient(
            http2=True,
            follow_redirects=True,
            timeout=WCS_TIMEOUT_SECONDS,
        )

    async def __aenter__(self) -> Self:
        """Context-manager entry — returns self unchanged."""
        return self

    async def __aexit__(self, *_exc: object) -> None:
        """Close the underlying httpx client on context exit."""
        await self._client.aclose()

    async def close(self) -> None:
        """Explicit close for callers that don't use the context manager."""
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Per-source behavioural hooks — subclasses override.
    # ------------------------------------------------------------------

    def _extract_tiff(self, content: bytes) -> bytes:
        """Pull the raw GeoTIFF bytes out of a WCS response body.

        DHMVII returns multipart/related (parse out the TIFF part); PDOK returns
        a plain ``image/tiff`` body (validate the magic bytes, pass through).

        Parameters
        ----------
        content : bytes
            The raw WCS response body.

        Returns
        -------
        bytes
            The GeoTIFF blob, ready to cache + decode.
        """
        raise NotImplementedError

    def _is_nodata(self, value: float) -> bool:
        """Return ``True`` when a decoded pixel value is this source's NoData.

        Parameters
        ----------
        value : float
            A decoded pixel elevation.

        Returns
        -------
        bool
            ``True`` for a NoData cell (mapped to ``None`` in the grid).
        """
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Shared pipeline.
    # ------------------------------------------------------------------

    async def fetch_grid(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float | None = None,
    ) -> DemZGrid:
        """Return a DEM grid tile over the given bbox, using the disk cache.

        Cache hit: deserialises the stored GeoTIFF. Cache miss: fetches from the
        WCS, extracts + caches the TIFF, then deserialises.

        Parameters
        ----------
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            Tile extents in the provider's native CRS (metres).
        resolution_m : float | None, optional
            Cell size in metres. ``None`` (default) uses the provider's native
            ``DEFAULT_RESOLUTION_M``. Stored on the grid as metadata; the WCS
            server returns its native resolution regardless.

        Returns
        -------
        DemZGrid
            Grid with ``from_cache=True`` on a warm hit.

        Raises
        ------
        httpx.HTTPError
            On network transport failures.
        ValueError
            When the WCS response carries no decodable GeoTIFF (server
            ExceptionReport — bbox outside coverage, invalid params, etc.).
        """
        res = self.DEFAULT_RESOLUTION_M if resolution_m is None else resolution_m
        self.debug(
            f"{self.LOG_LABEL} grid request: "
            f"bbox=({bbox_min_x:.1f},{bbox_min_y:.1f})→({bbox_max_x:.1f},{bbox_max_y:.1f}) "
            f"res={res}m"
        )

        # Pad so edge pixels always have a bilinear neighbour inside the tile.
        padded_min_x = bbox_min_x - WCS_BBOX_PADDING_M
        padded_min_y = bbox_min_y - WCS_BBOX_PADDING_M
        padded_max_x = bbox_max_x + WCS_BBOX_PADDING_M
        padded_max_y = bbox_max_y + WCS_BBOX_PADDING_M

        cached = self._cache.get(padded_min_x, padded_min_y, padded_max_x, padded_max_y, res)
        if cached is not None:
            self.debug(f"{self.LOG_LABEL} tile cache: warm hit ({len(cached)} B)")
            return self._decode_tiff(
                cached, padded_min_x, padded_min_y, padded_max_x, padded_max_y, from_cache=True
            )

        x_axis, y_axis = self.AXIS_NAMES
        params = {
            "service": "WCS",
            "version": WCS_VERSION,
            "request": "GetCoverage",
            "coverageId": self.COVERAGE_ID,
            "subset": [
                f"{x_axis}({padded_min_x:.3f},{padded_max_x:.3f})",
                f"{y_axis}({padded_min_y:.3f},{padded_max_y:.3f})",
            ],
            "format": "image/tiff",
        }
        self.debug(
            f"{self.LOG_LABEL} WCS GetCoverage: "
            f"{x_axis}({padded_min_x:.3f},{padded_max_x:.3f}) "
            f"{y_axis}({padded_min_y:.3f},{padded_max_y:.3f})"
        )
        resp = await self._client.get(self.WCS_URL, params=params)
        self.debug(
            f"{self.LOG_LABEL} WCS response: status={resp.status_code} size={len(resp.content)} B"
        )
        resp.raise_for_status()

        tiff_bytes = self._extract_tiff(resp.content)
        self.debug(f"{self.LOG_LABEL} WCS: TIFF blob {len(tiff_bytes)} B")

        self._cache.put(padded_min_x, padded_min_y, padded_max_x, padded_max_y, res, tiff_bytes)

        grid = self._decode_tiff(
            tiff_bytes, padded_min_x, padded_min_y, padded_max_x, padded_max_y, from_cache=False
        )
        self.success(
            f"{self.LOG_LABEL} grid fetched: {grid.n_cols}×{grid.n_rows} px, "
            f"res={grid.resolution_m:.2f}m, "
            f"none_cells={sum(1 for v in grid.values if v is None)}"
        )
        return grid

    def _decode_tiff(
        self,
        tiff_bytes: bytes,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        *,
        from_cache: bool,
    ) -> DemZGrid:
        """Decode a GeoTIFF blob into a ``DemZGrid``.

        Pillow reads the pixel values; pixel size is derived from the bbox and
        TIFF dimensions (the WCS server returns integer-pixel rectangles so the
        size is exact). The per-source NoData test (:meth:`_is_nodata`) maps
        sentinel cells to ``None``.

        Parameters
        ----------
        tiff_bytes : bytes
            Raw GeoTIFF content from the WCS response or cache.
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            The (padded) bbox the TIFF was requested for.
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
                resolution_m=self.DEFAULT_RESOLUTION_M,
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
                raw.append(None if self._is_nodata(v) else v)

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
