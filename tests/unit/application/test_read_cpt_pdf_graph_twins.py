"""The graph sheets of a printed-table report are read in the background (owner 2026-10-14).

Owner dogfeed on the packaged 0.1.6 (report Z2255777, 15 printed-table
soundings): "sondering wordt gelezen is traag". Opening "Assen controleren"
on a table sounding read its graph sheet with OCR at that moment (about 20 s
per sheet). Ruling:

* After the triage of a report finishes, the graph sheets of every
  printed-table sounding are read in the BACKGROUND, cached per report like
  today, with progress the dialog can show.
* The overlay opens at once when its graph sheet is ready; the on-demand read
  stays as the fallback, and a sounding the background is reading right now
  is waited for, never read twice.
* The background read stops cleanly when cancelled (the dialog closed).
* The import never waits for the graph sheets: the printed table is the source.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.digitise_cpt_pdf_sounding import DigitiseCptPdfSounding
from groundmodel.application.import_cpt_pdf import ImportCptPdf
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.pdf_sounding_import_request import PdfSoundingImportRequest
from groundmodel.application.read_cpt_pdf_graph_twins import ReadCptPdfGraphTwins
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager
from groundmodel.shared.exceptions import TriageCancelled

from ..infrastructure.parsers.cpt.pdf import _synthetic_table_pdf as synth

SHA = "d" * 64
PROJECT = UUID("00000000-0000-0000-0000-000000000004")


class _CountingDetector(CptPdfDigitiser):
    """A no-OCR digitiser that counts the graph pages it reads (thread-safe)."""

    calls = 0
    lock = threading.Lock()
    delay_s = 0.0

    def digitise_raster_image(self, *args: Any, **kwargs: Any) -> Any:
        with _CountingDetector.lock:
            _CountingDetector.calls += 1
        if _CountingDetector.delay_s:
            time.sleep(_CountingDetector.delay_s)
        return super().digitise_raster_image(*args, **kwargs)


def _detector() -> CptPdfDigitiser:
    return _CountingDetector(ocr=False)


@pytest.fixture(autouse=True)
def _reset_counter() -> None:
    _CountingDetector.calls = 0
    _CountingDetector.delay_s = 0.0


@pytest.fixture
def store(tmp_path: Path) -> PdfReportStore:
    """A store holding the synthetic printed-table report, triaged without OCR."""
    doc = synth.table_report()
    store = PdfReportStore(tmp_path)
    path = store.path_for(PROJECT, SHA)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    digest, soundings = PdfReportTriager(ocr=False).run(doc, SHA)
    store.remember(
        PROJECT,
        CachedPdfReport(path=path, file_name="report.pdf", digest=digest, soundings=soundings),
    )
    return store


def _report(store: PdfReportStore) -> CachedPdfReport:
    return store.require(PROJECT, SHA)


def test_after_the_triage_every_graph_sheet_is_read_in_the_background_and_cached(
    store: PdfReportStore,
) -> None:
    """The background read fills the per-report cache and ticks per sounding."""
    ticks: list[tuple[Any, ...]] = []
    reader = ReadCptPdfGraphTwins(store, detector_factory=_detector)
    assert reader.pending(PROJECT, SHA) == [synth.SOUNDING]

    summary = reader.run(PROJECT, SHA, progress=lambda *a, **kw: ticks.append((*a, kw.get("key"))))

    assert synth.SOUNDING in _report(store).graph_twins
    assert summary["read"] == [synth.SOUNDING]
    assert summary["total"] == 1
    assert ticks[0][:3] == ("graph", 0, 1)
    assert ticks[-1] == ("graph", 1, 1, synth.SOUNDING)
    assert reader.pending(PROJECT, SHA) == []


def test_the_overlay_opens_from_the_background_reading_without_reading_again(
    store: PdfReportStore,
) -> None:
    """Once the background read is done, opening the overlay reads no page again."""
    ReadCptPdfGraphTwins(store, detector_factory=_detector).run(PROJECT, SHA)
    assert _CountingDetector.calls == 1

    view = DigitiseCptPdfSounding(store, detector_factory=_detector).run(
        PROJECT, SHA, synth.SOUNDING
    )

    assert view.graph is not None
    assert view.graph.calibrations, "the overlay still has a frame to drag"
    assert _CountingDetector.calls == 1


def test_a_second_background_read_of_the_same_report_reads_nothing(
    store: PdfReportStore,
) -> None:
    """Cached per report: a re-run (the triage answered from memory) is a no-op."""
    reader = ReadCptPdfGraphTwins(store, detector_factory=_detector)
    reader.run(PROJECT, SHA)
    summary = reader.run(PROJECT, SHA)
    assert _CountingDetector.calls == 1
    assert summary == {"read": [], "total": 0}


def test_the_on_demand_read_stays_the_fallback(store: PdfReportStore) -> None:
    """No background read happened: opening the overlay reads the graph sheet itself."""
    view = DigitiseCptPdfSounding(store, detector_factory=_detector).run(
        PROJECT, SHA, synth.SOUNDING
    )
    assert view.graph is not None
    assert _CountingDetector.calls == 1
    assert synth.SOUNDING in _report(store).graph_twins


def test_opening_a_sounding_the_background_is_reading_waits_for_it_not_reads_twice(
    store: PdfReportStore,
) -> None:
    """The overlay opened mid-read gets the background's reading: one read in total."""
    _CountingDetector.delay_s = 0.5
    background = threading.Thread(
        target=ReadCptPdfGraphTwins(store, detector_factory=_detector).run,
        args=(PROJECT, SHA),
    )
    background.start()
    deadline = time.monotonic() + 5.0
    while _CountingDetector.calls == 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert _CountingDetector.calls == 1, "the background read has started"

    view = DigitiseCptPdfSounding(store, detector_factory=_detector).run(
        PROJECT, SHA, synth.SOUNDING
    )
    background.join(timeout=10.0)

    assert view.graph is not None
    assert _CountingDetector.calls == 1


