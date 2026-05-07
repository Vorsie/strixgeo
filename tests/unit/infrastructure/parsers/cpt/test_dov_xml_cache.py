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
