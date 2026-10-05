"""OCR results are cached per report page (owner finding 2026-10-05).

OCR of a report with an unreadable text layer takes minutes. The rules:

* a second triage of the same file (same SHA-256) reads the cached words and
  never OCRs a strip again;
* within one triage, a strip read in the classify pass is not OCR'd again in
  the digitise pass;
* the cache lives next to the stored report and goes when the report is
  pruned from the store;
* the RapidOCR engine loads once per process, not once per job.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from uuid import uuid4

import pytest

from groundmodel.infrastructure.parsers.cpt.pdf import ocr_reader
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    MAX_SPOOLED_PDF_REPORTS_PER_PROJECT,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

from . import _garbled_pages as garbled

PROJECT = uuid4()


def _sha(n: int) -> str:
    return f"{n:064x}"


def _put(store: PdfReportStore, tmp_path: Path, n: int) -> Path:
    """Store a (dummy) report ``n`` with a distinct, increasing mtime."""
    spooled = tmp_path / f"upload-{n}.part"
    spooled.write_bytes(b"%PDF-1.7 dummy")
    path = store.put_file(PROJECT, _sha(n), spooled)
    os.utime(path, (time.time() + n, time.time() + n))
    return path


def test_a_second_triage_of_the_same_report_reads_the_cache_not_the_engine(
    tmp_path: Path,
) -> None:
    """Triage twice from the store's cache: the second run makes no OCR call."""
    store = PdfReportStore(tmp_path)
    _put(store, tmp_path, 1)
    doc = garbled.garbled_report(2)
    first = garbled.CountingEngine()
    cache = store.ocr_cache(PROJECT, _sha(1))
    PdfReportTriager(ocr=OcrReader(engine=first)).run(doc, _sha(1), ocr_cache=cache)
    cache.save()
    assert first.calls > 0

    second = garbled.CountingEngine()
    again = store.ocr_cache(PROJECT, _sha(1))
    PdfReportTriager(ocr=OcrReader(engine=second)).run(doc, _sha(1), ocr_cache=again)
    assert second.calls == 0
    assert again.misses == 0 and again.hits > 0


def test_a_strip_read_in_the_classify_pass_is_not_ocrd_again_when_digitising() -> None:
    """One triage, two passes over the same sheet: its two title strips are OCR'd once."""
    engine = garbled.CountingEngine()
    PdfReportTriager(ocr=OcrReader(engine=engine)).run(garbled.garbled_report(1), _sha(1))
    assert engine.calls == 2


def test_the_cache_sits_next_to_the_report_and_is_pruned_with_it(tmp_path: Path) -> None:
    """Prune the oldest report: its OCR cache goes with it, a new cache starts empty."""
    store = PdfReportStore(tmp_path)
    oldest = _put(store, tmp_path, 1)
    engine = garbled.CountingEngine()
    reader = OcrReader(engine=engine)
    cache = store.ocr_cache(PROJECT, _sha(1))
    with reader.session(cache=cache):
        reader.read_title_strips(garbled.garbled_report(1)[0])
    cache.save()
    sidecar = oldest.with_suffix(".ocr.json")
    assert sidecar.exists()

    for n in range(2, MAX_SPOOLED_PDF_REPORTS_PER_PROJECT + 2):
        _put(store, tmp_path, n)
    assert not oldest.exists()
    assert not sidecar.exists()
    assert store.ocr_cache(PROJECT, _sha(1)).keys() == []


def test_the_rapidocr_engine_loads_once_per_process(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two readers (two jobs) share one engine: the loader runs once."""
    loads: list[object] = []

    def loader() -> object:
        engine = garbled.CountingEngine()
        loads.append(engine)
        return engine

    monkeypatch.setattr(ocr_reader, "_SHARED_ENGINE", None)
    monkeypatch.setattr(ocr_reader, "_load_rapidocr", loader)
    page = garbled.garbled_report(1)[0]
    OcrReader().read_title_strips(page)
    OcrReader().read_title_strips(page)
    assert len(loads) == 1
