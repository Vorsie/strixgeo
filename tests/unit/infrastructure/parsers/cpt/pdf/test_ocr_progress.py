"""Progress says what is slow (owner finding 2026-10-05).

A sheet whose text layer is unreadable takes seconds of OCR where a normal page
takes milliseconds; the dialog said only "Pagina's lezen (12/97)". The rule:
the progress tick says when OCR is what the triage is doing -- additively, an
``ocr`` flag next to ``phase / done / total`` -- so the dialog can show
"Titels lezen met OCR (12/97)".
"""

from __future__ import annotations

import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

from . import _garbled_pages as garbled
from . import _synthetic_cpt_pdf as synth


def _mixed_report() -> pymupdf.Document:
    """Prose, a sheet that needs OCR, prose."""
    doc = pymupdf.open()
    synth.add_text_page(doc)
    garbled.add_garbled_cpt_page(doc)
    synth.add_text_page(doc)
    return doc


def test_the_tick_before_an_ocr_page_says_ocr_is_running() -> None:
    """Before page 2 is OCR'd a tick says so; the plain pages around it do not."""
    ticks: list[tuple[int, int, bool]] = []
    PageTriage(ocr=OcrReader(engine=garbled.CountingEngine())).classify(
        _mixed_report(), progress=lambda d, t, ocr=False: ticks.append((d, t, ocr))
    )
    assert ticks == [(1, 3, False), (1, 3, True), (2, 3, True), (3, 3, False)]


def test_a_report_without_ocr_never_says_ocr() -> None:
    """Guard: a readable report's ticks all carry ``ocr`` False."""
    ticks: list[tuple[str, int, int, bool]] = []
    doc = synth.synthetic_cpt_pdf()
    PdfReportTriager(ocr=False).run(
        doc,
        file_sha="abc",
        progress=lambda p, d, t, ocr=False: ticks.append((p, d, t, ocr)),
    )
    assert ticks and not any(ocr for *_, ocr in ticks)


def test_the_triager_passes_the_ocr_flag_on_with_its_phase() -> None:
    """The classify ticks keep their phase and carry the OCR flag."""
    ticks: list[tuple[str, int, int, bool]] = []
    PdfReportTriager(ocr=OcrReader(engine=garbled.CountingEngine())).run(
        _mixed_report(),
        file_sha="abc",
        progress=lambda p, d, t, ocr=False: ticks.append((p, d, t, ocr)),
    )
    assert ("classify", 1, 3, True) in ticks
    assert ("classify", 3, 3, False) in ticks
