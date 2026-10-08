"""Triage of a borehole-log report (owner 2026-10-08, "go, start with the boorstaat").

The rules pinned here, in the brief's words:

* every page gets a class: borehole-log sheet, continuation sheet of the same
  borehole, legend, cover/table/other, photo page; a page without a usable
  text layer is "needs OCR" when OCR is not run, never guessed;
* log sheets are grouped into boreholes: name, sheet range, the printed
  X/Y / ground level / date / driller / project code, the depth covered, and
  a text-layer-vs-needs-OCR verdict;
* the digest is JSON-ready (``to_dict``).
"""

from __future__ import annotations

import json

import pymupdf
import pytest

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class import (
    BoreholePageClass,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)

from . import _synthetic_borehole_pdf as synth


@pytest.fixture(scope="module")
def triage():
    """Triage of: prose page, two boorstaat sheets of B-T1, legend, outlined page."""
    doc = synth.build_boorstaat_pdf(extra_pages=True)
    return BoreholePdfTriager(ocr=None).triage(doc, file_name="synthetic.pdf")


def test_each_page_gets_its_class(triage) -> None:
    """Prose = other; sheet 1 = log sheet; sheet 2 = continuation; legend; outlined = needs OCR."""
    classes = [p.page_class for p in triage.digest.pages]
    assert classes == [
        BoreholePageClass.OTHER,
        BoreholePageClass.LOG_SHEET,
        BoreholePageClass.CONTINUATION_SHEET,
        BoreholePageClass.LEGEND,
        BoreholePageClass.NEEDS_OCR,
    ]


def test_a_two_sheet_boorstaat_is_one_borehole_with_its_sheet_range(triage) -> None:
    """Sheets 2-3 of the report are ONE borehole B-T1, read with the boorstaat profile."""
    (borehole,) = triage.digest.boreholes
    assert borehole.name == "B-T1"
    assert borehole.pages == (2, 3)
    assert borehole.profile == "boorstaat"
    assert borehole.text_verdict == "text"


def test_the_printed_header_fields_are_read_as_printed(triage) -> None:
    """XY in the system the sheet names (Lambert72 -> 31370), ground in mTAW, date, driller."""
    (borehole,) = triage.digest.boreholes
    assert borehole.x == pytest.approx(68000.50)
    assert borehole.y == pytest.approx(224000.25)
    assert borehole.epsg == 31370
    assert borehole.ground_level_m == pytest.approx(6.5)
    assert borehole.z_epsg == 5710
    assert borehole.date_iso == "2024-01-09"
    assert borehole.driller == "Ploeg A"
    assert borehole.project_code == "00.00-000 TEST-001"


def test_the_depth_covered_comes_from_the_printed_levels(triage) -> None:
    """Ground 650 cm TAW, first level 650 (0.00 m), last level -78 (7.28 m)."""
    (borehole,) = triage.digest.boreholes
    assert borehole.depth_top_m == pytest.approx(0.0)
    assert borehole.depth_base_m == pytest.approx(7.28)


def test_a_page_without_a_text_layer_needs_ocr_and_is_never_guessed(triage) -> None:
    """The outlined page carries no borehole and says so: needs OCR, no name invented."""
    outlined = triage.digest.pages[4]
    assert outlined.page_class is BoreholePageClass.NEEDS_OCR
    assert outlined.text_source == "needs-ocr"
    assert outlined.borehole_name is None
    assert triage.digest.needs_ocr_pages == (5,)


def test_the_digest_is_json_ready(triage) -> None:
    """``to_dict`` survives a JSON round trip and names the counts per class."""
    data = json.loads(json.dumps(triage.digest.to_dict()))
    assert data["page_count"] == 5
    assert data["class_counts"] == {
        "other": 1,
        "log-sheet": 1,
        "continuation-sheet": 1,
        "legend": 1,
        "needs-ocr": 1,
    }
    assert data["boreholes"][0]["name"] == "B-T1"
    assert data["boreholes"][0]["pages"] == [2, 3]


def test_max_pages_stops_a_huge_report_early() -> None:
    """A page cap triages only the first pages and says how many were skipped."""
    doc = synth.build_boorstaat_pdf(extra_pages=True)
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="x.pdf", max_pages=2)
    assert len(result.digest.pages) == 2
    assert result.digest.pages_not_triaged == 3


def test_a_lab_sheet_with_a_graph_legend_is_not_the_legend_page() -> None:
    """ "Legende" printed beside a graph mid-page (a triaxial sheet) is not a legend page."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((60, 60), "Triaxiaalproef CD Monsternummer 21/0000-B1/N001", fontsize=9)
    page.insert_text((300, 420), "Legende: deviatorspanning tegen axiale rek", fontsize=8)
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="lab.pdf")
    assert result.digest.pages[0].page_class is BoreholePageClass.OTHER


def test_report_text_mentioning_a_borehole_log_is_not_a_log_sheet() -> None:
    """Prose that says "zie boorbeschrijving" mid-page names no log: the page is other."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((60, 60), "3. Resultaten van het grondonderzoek", fontsize=11)
    page.insert_text(
        (60, 400), "De lagen zijn beschreven in de boorbeschrijving in bijlage.", fontsize=9
    )
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="text.pdf")
    assert result.digest.pages[0].page_class is BoreholePageClass.OTHER
    assert result.digest.boreholes == ()
