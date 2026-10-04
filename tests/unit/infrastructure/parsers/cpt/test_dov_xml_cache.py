"""Unit tests for DovXmlCache — filesystem cache for DOV XML payloads."""

import os
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

    # The durable-write path forces bytes to disk with os.fsync before the
    # atomic rename; a failure anywhere in that path (here, fsync on a full
    # disk / unsupported filesystem) must be swallowed so the caller's import
    # continues on the network path.
    def boom(fd):
        raise OSError("disk full")

    monkeypatch.setattr(os, "fsync", boom)
    # Should not raise — caller's import must continue
    cache.put("k", b"x")
    # And the half-written temp file must not have been published as the entry.
    assert cache.get("k") is None
    assert list(tmp_path.glob("*.xml")) == []


# ------------------------------------------------------------------
# Invalidation — delete a corrupt entry so a re-fetch can replace it (M2a)
# ------------------------------------------------------------------


def test_delete_removes_a_cached_entry(tmp_path: Path):
    """delete() removes the on-disk entry so the next get() misses."""
    cache = DovXmlCache(tmp_path)
    cache.put("2009-000089", b"<xml/>")
    assert cache.get("2009-000089") == b"<xml/>"
    cache.delete("2009-000089")
    assert cache.get("2009-000089") is None
    assert not (tmp_path / "2009-000089.xml").exists()


def test_delete_is_a_noop_on_missing_entry(tmp_path: Path):
    """delete() on a key with no file must not raise."""
    cache = DovXmlCache(tmp_path)
    cache.delete("2009-000089")  # never written — must be silent


def test_delete_rejects_unsafe_key(tmp_path: Path):
    """delete() reuses the permkey guard — an unsafe key touches nothing."""
    cache = DovXmlCache(tmp_path)
    (tmp_path / "victim.xml").write_bytes(b"keep me")
    cache.delete("../victim")
    assert (tmp_path / "victim.xml").exists()


# ------------------------------------------------------------------
# Durability — fsync the temp file BEFORE the atomic rename (M2b)
# ------------------------------------------------------------------


def test_put_fsyncs_before_replace(tmp_path: Path, monkeypatch):
    """The temp file is fsync'd before the rename so a crash can't publish garbage.

    Rule (M2b): a rename that publishes a not-yet-flushed temp file would, after a
    crash, leave a cache entry pointing at zero/garbage bytes that later parses as
    broken XML. Force the bytes to disk (fsync) BEFORE ``replace`` so the atomic
    rename only ever publishes fully-written data.
    """
    order: list[str] = []
    real_fsync = os.fsync

    def spy_fsync(fd):
        order.append("fsync")
        return real_fsync(fd)

    original_replace = Path.replace

    def spy_replace(self, target):
        order.append("replace")
        return original_replace(self, target)

    monkeypatch.setattr(os, "fsync", spy_fsync)
    monkeypatch.setattr(Path, "replace", spy_replace)

    cache = DovXmlCache(tmp_path)
    cache.put("2009-000089", b"<xml>durable</xml>")

    assert order == ["fsync", "replace"], f"expected fsync before replace, got {order}"
    # And the write still lands correctly.
    assert cache.get("2009-000089") == b"<xml>durable</xml>"


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


# ------------------------------------------------------------------
# Put observer + entries (Reset to DOV boring index, owner finding 2026-10-04)
# ------------------------------------------------------------------


def test_put_observer_hears_every_successful_write(tmp_path: Path):
    """The boring index records what the import writes - permkey and bytes, after the write."""
    heard: list[tuple[str, bytes, bool]] = []
    cache = DovXmlCache(
        tmp_path,
        put_observer=lambda k, b: heard.append((k, b, (tmp_path / f"{k}.xml").exists())),
    )

    cache.put("2001-000001", b"<a/>")

    assert heard == [("2001-000001", b"<a/>", True)]


def test_put_observer_is_not_called_when_the_write_fails(tmp_path: Path, monkeypatch):
    """A file that never reached the cache must not be indexed."""
    heard: list[str] = []
    cache = DovXmlCache(tmp_path, put_observer=lambda k, b: heard.append(k))

    def boom(fd):
        raise OSError("disk full")

    monkeypatch.setattr(os, "fsync", boom)
    cache.put("2001-000001", b"<a/>")

    assert heard == []


def test_a_failing_put_observer_never_breaks_the_import(tmp_path: Path):
    """The observer is a side index; its failure is logged, the cached file stays."""

    def boom(permkey: str, xml: bytes) -> None:
        raise OSError("index unwritable")

    cache = DovXmlCache(tmp_path, put_observer=boom)
    cache.put("2001-000001", b"<a/>")

    assert cache.get("2001-000001") == b"<a/>"


def test_entries_lists_the_xml_files_with_size_and_mtime(tmp_path: Path):
    """One directory listing gives what the index compares against - no file is opened."""
    cache = DovXmlCache(tmp_path)
    cache.put("2001-000001", b"<a/>")
    cache.put("2001-000002", b"<bb/>")
    (tmp_path / "_side_index.jsonl").write_text("x")

    entries = cache.entries()

    assert [(k, size) for k, size, _ in entries] == [("2001-000001", 4), ("2001-000002", 5)]
    stat = (tmp_path / "2001-000002.xml").stat()
    assert entries[1][2] == stat.st_mtime_ns
