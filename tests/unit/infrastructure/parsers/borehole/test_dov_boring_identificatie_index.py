"""Reset to DOV must not open every cached boring file (owner finding 2026-10-04).

"Reset to DOV ... works but takes 5 to 10 seconds." Measured on the owner's
cache: 582 boring files, a COLD scan 7.2 s (each first open of a file costs
about 25 ms), a warm one 0.05 s. A stored borehole keeps only its boornummer,
so the boring file has to be found by the ``<identificatie>`` it names. The
rule these tests pin:

* a boornummer seen before is answered from a persistent index in the cache
  directory, with ONE head read (the check that the file still names it) -
  never a scan of the other files;
* a boornummer not in the index scans only the files the index does not know
  (new or changed since it was written), then answers;
* a missing or corrupt index is rebuilt, never an error;
* a boring the bbox import writes into the cache is recorded in the index at
  once, so a fresh import never forces a scan.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.borehole.dov.cached_dov_track_source import (
    CachedDovTrackSource,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_identificatie_index import (
    DovBoringIdentificatieIndex,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_IDENTIFICATIE_INDEX_FILENAME,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache


def _boring(boornummer: str, permkey: str) -> bytes:
    """A minimal boring XML naming ``boornummer``."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<ns4:dov-schema xmlns:ns4="http://kern.schemas.dov.vlaanderen.be"><boring>'
        f"<identificatie>{boornummer}</identificatie>"
        f"<dataidentifier><permkey>{permkey}</permkey></dataidentifier>"
        "</boring></ns4:dov-schema>"
    ).encode()


def _fill(boring_dir: Path, n: int) -> None:
    """Cache ``n`` borings ``B0..B(n-1)`` under permkeys ``2001-000000..``.

    Written straight to disk (the cache layout is ``<permkey>.xml``): the
    cache's own ``put`` fsyncs each file, which makes 5 000 of them take a
    minute on Windows.
    """
    boring_dir.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        permkey = f"2001-{i:06d}"
        (boring_dir / f"{permkey}.xml").write_bytes(_boring(f"B{i}", permkey))


def _source(tmp_path: Path) -> CachedDovTrackSource:
    """A source built the way every reset request builds one (fresh objects)."""
    boring = DovXmlCache(tmp_path / "boring")
    return CachedDovTrackSource(
        boring_cache=boring,
        interpretation_cache=DovXmlCache(tmp_path / "interpretatie"),
        boring_index=DovBoringIdentificatieIndex(boring),
    )


