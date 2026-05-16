"""Filesystem cache for DEM GeoTIFF tiles fetched via WCS.

Design mirrors ``DovXmlCache``: filesystem-first, network only on a cold
cell, cache wipe is safe (the DEM is public data derivable from source).
Failure modes (disk full, permission errors) NEVER block the sampling
pipeline — every operation logs a warning and falls through to the network
path.

Layout
------
One file per tile, stored under ``<cache_dir>/<provider_id>/``.  The
filename encodes the tile parameters in a stable, human-readable format::

    <bbox_min_x>_<bbox_min_y>_<bbox_max_x>_<bbox_max_y>_<resolution_m>.tiff

All coordinate values are rounded to 2 decimal places so floating-point
representation differences don't produce cache misses for the same logical
request.

Eviction
--------
Same lazy-sweep strategy as ``DovXmlCache``.  Every
``_EVICT_CHECK_INTERVAL`` writes the cache totals its directory size and,
if over ``max_bytes``, deletes oldest-by-mtime ``.tiff`` files until the
total is under ``_EVICT_HEADROOM_RATIO × max_bytes``.
``max_bytes=None`` disables eviction (default — suitable for tests and for
a cache that grows slowly).
"""

from __future__ import annotations

import os
from pathlib import Path

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Run a sweep every N writes (same interval as DovXmlCache — balanced
# between overhead and cache-size overshoot).
_EVICT_CHECK_INTERVAL = 32

# Sweep target: clear down to 90 % of max_bytes so the very next write
# doesn't immediately re-trigger a sweep.
_EVICT_HEADROOM_RATIO = 0.9


def _tile_filename(
    bbox_min_x: float,
    bbox_min_y: float,
    bbox_max_x: float,
    bbox_max_y: float,
    resolution_m: float,
) -> str:
    """Derive a stable filename from tile parameters.

    Parameters
    ----------
    bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
        Bounding box coordinates in the provider's native CRS.
    resolution_m : float
        Requested raster cell size in metres.

    Returns
    -------
    str
        Filename (without directory) using ``_`` separators and 2 dp
        precision.  The ``.tiff`` extension allows the eviction sweep to
        skip unrelated files.
    """
    return (
        f"{bbox_min_x:.2f}_{bbox_min_y:.2f}"
        f"_{bbox_max_x:.2f}_{bbox_max_y:.2f}"
        f"_{resolution_m:.2f}.tiff"
    )


class DemTileCache(GroundModelLogger):
    """Persistent on-disk cache for DEM GeoTIFF tiles, keyed by bbox + resolution.

    Parameters
    ----------
    cache_dir : Path
        Root directory.  One sub-directory per provider id is created
        under it.  Created on first use if absent.
    provider_id : str
        Short identifier for the provider (``"dhmvii"`` / ``"ahn4"``).
        Used as a sub-directory name so tiles from different providers
        don't collide.
    max_bytes : int | None, optional
        Soft cap on the total size of the provider's sub-directory.
        Eviction fires lazily after writes; ``None`` disables it.
    """

    def __init__(
        self,
        cache_dir: Path,
        provider_id: str,
        max_bytes: int | None = None,
    ) -> None:
        """Initialise the cache, creating the directory tree if needed."""
        super().__init__(__name__)
        self._dir = cache_dir / provider_id
        self._max_bytes = max_bytes
        self._writes_since_check = 0

        dir_ok = True
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self.warning(
                f"DEM tile cache: could not create {self._dir}: {exc}. Cache disabled this session."
            )
            dir_ok = False

        if dir_ok and self._max_bytes is not None:
            self._maybe_evict()

    def get(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float,
    ) -> bytes | None:
        """Return cached GeoTIFF bytes for the given tile parameters, or None.

        Parameters
        ----------
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            Tile bounding box.
        resolution_m : float
            Raster cell size.

        Returns
        -------
        bytes | None
            Raw GeoTIFF bytes on a cache hit, ``None`` on a miss or
            read error.
        """
        path = self._path_for(bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, resolution_m)
        if path is None:
            return None
        try:
            data = path.read_bytes()
            self.trace(f"DEM tile cache: HIT {path.name} ({len(data)} B)")
            return data
        except FileNotFoundError:
            fname = _tile_filename(bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, resolution_m)
            self.trace(f"DEM tile cache: MISS {fname}")
            return None
        except OSError as exc:
            self.warning(f"DEM tile cache: read failed: {exc}")
            return None

    def put(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float,
        tiff_bytes: bytes,
    ) -> None:
        """Atomically write a GeoTIFF tile to the cache.  Silently no-ops on error.

        Uses temp-file + rename for atomicity — a half-written file will
        never be read as a valid tile.

        Parameters
        ----------
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y : float
            Tile bounding box.
        resolution_m : float
            Raster cell size.
        tiff_bytes : bytes
            Raw GeoTIFF blob returned by the WCS provider.
        """
        path = self._path_for(bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, resolution_m)
        if path is None:
            return
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        try:
            tmp.write_bytes(tiff_bytes)
            tmp.replace(path)
            self.trace(f"DEM tile cache: WRITE {path.name} ({len(tiff_bytes)} B)")
        except OSError as exc:
            self.warning(f"DEM tile cache: write failed: {exc}")
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return

        self._writes_since_check += 1
        if self._max_bytes is not None and self._writes_since_check >= _EVICT_CHECK_INTERVAL:
            self._writes_since_check = 0
            self._maybe_evict()

    def _path_for(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float,
    ) -> Path | None:
        """Return the filesystem path for the given tile, or None if dir is unusable."""
        if not self._dir.exists():
            return None
        return self._dir / _tile_filename(
            bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, resolution_m
        )

    def _maybe_evict(self) -> None:
        """Sweep oldest-by-mtime files when total size exceeds ``max_bytes``.

        Best-effort — every OS error is caught and logged.  Hidden temp
        files (``.*.tmp``) and non-``.tiff`` files are left alone.
        """
        if self._max_bytes is None:
            return
        try:
            entries = [
                (e, e.stat()) for e in self._dir.iterdir() if e.is_file() and e.suffix == ".tiff"
            ]
        except OSError as exc:
            self.warning(f"DEM tile cache: eviction scan failed: {exc}")
            return

        total = sum(s.st_size for _, s in entries)
        if total <= self._max_bytes:
            return

        entries.sort(key=lambda pair: pair[1].st_mtime)
        target = int(self._max_bytes * _EVICT_HEADROOM_RATIO)
        deleted = freed = 0
        for path, stat in entries:
            if total <= target:
                break
            try:
                path.unlink()
            except OSError as exc:
                self.warning(f"DEM tile cache: eviction unlink failed for {path.name}: {exc}")
                continue
            total -= stat.st_size
            freed += stat.st_size
            deleted += 1

        if deleted:
            self.info(
                f"DEM tile cache evicted {deleted} tile(s) ({freed / 1_048_576:.1f} MiB) "
                f"from {self._dir.name}; new size ≈{total / 1_048_576:.1f} MiB"
            )
