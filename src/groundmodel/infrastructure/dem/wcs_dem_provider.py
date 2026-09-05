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

import math
from io import BytesIO
from typing import ClassVar, Self

import httpx
from PIL import Image

from groundmodel.infrastructure.dem.dem_negative_cache import (
    DEM_NEGATIVE_CACHE,
    make_tile_key,
)
from groundmodel.infrastructure.dem.dem_provider import DemProvider, DemZGrid
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dem_wcs_constants import (
    WCS_BBOX_PADDING_M,
    WCS_MAX_DECODE_PIXELS,
    WCS_MAX_EXTENT_SPAN_M,
    WCS_TIMEOUT_SECONDS,
    WCS_VERSION,
)
from groundmodel.infrastructure.dem.dhmvii_sampler import (
    SamplePoint,
    sample_geotiff_along_line,
)
from groundmodel.shared.exceptions import (
    DemExtentRefusedError,
    DemUpstreamRecentlyFailedError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _is_permanent_upstream_failure(exc: BaseException) -> bool:
    """Return True when re-asking upstream for the same tile cannot help.

    Only permanent shapes may be negative-cached (see the caller): a 4xx status
    means the coverage does not answer for this extent, and an undecodable body
    (an OWS ExceptionReport served with 200) means the same. Connection errors,
    timeouts and 5xx statuses are the failures that self-heal, so they are
    retried on the next request rather than suppressed for the TTL.

    Parameters
    ----------
    exc : BaseException
        The exception raised by the WCS round-trip or the GeoTIFF decode.

    Returns
    -------
    bool
        True for a permanent failure, False for a transient one.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return 400 <= exc.response.status_code < 500
    # ``_extract_tiff`` raises ValueError when the body carries no decodable
    # GeoTIFF. httpx.HTTPStatusError is not a ValueError, so ordering is safe.
    return isinstance(exc, ValueError)


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
    #: Plausible domain of this source's CRS as (min_x, min_y, max_x, max_y).
    #: NOT the coverage footprint — see the constants module for why.
    VALID_EXTENT: ClassVar[tuple[float, float, float, float]]
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
            Desired cell size in metres. ``None`` (the default) asks for the
            provider's native ``DEFAULT_RESOLUTION_M``, which is always honoured.
            This WCS coverage cannot resample: it serves only its native grid, so
            an EXPLICIT value other than the native one CANNOT be honoured. Rather
            than silently ignore it, the request is served at the native
            resolution, a WARNING is logged naming the requested and the native
            value, and the delivered cell size is recorded on
            ``DemZGrid.resolution_m``.

        Returns
        -------
        DemZGrid
            Grid with ``from_cache=True`` on a warm hit; ``resolution_m`` is the
            cell size actually delivered (the coverage's native grid), which may
            differ from a value the caller requested.

        Raises
        ------
        httpx.HTTPError
            On network transport failures.
        ValueError
            When the WCS response carries no decodable GeoTIFF (server
            ExceptionReport — bbox outside coverage, invalid params, etc.).
        """
        # This coverage cannot resample. An explicit resolution that is not the
        # native one cannot be met, so say so at WARNING instead of dropping the
        # request on the floor (external audit, 2026-09-05). ``None`` means "give
        # me the native grid" and is honoured silently.
        if resolution_m is not None and not math.isclose(
            resolution_m, self.DEFAULT_RESOLUTION_M, rel_tol=1e-9, abs_tol=0.0
        ):
            self.warning(
                f"{self.LOG_LABEL} cannot honour requested resolution {resolution_m} m: "
                f"this WCS coverage serves only its native {self.DEFAULT_RESOLUTION_M} m grid. "
                "Returning the native resolution; the delivered cell size is on the "
                "returned grid's resolution_m."
            )
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

        tiff_bytes, from_cache = await self._fetch_tile_tiff(
            padded_min_x, padded_min_y, padded_max_x, padded_max_y, res
        )
        grid = self._decode_tiff(
            tiff_bytes,
            padded_min_x,
            padded_min_y,
            padded_max_x,
            padded_max_y,
            from_cache=from_cache,
        )
        if not from_cache:
            self.success(
                f"{self.LOG_LABEL} grid fetched: {grid.n_cols}×{grid.n_rows} px, "
                f"res={grid.resolution_m:.2f}m, "
                f"none_cells={sum(1 for v in grid.values if v is None)}"
            )
        return grid

    async def sample_along_line(
        self,
        *,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        n_samples: int = 200,
    ) -> list[SamplePoint]:
        """Sample elevations along a line, riding the same tile cache.

        Fetches (or reads from cache) one GeoTIFF strip covering the
        line's padded envelope, then bilinear-samples the image
        directly at ``n_samples`` evenly-spaced points via the pure
        ``sample_geotiff_along_line`` helper — the full ``DemZGrid``
        decode is deliberately skipped for a 1-D profile (#234).

        Parameters
        ----------
        start_x, start_y, end_x, end_y : float
            Line endpoints in the provider's native CRS (metres).
        n_samples : int
            Number of evenly-spaced points (inclusive of endpoints).

        Returns
        -------
        list[SamplePoint]
            Profile points; ``elevation_m`` is ``None`` on NoData.

        Raises
        ------
        httpx.HTTPError
            On transport failures.
        ValueError
            On a malformed WCS response (no decodable GeoTIFF).
        """
        # Bbox = line endpoints' axis-aligned envelope + small pad.
        # Padding ensures the bilinear filter's neighbour pixels are
        # always inside the request rectangle.
        padded_min_x = min(start_x, end_x) - WCS_BBOX_PADDING_M
        padded_max_x = max(start_x, end_x) + WCS_BBOX_PADDING_M
        padded_min_y = min(start_y, end_y) - WCS_BBOX_PADDING_M
        padded_max_y = max(start_y, end_y) + WCS_BBOX_PADDING_M
        self.debug(
            f"{self.LOG_LABEL} line profile: ({start_x:.1f},{start_y:.1f})→"
            f"({end_x:.1f},{end_y:.1f}) n_samples={n_samples}"
        )

        tiff_bytes, from_cache = await self._fetch_tile_tiff(
            padded_min_x, padded_min_y, padded_max_x, padded_max_y, self.DEFAULT_RESOLUTION_M
        )
        samples = sample_geotiff_along_line(
            tiff_bytes,
            bbox_min_x=padded_min_x,
            bbox_max_x=padded_max_x,
            bbox_min_y=padded_min_y,
            bbox_max_y=padded_max_y,
            start_x=start_x,
            start_y=start_y,
            end_x=end_x,
            end_y=end_y,
            n_samples=n_samples,
            is_nodata=self._is_nodata,
        )
        self.debug(
            f"{self.LOG_LABEL} line profile: {len(samples)} sample(s) "
            f"({'cache hit' if from_cache else 'network fetch'})"
        )
        return samples

    async def _fetch_tile_tiff(
        self,
        padded_min_x: float,
        padded_min_y: float,
        padded_max_x: float,
        padded_max_y: float,
        res: float,
    ) -> tuple[bytes, bool]:
        """Cache-first GeoTIFF fetch for one padded tile bbox.

        The single WCS-GetCoverage path shared by :meth:`fetch_grid`
        (2-D tiles) and :meth:`sample_along_line` (1-D strips): disk
        cache lookup, network fetch on miss, per-source TIFF
        extraction, write-through.

        Parameters
        ----------
        padded_min_x, padded_min_y, padded_max_x, padded_max_y : float
            Already-padded tile extents in the provider's native CRS.
        res : float
            Cell size used as part of the cache key.

        Returns
        -------
        tuple[bytes, bool]
            ``(tiff_bytes, from_cache)``.

        Raises
        ------
        httpx.HTTPError
            On network transport failures / non-2xx WCS responses.
        ValueError
            When the response body carries no decodable GeoTIFF.
        DemExtentRefusedError
            When the extent cannot be a real place in this provider's CRS.
        DemUpstreamRecentlyFailedError
            When this exact tile key failed upstream within the TTL.
        """
        cached = self._cache.get(padded_min_x, padded_min_y, padded_max_x, padded_max_y, res)
        if cached is not None:
            self.debug(f"{self.LOG_LABEL} tile cache: warm hit ({len(cached)} B)")
            return cached, True

        # Everything below issues a network request, so both guards sit here:
        # a cached tile is still served for an odd-looking extent (we have the
        # bytes, the question is settled), but nothing walks to the WCS for an
        # extent that cannot exist or one that just failed.
        self._refuse_impossible_extent(padded_min_x, padded_min_y, padded_max_x, padded_max_y)

        key = make_tile_key(
            self.provider_id, padded_min_x, padded_min_y, padded_max_x, padded_max_y, res
        )
        suppressed_for = DEM_NEGATIVE_CACHE.seconds_until_retry(key)
        if suppressed_for > 0.0:
            self.warning(
                f"{self.LOG_LABEL} tile suppressed: "
                f"({padded_min_x:.1f},{padded_min_y:.1f})→({padded_max_x:.1f},{padded_max_y:.1f}) "
                f"failed upstream recently — not retrying for {suppressed_for:.0f} s"
            )
            raise DemUpstreamRecentlyFailedError(
                f"DEM tile ({padded_min_x:.1f},{padded_min_y:.1f})→"
                f"({padded_max_x:.1f},{padded_max_y:.1f}) failed upstream recently; "
                f"retrying in {suppressed_for:.0f} s",
                retry_after_seconds=suppressed_for,
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
        try:
            resp = await self._client.get(self.WCS_URL, params=params)
            self.debug(
                f"{self.LOG_LABEL} WCS response: "
                f"status={resp.status_code} size={len(resp.content)} B"
            )
            resp.raise_for_status()
            tiff_bytes = self._extract_tiff(resp.content)
        except (httpx.HTTPError, ValueError) as exc:
            # Remember the exact key so a caller that re-fires on every
            # re-mount cannot turn one bad tile into a request flood — but ONLY
            # for failures that asking again cannot fix. A dropped connection,
            # a timeout or a 5xx is exactly the failure that self-heals; a
            # 5-minute local blackout on those would answer 503 over a network
            # that is already healthy again.
            if _is_permanent_upstream_failure(exc):
                DEM_NEGATIVE_CACHE.record_failure(key)
            else:
                self.warning(
                    f"{self.LOG_LABEL} transient upstream failure "
                    f"({type(exc).__name__}: {exc}) — not suppressed, the next "
                    "request retries immediately"
                )
            raise

        self.debug(f"{self.LOG_LABEL} WCS: TIFF blob {len(tiff_bytes)} B")

        self._cache.put(padded_min_x, padded_min_y, padded_max_x, padded_max_y, res, tiff_bytes)
        return tiff_bytes, False

    def _refuse_impossible_extent(
        self,
        min_x: float,
        min_y: float,
        max_x: float,
        max_y: float,
    ) -> None:
        """Raise when this extent cannot correspond to a real place upstream.

        Three refusals, each one an extent no upstream can ever answer:

        1. a non-finite bound (NaN / inf) — arithmetic on a missing coordinate;
        2. an extent outside the CRS's own area of use — the observed
           origin-anchored strip from the 2026-08-02 dogfeed lives here;
        3. a span beyond ``WCS_MAX_EXTENT_SPAN_M`` — hundreds of megapixels,
           and always a caller bug rather than a project hull.

        A zero-height (or zero-width) extent is deliberately NOT refused: an
        exactly east–west section line has a zero-height envelope and is a
        perfectly legal request.

        Parameters
        ----------
        min_x, min_y, max_x, max_y : float
            The padded extent about to be requested.

        Raises
        ------
        DemExtentRefusedError
            With the extent echoed on the exception so the API layer can name
            the offending numbers back to the caller.
        """
        extent = (min_x, min_y, max_x, max_y)
        if not all(math.isfinite(v) for v in extent):
            self.warning(f"{self.LOG_LABEL} extent refused: non-finite bound {extent}")
            raise DemExtentRefusedError(
                f"DEM extent {extent} has a non-finite bound — the caller's "
                "coordinates are not usable",
                extent=extent,
            )

        valid_min_x, valid_min_y, valid_max_x, valid_max_y = self.VALID_EXTENT
        outside = (
            max_x < valid_min_x or min_x > valid_max_x or max_y < valid_min_y or min_y > valid_max_y
        )
        if outside:
            self.warning(
                f"{self.LOG_LABEL} extent refused: "
                f"({min_x:.3f},{min_y:.3f})→({max_x:.3f},{max_y:.3f}) lies outside "
                f"the CRS domain {self.VALID_EXTENT} — the caller passed coordinates "
                "that are not map coordinates in this CRS"
            )
            raise DemExtentRefusedError(
                f"DEM extent ({min_x:.3f},{min_y:.3f})→({max_x:.3f},{max_y:.3f}) is "
                f"outside the {self.LOG_LABEL} CRS domain "
                f"({valid_min_x:.0f},{valid_min_y:.0f})→({valid_max_x:.0f},{valid_max_y:.0f}). "
                "The request carries coordinates that are not map coordinates in "
                "this project's CRS.",
                extent=extent,
            )

        span_x = max_x - min_x
        span_y = max_y - min_y
        if span_x > WCS_MAX_EXTENT_SPAN_M or span_y > WCS_MAX_EXTENT_SPAN_M:
            self.warning(
                f"{self.LOG_LABEL} extent refused: span {span_x:.0f}×{span_y:.0f} m "
                f"exceeds the {WCS_MAX_EXTENT_SPAN_M:.0f} m cap"
            )
            raise DemExtentRefusedError(
                f"DEM extent spans {span_x:.0f}×{span_y:.0f} m, beyond the "
                f"{WCS_MAX_EXTENT_SPAN_M:.0f} m per-axis cap for one tile.",
                extent=extent,
            )

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

        # The declared dimensions are attacker-controllable (they come from the
        # untrusted WCS response header). Cap the pixel count BEFORE the decode
        # loop allocates one Python object per pixel — a hostile server can claim
        # a billion-pixel image in a tiny payload and otherwise hang + OOM the
        # backend here. DEM is a fallback, so an over-cap tile is refused (the
        # routers turn DemExtentRefusedError into a clean 422 → "no DEM here"),
        # never crashed through.
        declared_pixels = n_cols * n_rows
        if declared_pixels > WCS_MAX_DECODE_PIXELS:
            self.warning(
                f"{self.LOG_LABEL} decode refused: response declares "
                f"{n_cols}×{n_rows} = {declared_pixels} px, over the "
                f"{WCS_MAX_DECODE_PIXELS} px cap — not decoded"
            )
            raise DemExtentRefusedError(
                f"DEM response declares {n_cols}×{n_rows} = {declared_pixels} pixels, "
                f"beyond the {WCS_MAX_DECODE_PIXELS} px decode cap for one tile.",
                extent=(bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y),
            )

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
