"""Unit tests for DovXmlCache — filesystem cache for DOV XML payloads."""

from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache

# ------------------------------------------------------------------
# Basic round-trip
# ------------------------------------------------------------------


def test_get_returns_none_on_miss(tmp_path: Path):
    cache = DovXmlCache(tmp_path)
    assert cache.get("2009-000089") is None


def test_put_then_get_returns_bytes(tmp_path: Path):
    cache = DovXmlCache(tmp_path)
    cache.put("2009-000089", b"<xml>hello</xml>")
    assert cache.get("2009-000089") == b"<xml>hello</xml>"


def test_put_overwrites_existing(tmp_path: Path):
    cache = DovXmlCache(tmp_path)
    cache.put("k", b"first")
    cache.put("k", b"second")
    assert cache.get("k") == b"second"


def test_persists_across_instances(tmp_path: Path):
    DovXmlCache(tmp_path).put("k", b"persisted")
    assert DovXmlCache(tmp_path).get("k") == b"persisted"


def test_creates_cache_directory(tmp_path: Path):
    target = tmp_path / "fresh" / "subdir"
    assert not target.exists()
    DovXmlCache(target)
    assert target.is_dir()


# ------------------------------------------------------------------
# Path-traversal & key validation
# ------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_key",
    [
        "../../etc/passwd",
        "foo/bar",
        "a\\b",
        "with space",
        "",
        "key with newline\n",
    ],
)
def test_unsafe_keys_are_rejected(tmp_path: Path, bad_key: str):
    cache = DovXmlCache(tmp_path)
    cache.put(bad_key, b"x")
    assert cache.get(bad_key) is None
    # Critical: nothing was written outside the cache dir
    assert list(tmp_path.iterdir()) == []


def test_realistic_permkey_accepted(tmp_path: Path):
    cache = DovXmlCache(tmp_path)
    cache.put("2009-000089", b"x")
    assert (tmp_path / "2009-000089.xml").exists()


# ------------------------------------------------------------------
# Failure handling — cache errors must never block the import
# ------------------------------------------------------------------


def test_get_returns_none_when_dir_unreadable(tmp_path: Path, monkeypatch):
    cache = DovXmlCache(tmp_path)
    cache.put("k", b"x")

    # Force read_bytes to raise an OSError other than FileNotFoundError
    def boom(self):
        raise OSError("disk on fire")

    monkeypatch.setattr(Path, "read_bytes", boom)
    assert cache.get("k") is None  # logged warning, no raise


def test_put_does_not_raise_on_write_failure(tmp_path: Path, monkeypatch):
    cache = DovXmlCache(tmp_path)

    def boom(self, data):
        raise OSError("disk full")

    monkeypatch.setattr(Path, "write_bytes", boom)
    # Should not raise — caller's import must continue
    cache.put("k", b"x")


# ------------------------------------------------------------------
# Eviction — bounded by max_bytes, oldest-mtime first
# ------------------------------------------------------------------


def _permkey(i: int) -> str:
    return f"2009-{i:06d}"


def test_eviction_disabled_when_max_bytes_is_none(tmp_path: Path):
    """Without max_bytes the cache grows without bound — legacy behaviour."""
    cache = DovXmlCache(tmp_path)
    payload = b"x" * 1024
    for i in range(200):
        cache.put(_permkey(i), payload)
    # Every file still on disk.
    assert len(list(tmp_path.glob("*.xml"))) == 200


def test_eviction_keeps_size_under_cap(tmp_path: Path, monkeypatch):
    """When over max_bytes the sweep deletes oldest-mtime files first."""
    # Force the sweep to run on every put for a deterministic test.
    monkeypatch.setattr(
        "groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache._EVICT_CHECK_INTERVAL",
        1,
    )

    cache = DovXmlCache(tmp_path, max_bytes=4096)
    payload = b"x" * 1024  # 1 KiB each
    # Write 10 files, monotonically increasing mtime so order is deterministic.
    import os
    import time

    for i in range(10):
        cache.put(_permkey(i), payload)
        os.utime(tmp_path / f"{_permkey(i)}.xml", (1_700_000_000 + i, 1_700_000_000 + i))
        time.sleep(0.001)

    # Last write triggered eviction. Cap is 4 KiB → headroom 0.9 → ~3.6 KiB.
    # We expect ≤ 4 surviving files, and the oldest (i=0…) deleted first.
    survivors = sorted(p.name for p in tmp_path.glob("*.xml"))
    assert len(survivors) <= 4
    assert _permkey(9) + ".xml" in survivors  # newest always kept
    # None of the very oldest should remain.
    assert _permkey(0) + ".xml" not in survivors


def test_eviction_only_runs_after_interval(tmp_path: Path):
    """Sweep doesn't fire until ``_EVICT_CHECK_INTERVAL`` writes have landed."""
    cache = DovXmlCache(tmp_path, max_bytes=1)  # tiny cap, would evict everything if checked
    cache.put(_permkey(0), b"x" * 1024)
    cache.put(_permkey(1), b"x" * 1024)
    # With the default interval (64), only 2 writes — no sweep yet.
    assert len(list(tmp_path.glob("*.xml"))) == 2


def test_eviction_skips_non_xml_files(tmp_path: Path, monkeypatch):
    """Eviction only deletes files we own (``.xml``); foreign files survive."""
    monkeypatch.setattr(
        "groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache._EVICT_CHECK_INTERVAL",
        1,
    )
    foreign = tmp_path / "README.txt"
    foreign.write_bytes(b"hands off")

    cache = DovXmlCache(tmp_path, max_bytes=512)
    cache.put(_permkey(0), b"x" * 4096)  # one big file → over cap
    assert foreign.exists()


def test_startup_sweep_trims_pre_existing_cache(tmp_path: Path):
    """A new cache instance over an oversized directory evicts at construction.

    Guards the "long-lived cache, fresh process" case: across short app
    sessions of < ``_EVICT_CHECK_INTERVAL`` writes each, the in-memory
    counter resets every restart, so without a startup sweep the cache
    could drift indefinitely past ``max_bytes``.
    """
    # Pre-populate the cache directory directly with 10 over-sized files,
    # then construct a cache with a tight cap. The constructor should sweep.
    for i in range(10):
        (tmp_path / f"{_permkey(i)}.xml").write_bytes(b"x" * 1024)

    DovXmlCache(tmp_path, max_bytes=4096)
    survivors = list(tmp_path.glob("*.xml"))
    assert len(survivors) <= 4  # 4 KiB cap, 0.9 headroom → ~3.6 KiB target


def test_startup_sweep_skipped_when_eviction_disabled(tmp_path: Path):
    """``max_bytes=None`` means the constructor never touches existing files."""
    for i in range(10):
        (tmp_path / f"{_permkey(i)}.xml").write_bytes(b"x" * 1024)

    DovXmlCache(tmp_path)  # default max_bytes=None
    assert len(list(tmp_path.glob("*.xml"))) == 10