@pytest.fixture
def head_reads(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Spy: every permkey whose head the cache reads, in order."""
    seen: list[str] = []
    original = DovXmlCache.read_head

    def spy(self: DovXmlCache, permkey: str, max_bytes: int) -> bytes | None:
        seen.append(permkey)
        return original(self, permkey, max_bytes)

    monkeypatch.setattr(DovXmlCache, "read_head", spy)
    return seen


def test_a_boornummer_seen_before_is_answered_with_one_head_read(
    tmp_path: Path, head_reads: list[str]
) -> None:
    """Second reset of a known borehole: the index names the file; only it is opened."""
    _fill(tmp_path / "boring", 50)
    assert _source(tmp_path).boring_xml("B7") is not None  # builds the index
    head_reads.clear()

    xml = _source(tmp_path).boring_xml("B42")  # a NEW request: fresh objects

    assert xml is not None
    assert b"<permkey>2001-000042</permkey>" in xml
    assert head_reads == ["2001-000042"]


def test_a_boornummer_not_in_the_index_scans_only_the_files_the_index_does_not_know(
    tmp_path: Path, head_reads: list[str]
) -> None:
    """Three borings arrive behind the index's back: a miss reads those three, not 23."""
    _fill(tmp_path / "boring", 20)
    _source(tmp_path).boring_xml("B0")  # index of 20
    plain = DovXmlCache(tmp_path / "boring")  # a writer that does not record
    for i in (100, 101, 102):
        plain.put(f"2001-{i:06d}", _boring(f"B{i}", f"2001-{i:06d}"))
    head_reads.clear()

    xml = _source(tmp_path).boring_xml("B101")

    assert xml is not None
    assert b"<permkey>2001-000101</permkey>" in xml
    # The three new files are scanned, then the answer is verified once.
    assert sorted(set(head_reads)) == ["2001-000100", "2001-000101", "2001-000102"]
    assert len(head_reads) <= 4


def test_an_unknown_boornummer_with_a_complete_index_opens_no_file(
    tmp_path: Path, head_reads: list[str]
) -> None:
    """An XML-file import never went through the cache: the miss costs no scan."""
    _fill(tmp_path / "boring", 30)
    _source(tmp_path).boring_xml("B0")
    head_reads.clear()

    assert _source(tmp_path).boring_xml("kb7d15w-B250") is None
    assert head_reads == []


def test_a_corrupt_index_is_rebuilt_not_an_error(tmp_path: Path) -> None:
    """Garbage in the index file: the lookup still answers and the index is whole again."""
    _fill(tmp_path / "boring", 10)
    index_path = tmp_path / "boring" / DOV_BORING_IDENTIFICATIE_INDEX_FILENAME
    index_path.write_bytes(b"\x00{not json at all\n")

    xml = _source(tmp_path).boring_xml("B3")

    assert xml is not None
    assert b"<permkey>2001-000003</permkey>" in xml
    # Rebuilt: a second request is answered from it with one head read.
    assert DovBoringIdentificatieIndex(DovXmlCache(tmp_path / "boring")).size() == 10


def test_a_boring_written_by_the_import_is_recorded_so_no_scan_follows(
    tmp_path: Path, head_reads: list[str]
) -> None:
    """The bbox import's cache records each boring it writes into an existing index."""
    _fill(tmp_path / "boring", 15)
    _source(tmp_path).boring_xml("B0")  # index exists now
    boring = DovXmlCache(tmp_path / "boring")
    index = DovBoringIdentificatieIndex(boring)
    importing = DovXmlCache(tmp_path / "boring", put_observer=index.record)
    importing.put("2024-999999", _boring("GEO-24/001-B1", "2024-999999"))
    head_reads.clear()

    xml = _source(tmp_path).boring_xml("GEO-24/001-B1")

    assert xml is not None
    assert head_reads == ["2024-999999"]
    # And the recorded size + mtime match the directory listing: an unknown
    # boornummer after the import still opens no file.
    head_reads.clear()
    assert _source(tmp_path).boring_xml("kb7d15w-B250") is None
    assert head_reads == []


def test_recording_a_put_never_creates_the_index(tmp_path: Path) -> None:
    """Recording never creates the index: the first reset builds it from the whole cache."""
    boring = DovXmlCache(tmp_path / "boring")
    importing = DovXmlCache(
        tmp_path / "boring", put_observer=DovBoringIdentificatieIndex(boring).record
    )
    importing.put("2024-999999", _boring("GEO-24/001-B1", "2024-999999"))

    assert not (tmp_path / "boring" / DOV_BORING_IDENTIFICATIE_INDEX_FILENAME).exists()


def test_an_indexed_file_that_was_evicted_answers_none(tmp_path: Path) -> None:
    """The index names a file the eviction sweep removed: no crash, no stale answer."""
    _fill(tmp_path / "boring", 5)
    _source(tmp_path).boring_xml("B0")
    (tmp_path / "boring" / "2001-000002.xml").unlink()

    assert _source(tmp_path).boring_xml("B2") is None


def test_an_indexed_file_that_now_names_another_boring_is_not_returned(tmp_path: Path) -> None:
    """A re-downloaded file under the same permkey names a new boornummer: follow the file."""
    _fill(tmp_path / "boring", 5)
    _source(tmp_path).boring_xml("B0")
    DovXmlCache(tmp_path / "boring").put("2001-000002", _boring("B2-renamed", "2001-000002"))

    assert _source(tmp_path).boring_xml("B2") is None
    assert _source(tmp_path).boring_xml("B2-renamed") is not None


def test_a_boornummer_that_is_only_a_prefix_of_another_does_not_match(tmp_path: Path) -> None:
    """B25 must not pick up B250's file through the index either."""
    DovXmlCache(tmp_path / "boring").put("2001-000250", _boring("kb7d15w-B250", "2001-000250"))
    assert _source(tmp_path).boring_xml("kb7d15w-B250") is not None

    assert _source(tmp_path).boring_xml("kb7d15w-B25") is None


def test_5000_cached_borings_answer_a_known_boornummer_from_the_index_without_a_scan(
    tmp_path: Path, head_reads: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The scale the cache cap allows: a known boornummer is an index hit, not a scan.

    The index is filled the way the bbox import fills it (``record`` per
    written boring). Building it by a first-lookup scan would be the same
    answer but costs a minute here: each first open of a freshly written file
    pays the on-access scan (~13 ms on this machine) - the very cost the index
    exists to avoid.

    The property is asserted by counting, not by the clock: of the 5 000
    cached files only the one the index names is opened (one head read), and
    the directory is never listed (the listing is the first step of every
    scan). A wall-clock bound here lost by 4 % on a loaded build box
    (0.1037 s against 0.1 s) while the lookup was an index hit all along.
    """
    boring_dir = tmp_path / "boring"
    _fill(boring_dir, 5000)
    index = DovBoringIdentificatieIndex(DovXmlCache(boring_dir))
    index.path.write_text("")  # an (empty) index exists, so record appends
    for i in range(5000):
        permkey = f"2001-{i:06d}"
        index.record(permkey, _boring(f"B{i}", permkey))
    assert index.size() == 5000

    listings: list[Path] = []
    original_entries = DovXmlCache.entries

    def entries_spy(self: DovXmlCache) -> list[tuple[str, int, int]]:
        listings.append(self.directory)
        return original_entries(self)

    monkeypatch.setattr(DovXmlCache, "entries", entries_spy)
    head_reads.clear()

    xml = _source(tmp_path).boring_xml("B4321")

    assert xml is not None
    assert b"<permkey>2001-004321</permkey>" in xml
    # Index hit: exactly the named file is opened, and no scan starts.
    assert head_reads == ["2001-004321"]
    assert listings == []
