"""DemProvider abstract base and shared value objects for DEM grid sampling.

The two concrete providers (``DhmviiDemProvider`` for BE/Flanders and
``Ahn4DemProvider`` for NL) both return the same ``DemZGrid`` value object,
so the clip rule in ``domain/services/dem_clip.py`` and the application use
case are insulated from the WCS details.

Architecture
------------
* This module lives in ``infrastructure/dem/`` — it may import ``httpx`` and
  ``Pillow`` (I/O + raster libraries), but MUST NOT import anything from
  ``domain/`` or ``application/`` (one-way dependency rule).
* The abstract ``DemProvider`` is *not* a ``GroundModelLogger`` — it is a
  pure ABC. Concrete subclasses inherit ``GroundModelLogger`` directly and
  call ``super().__init__(__name__)`` with their own module name.

Why not rasterio?
-----------------
``rasterio`` is the standard GIS raster library but it pulls in GDAL C
bindings and native wheels that add significant install complexity (especially
on Windows). For WCS-served tiles where the server always returns exactly
the requested bbox + CRS, Pillow + manual georeferencing (pixel size derived
from bbox ÷ TIFF dimensions) is sufficient.  The existing ``dhmvii_sampler.py``
already uses this approach and has been proven on live data.  ``rasterio`` is
the escape hatch when a future provider ships tiles that embed internal
georeferencing we cannot ignore.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING, Self

if TYPE_CHECKING:
    from groundmodel.infrastructure.dem.dhmvii_sampler import SamplePoint


@dataclass(frozen=True)
class DemZGrid:
    """A sampled DEM raster over a rectangular bbox in the project's CRS.

    Attributes
    ----------
    bbox_min_x : float
        Left edge of the bbox in the provider's CRS (metres).
    bbox_min_y : float
        Bottom edge of the bbox (metres).
    bbox_max_x : float
        Right edge (metres).
    bbox_max_y : float
        Top edge (metres).
    resolution_m : float
        Cell size — same in x and y (metres / pixel).  Derived from
        ``(bbox_max_x - bbox_min_x) / n_cols`` on the actual tile.
    n_cols : int
        Number of pixels in the x direction.
    n_rows : int
        Number of pixels in the y direction.
    values : tuple[float | None, ...]
        Flat row-major array, length ``n_rows * n_cols``.  Row 0 = top
        (max Y), row ``n_rows-1`` = bottom (min Y) — standard north-up
        TIFF convention.  ``None`` = NoData (outside coverage, permanent
        water, cloud shadow).
    from_cache : bool
        ``True`` when the tile was served from the local filesystem cache;
        ``False`` when it was fetched from the WCS network.
    """

    bbox_min_x: float
    bbox_min_y: float
    bbox_max_x: float
    bbox_max_y: float
    resolution_m: float
    n_cols: int
    n_rows: int
    values: tuple[float | None, ...]
    from_cache: bool = False

    def sample_at(self, x: float, y: float) -> float | None:
        """Bilinear-interpolate the grid at world coordinates ``(x, y)``.

        Returns ``None`` when the point is outside the grid's bbox or when
        any of the four interpolation neighbours are NoData.

        Parameters
        ----------
        x : float
            World x coordinate in the grid's CRS.
        y : float
            World y coordinate in the grid's CRS.

        Returns
        -------
        float | None
            Interpolated elevation in metres, or ``None``.
        """
        if self.n_cols == 0 or self.n_rows == 0:
            return None

        # Pixel size in x and y (may differ slightly for non-square tiles,
        # but WCS typically returns square pixels at the native resolution).
        px_w = (self.bbox_max_x - self.bbox_min_x) / self.n_cols
        px_h = (self.bbox_max_y - self.bbox_min_y) / self.n_rows

        if px_w <= 0 or px_h <= 0:
            return None

        # Fractional pixel coordinates.  Row 0 = top → y is inverted.
        px = (x - self.bbox_min_x) / px_w
        py = (self.bbox_max_y - y) / px_h

        if px < 0 or py < 0 or px > self.n_cols - 1 or py > self.n_rows - 1:
            return None

        x0 = int(px)
        y0 = int(py)
        fx = px - x0
        fy = py - y0
        x1 = min(x0 + 1, self.n_cols - 1)
        y1 = min(y0 + 1, self.n_rows - 1)

        def _v(col: int, row: int) -> float | None:
            return self.values[row * self.n_cols + col]

        v00 = _v(x0, y0)
        v10 = _v(x1, y0)
        v01 = _v(x0, y1)
        v11 = _v(x1, y1)
        if v00 is None or v10 is None or v01 is None or v11 is None:
            return None

        return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11


class DemProvider(ABC):
    """Abstract interface for a DEM WCS provider.

    Each concrete implementation covers one region (BE or NL) and one data
    source (DHMVII or AHN4).  The interface contract is narrow: given an
    axis-aligned bbox in the provider's native CRS, return a ``DemZGrid``.

    Concrete subclasses also inherit ``GroundModelLogger`` to honour the
    project's logging convention — they are not pure data classes.
    """

    async def __aenter__(self) -> Self:
        """Async-context entry — returns self unchanged."""
        return self

    async def __aexit__(self, *_exc: object) -> None:
        """Async-context exit — releases network resources via :meth:`close`."""
        await self.close()

    @abstractmethod
    async def close(self) -> None:
        """Release the provider's network resources (HTTP client).

        Callers that don't use the async-context form MUST call this
        explicitly. Declared on the ABC because both the ground-surface
        build and the line-profile endpoint manage providers through
        ``async with`` against the abstract type.
        """

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Short stable identifier used as the cache sub-directory name.

        Returns
        -------
        str
            E.g. ``"dhmvii"`` or ``"ahn4"``.
        """

    @property
    @abstractmethod
    def native_epsg(self) -> int:
        """EPSG code for the provider's native CRS.

        Returns
        -------
        int
            E.g. 31370 for DHMVII (Lambert72) or 28992 for AHN4 (RD New).
        """

    @abstractmethod
    async def fetch_grid(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float | None = None,
    ) -> DemZGrid:
        """Fetch (or return from cache) a DEM tile over the given bbox.

        Parameters
        ----------
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            Requested tile extents in the provider's native CRS (metres).
        resolution_m : float | None, optional
            Desired cell size in metres. ``None`` (the default) means "use the
            provider's own native resolution", and every provider honours that.
            An EXPLICIT value is a request the provider may or may not be able to
            satisfy. A provider that cannot resample to an arbitrary resolution
            (the WCS providers serve only their coverage's native grid) MUST NOT
            silently ignore the request: it returns its native grid, logs a
            WARNING naming the requested and the delivered resolution, and records
            the actual delivered cell size on ``DemZGrid.resolution_m``. Callers
            must therefore read the delivered resolution off the returned grid
            rather than assume the requested value was met.

        Returns
        -------
        DemZGrid
            Sampled z-values over the requested region. ``from_cache``
            distinguishes a warm hit from a network fetch, and
            ``resolution_m`` is the cell size actually delivered.

        Raises
        ------
        httpx.HTTPError
            On transport-level failures (timeout, connection refused).
        ValueError
            When the WCS response body cannot be decoded as a valid
            GeoTIFF (e.g. the bbox is entirely outside the coverage).
        """

    @abstractmethod
    async def sample_along_line(
        self,
        *,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        n_samples: int = 200,
    ) -> list[SamplePoint]:
        """Sample elevations along a line in the provider's native CRS.

        Backs the cross-section ground-surface polyline (#234 — the
        line profile rides the same tile cache as ``fetch_grid``, so
        re-opening a section never re-downloads its strip).

        Parameters
        ----------
        start_x, start_y, end_x, end_y : float
            Line endpoints in the provider's native CRS (metres).
        n_samples : int
            Number of evenly-spaced points returned (inclusive of both
            endpoints). Fewer than 2, or a zero-length line, yields an
            empty list.

        Returns
        -------
        list[SamplePoint]
            One point per sample; ``elevation_m`` is ``None`` on
            NoData cells (outside coverage, permanent water, holes).

        Raises
        ------
        httpx.HTTPError
            On transport-level failures.
        ValueError
            When the WCS response carries no decodable GeoTIFF.
        """