def test_a_cancelled_background_read_stops_and_caches_nothing_half_read(
    store: PdfReportStore,
) -> None:
    """The dialog closed: the stop flag ends the read with ``TriageCancelled``."""
    reader = ReadCptPdfGraphTwins(store, detector_factory=_detector)
    with pytest.raises(TriageCancelled):
        reader.run(PROJECT, SHA, should_stop=lambda: True)
    assert _CountingDetector.calls == 0
    assert _report(store).graph_twins == {}


def test_a_report_without_printed_tables_has_nothing_to_read_in_the_background(
    tmp_path: Path,
) -> None:
    """A traced report (vector / raster sheets) has no graph twin to read."""
    from ..infrastructure.parsers.cpt.pdf import _synthetic_cpt_pdf as traced

    doc = traced.synthetic_cpt_pdf(traced.SyntheticPageSpec(sounding_id="S1", x=1.0, y=2.0))
    store = PdfReportStore(tmp_path)
    path = store.path_for(PROJECT, SHA)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    digest, soundings = PdfReportTriager(ocr=False).run(doc, SHA)
    store.remember(
        PROJECT,
        CachedPdfReport(path=path, file_name="r.pdf", digest=digest, soundings=soundings),
    )
    reader = ReadCptPdfGraphTwins(store, detector_factory=_detector)
    assert reader.pending(PROJECT, SHA) == []
    assert reader.run(PROJECT, SHA) == {"read": [], "total": 0}


class _Persist:
    """A stand-in for ``ImportCpt.persist``."""

    def __init__(self) -> None:
        self.calls: list[GEFParseResult] = []

    async def __call__(self, result: GEFParseResult, name: str, *_: Any, **__: Any) -> Any:
        self.calls.append(result)
        return ImportCptResult(cpt_id=uuid4(), issues=result.issues, refreshed=False, name=name)


async def test_the_import_does_not_wait_for_the_graph_sheets(store: PdfReportStore) -> None:
    """The table is the source: importing while the graph sheet is being read
    (its reading lock held) stores the printed table at once."""
    persist = _Persist()
    use_case = ImportCptPdf(AsyncMock(), store=store, persist=persist)
    use_case._digitise = DigitiseCptPdfSounding(store, detector_factory=_detector)
    with _report(store).twin_lock(synth.SOUNDING):
        started = time.monotonic()
        outcomes = await use_case.execute(
            PROJECT, SHA, [PdfSoundingImportRequest(key=synth.SOUNDING)], confirm_refresh=False
        )
        elapsed = time.monotonic() - started
    assert [o.status for o in outcomes] == ["imported"]
    assert elapsed < 2.0
    assert _CountingDetector.calls == 0
