"""A refusal sheet is a CPT sheet even when its curve is short (owner finding 2026-10-06).

CAMZ-001 2.3 lost soundings 14, 19, 28, 37: "Obstakel" sheets where the probe
refused at 0.2 to 1.5 m, so the curve has ~76 segments, below the 100 a full
sheet needs. Their text layer is unreadable, so no CPT keyword survives, and
the title strips were never OCR'd: the page fell through to "table". The same
sheets in 2.4 (readable text) are CPT sheets. The rule:

* a sheet that carries the CPT graph frame (a depth axis down the side, value
  panels with their tick labels on the grid lines) and a short curve is a CPT
  sheet, even without any text evidence;
* when the text layer is unreadable, such a sheet's title strips go through
  OCR so the sounding block (id, project, ground level) is read;
* a ruled table, a prose page, or a sheet with too short a curve does not flip.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage

from . import _garbled_pages as garbled
from . import _synthetic_cpt_pdf as synth

# A refusal at 1.2 m: 60 scans of 2 cm, 59 curve segments per quantity.
REFUSAL_DEPTH_M = 1.2


def _refusal_sheet(words: bool) -> pymupdf.Document:
    """Return one garbled refusal sheet (short curve; words printed or not)."""
    doc = pymupdf.open()
    spec = synth.SyntheticPageSpec(last_depth_m=REFUSAL_DEPTH_M, words=words)
    garbled.add_garbled_cpt_page(doc, spec)
    return doc


class TitleBlockEngine:
    """A RapidOCR stand-in that reads a Van der Straaten title block in every strip."""

    LINES = (
        "Van der Straaten Geotechniek",
        "Conusweerstand (MPa)",
        "Plaatselijke wrijving (MPa)",
        "SONDERING",
    )

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, image: np.ndarray) -> tuple[list[Any], None]:
        """Return the title lines stacked down the image, in RapidOCR's shape."""
        self.calls += 1
        h, w = image.shape[:2]
        step = h / (len(self.LINES) + 1)
        out = []
        for i, text in enumerate(self.LINES):
            y0, y1 = step * i + 1.0, step * (i + 1)
            box = [[1.0, y0], [w / 2.0, y0], [w / 2.0, y1], [1.0, y1]]
            out.append((box, text, 0.99))
        return out, None


def test_a_short_curve_sheet_with_the_graph_frame_and_no_text_is_a_cpt_sheet() -> None:
    """No text evidence at all, no OCR: the graph frame alone keeps it a CPT sheet."""
    report = PageTriage(ocr=False).classify(_refusal_sheet(words=False))
    page = report.pages[0]
    assert 20 <= page.curve_segments < 100
    assert page.page_class is PageClass.CPT_GRAPH
    assert page.graph_kind is GraphKind.VECTOR
    assert any("graph frame" in r for r in page.reasons)


def test_a_short_curve_sheet_with_an_unreadable_text_layer_goes_through_ocr() -> None:
    """The geometry is ambiguous on its own: the OCR'd title strips decide (and name it)."""
    engine = TitleBlockEngine()
    report = PageTriage(ocr=OcrReader(engine=engine)).classify(_refusal_sheet(words=False))
    page = report.pages[0]
    assert engine.calls > 0
    assert page.cpt_score >= 4.0
    assert page.profile_name == "van-der-straaten"
    assert page.page_class is PageClass.CPT_GRAPH


def test_a_short_curve_sheet_with_words_but_no_known_layout_is_a_cpt_sheet() -> None:
    """Readable CPT keywords + the graph frame: a short curve is enough."""
    doc = pymupdf.open()
    synth.draw_cpt_page(doc, synth.SyntheticPageSpec(last_depth_m=REFUSAL_DEPTH_M))
    page = PageTriage(ocr=False).classify(doc).pages[0]
    assert page.page_class is PageClass.CPT_GRAPH


def test_a_ruled_table_of_numbers_does_not_flip() -> None:
    """Guard: a coordinates table (numbers between ruled lines, no curve) stays a table."""
    doc = pymupdf.open()
    synth.add_table_page(doc)
    assert PageTriage(ocr=False).classify(doc).pages[0].page_class is PageClass.TABLE


def test_a_graph_frame_with_almost_no_curve_does_not_flip() -> None:
    """Guard: the frame with a curve of a few segments (an empty sheet) is no sounding."""
    doc = pymupdf.open()
    spec = synth.SyntheticPageSpec(last_depth_m=0.2, words=False)
    garbled.add_garbled_cpt_page(doc, spec)
    page = PageTriage(ocr=False).classify(doc).pages[0]
    assert page.curve_segments < 20
    assert page.page_class is not PageClass.CPT_GRAPH
