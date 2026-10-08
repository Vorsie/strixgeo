"""Scanned logs and bold-by-overprint headers (corpus triage, 2026-10-08).

* "a scanned log sheet read by OCR is a log sheet, not a photo": once OCR
  has read its words, the page is classified on those words; its name is
  the one OCR read (raw), and the verdict says it was read by OCR;
* "OCR drops the spaces of a label" ("Locationorcorename"): the name is
  still read;
* "a header printed bold by overprinting each word three times" (the 21.04
  report) still reads "Boring: B45d", and its rows are read once.
"""

from __future__ import annotations

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class import (
    BoreholePageClass,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader

from . import _synthetic_borehole_pdf as synth


class _ScanEngine:
    """A fake RapidOCR engine: returns the lines of a scanned log sheet."""

    def __init__(self, lines: list[str]) -> None:
        self.lines = lines

    def __call__(self, image: np.ndarray) -> tuple[list, float]:
        """Return one RapidOCR result line per text line, 30 px apart."""
        h, w = image.shape[:2]
        out = []
        for i, text in enumerate(self.lines):
            y = 40 + 30 * i
            box = [[40, y], [w - 40, y], [w - 40, y + 20], [40, y + 20]]
            out.append((box, text, 0.9))
        return out, 0.1


def _scan_report() -> pymupdf.Document:
    """One page holding only a full-page image (a scan)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 80), False)
    pix.set_rect(pix.irect, (200, 200, 200))
    page.insert_image(page.rect, pixmap=pix)
    return doc


def test_a_scanned_log_read_by_ocr_is_a_log_sheet_not_a_photo() -> None:
    """OCR words "Log sheet ... Locationorcorename NSZ S156" -> a log sheet named "NSZ S156"."""
    engine = _ScanEngine(
        [
            "Log sheet",
            "Date 23-11-2023 Thickness 29 cm",
            "Locationorcorename NSZ S156 Sheet no. 1 of 13",
            "Zeer fijn zand met enkele carbonaat fossielen",
        ]
    )
    result = BoreholePdfTriager(ocr=OcrReader(engine=engine)).triage(_scan_report(), "scan.pdf")
    (page,) = result.digest.pages
    assert page.page_class is BoreholePageClass.LOG_SHEET
    assert page.text_source == "ocr"
    assert page.profile == "generic"
    (borehole,) = result.digest.boreholes
    assert borehole.name == "NSZ S156"
    assert borehole.text_verdict == "ocr"
    assert result.digest.ocr_pages == (1,)


def test_a_scan_without_log_words_stays_a_photo() -> None:
    """OCR reads a caption only: the page is a photo page."""
    engine = _ScanEngine(["Kern 3", "foto 12"])
    result = BoreholePdfTriager(ocr=OcrReader(engine=engine)).triage(_scan_report(), "scan.pdf")
    assert result.digest.pages[0].page_class is BoreholePageClass.PHOTO


def test_an_overprinted_header_and_rows_are_read_once() -> None:
    """Bold by overprint: "Boring: B-T1" still names the borehole; each row once."""
    result = BoreholePdfTriager(ocr=None).triage(
        synth.build_overprinted_boorstaat_pdf(), "bold.pdf"
    )
    (borehole,) = result.digest.boreholes
    assert borehole.name == "B-T1"
    rows = result.sheets[1].rows
    assert rows[0].text == "Asfalt, Asfaltboor"


def test_a_scanned_log_whose_name_ocr_missed_is_a_log_with_no_name() -> None:
    """ "Log sheet" read, the name not: a log sheet listed with an empty name, none invented."""
    engine = _ScanEngine(["Log sheet", "Date 23-11-2023", "Sheet no. 4 of 13"])
    result = BoreholePdfTriager(ocr=OcrReader(engine=engine)).triage(_scan_report(), "scan.pdf")
    assert result.digest.pages[0].page_class is BoreholePageClass.LOG_SHEET
    assert result.digest.pages[0].borehole_name is None
    (borehole,) = result.digest.boreholes
    assert borehole.name == ""
    assert borehole.key == "@p1"
