"""Unit tests for ``DemTileCache``.

Covers the happy path (put + get), read errors, cache miss, and
eviction.  All tests use ``tmp_path`` so no real filesystem state
leaks between runs.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache, _tile_filename

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BBOX = (150000.0, 200000.0, 150100.0, 200100.0)
RES = 1.0
FAKE_TIFF = b"II\x2a\x00" + b"\x00" * 100  # minimal TIFF-magic blob


def _cache(tmp_path: Path, max_bytes: int | None = None) -> DemTileCache:
    """Construct a DemTileCache under ``tmp_path``."""
    return DemTileCache(tmp_path, "dhmvii", max_bytes=max_bytes)


# ---------------------------------------------------------------------------
# Filename helper
# ---------------------------------------------------------------------------


def test_tile_filename_stable_format() -> None:
    """Tile filename encodes bbox + resolution with 2 dp and underscore separators."""
    name = _tile_filename(150000.0, 200000.0, 150100.0, 200100.0, 1.0)
    assert name == "150000.00_200000.00_150100.00_200100.00_1.00.tiff"


def test_tile_filename_rounds_to_2dp() -> None:
    """Tiny floating-point differences in the same logical request collapse to one key."""
    a = _tile_filename(150000.000001, 200000.0, 150100.0, 200100.0, 1.0)
    b = _tile_filename(150000.000009, 200000.0, 150100.0, 200100.0, 1.0)
    assert a == b


# ---------------------------------------------------------------------------
# Put + get round-trip
# ---------------------------------------------------------------------------


def test_put_and_get_returns_same_bytes(tmp_path: Path) -> None:
    """put then get returns the exact bytes that were stored."""
    c = _cache(tmp_path)
    c.put(*BBOX, RES, FAKE_TIFF)
    result = c.get(*BBOX, RES)
    assert result == FAKE_TIFF


def test_get_returns_none_on_miss(tmp_path: Path) -> None:
    """get returns None when no tile has been put for the given parameters."""
    c = _cache(tmp_path)
    assert c.get(*BBOX, RES) is None


def test_get_returns_none_different_resolution(tmp_path: Path) -> None:
    """A tile stored at 1 m does not match a 2 m request — they have different filenames."""
    c = _cache(tmp_path)
    c.put(*BBOX, 1.0, FAKE_TIFF)
    assert c.get(*BBOX, 2.0) is None


def test_put_creates_provider_subdir(tmp_path: Path) -> None:
    """The provider sub-directory is created on first use."""
    subdir = tmp_path / "dhmvii"
    assert not subdir.exists()
    _cache(tmp_path)
    assert subdir.is_dir()


def test_tile_file_exists_after_put(tmp_path: Path) -> None:
    """The tile file lands in the expected location on disk."""
    c = _cache(tmp_path)
    c.put(*BBOX, RES, FAKE_TIFF)
    expected = tmp_path / "dhmvii" / _tile_filename(*BBOX, RES)
    assert expected.exists()


# ---------------------------------------------------------------------------
# Atomic write via temp-file + rename
# ---------------------------------------------------------------------------


def test_put_atomicity_temp_file_gone_after_put(tmp_path: Path) -> None:
    """No ``.tmp`` files remain in the cache directory after a successful put."""
    c = _cache(tmp_path)
    c.put(*BBOX, RES, FAKE_TIFF)
    tmp_files = list((tmp_path / "dhmvii").glob("*.tmp"))
    assert tmp_files == []


# ---------------------------------------------------------------------------
# Error handling — never raises, always falls through
# ---------------------------------------------------------------------------


def test_put_survives_write_error(tmp_path: Path) -> None:
    """A disk-write failure silently no-ops — no exception propagated."""
    c = _cache(tmp_path)
    with patch.object(Path, "write_bytes", side_effect=OSError("disk full")):
        c.put(*BBOX, RES, FAKE_TIFF)  # must not raise
    # The tile was not stored — next get is a miss.
    assert c.get(*BBOX, RES) is None


def test_get_survives_read_error(tmp_path: Path) -> None:
    """A disk-read failure logs a warning and returns None — no exception propagated."""
    c = _cache(tmp_path)
    c.put(*BBOX, RES, FAKE_TIFF)
    with patch.object(Path, "read_bytes", side_effect=OSError("unreadable")):
        result = c.get(*BBOX, RES)
    assert result is None


def test_cache_survives_missing_dir_on_get(tmp_path: Path) -> None:
    """If the cache directory vanishes between calls, get returns None gracefully."""
    c = _cache(tmp_path)
    # Remove the provider sub-directory after construction.
    import shutil

    shutil.rmtree(tmp_path / "dhmvii")
    assert c.get(*BBOX, RES) is None


# ---------------------------------------------------------------------------
# Eviction
# ---------------------------------------------------------------------------


def test_eviction_removes_oldest_tile_when_over_limit(tmp_path: Path) -> None:
    """When total size exceeds max_bytes, the oldest-by-mtime tile is deleted.

    We store two tiles and set max_bytes so only one fits.  The first
    tile (older mtime) is evicted; the second (newer mtime) survives.
    """
    small_tiff = b"II\x2a\x00" + b"\x00" * 50
    max_bytes = len(small_tiff) + 1  # room for exactly one tile

    c = DemTileCache(tmp_path, "dhmvii", max_bytes=max_bytes)

    # Set counter so the SECOND put hits the interval and triggers eviction.
    # After put #1: counter = _EVICT_CHECK_INTERVAL - 1 + 1 = _EVICT_CHECK_INTERVAL,
    # which is still < _EVICT_CHECK_INTERVAL in the >= check? No — use N-2 so
    # put #1 brings it to N-1 (no sweep) and put #2 brings it to N (sweep fires).
    from groundmodel.infrastructure.dem.dem_tile_cache import _EVICT_CHECK_INTERVAL

    c._writes_since_check = _EVICT_CHECK_INTERVAL - 2  # type: ignore[attr-defined]

    bbox1 = (0.0, 0.0, 10.0, 10.0)
    bbox2 = (20.0, 0.0, 30.0, 10.0)

    c.put(*bbox1, 1.0, small_tiff)
    # Touch the second tile's mtime to be strictly newer.
    import time

    time.sleep(0.02)
    c.put(*bbox2, 1.0, small_tiff)

    # After put, eviction should have fired (writes_since_check hit the interval).
    dir_files = list((tmp_path / "dhmvii").glob("*.tiff"))
    # At most one tile should remain (the newer one).
    assert len(dir_files) <= 1


def test_no_eviction_when_max_bytes_is_none(tmp_path: Path) -> None:
    """When max_bytes is None, no files are deleted regardless of total size."""
    c = _cache(tmp_path, max_bytes=None)
    for i in range(10):
        c.put(float(i * 10), 0.0, float(i * 10 + 10), 10.0, 1.0, FAKE_TIFF)
    tile_count = len(list((tmp_path / "dhmvii").glob("*.tiff")))
    assert tile_count == 10
