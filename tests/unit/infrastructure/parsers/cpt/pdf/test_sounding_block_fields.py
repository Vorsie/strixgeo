"""The sheet's own header: where the sounding stands, when, and on which datum.

Brief 2026-09-30: an imported sounding is placed "at the sheet's XY"; the
Van der Straaten block prints ``X-COÖRDINAAT (Lambert72) : 66980.21``,
``Y-COÖRDINAAT(Lambert72) : 224746.0``, ``DATUM 28-2-2024`` and ``HOOGTE
MAAIVELD 6.02 m TAW``. What the sheet does not print is left unread, never
guessed: a sounding without a read position cannot be placed.
"""

from __future__ import annotations

import pymupdf
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.page_evidence import PageEvidence
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import sheet_date_iso

from . import _synthetic_cpt_pdf as synth


def _triage_one(spec: synth.SyntheticPageSpec) -> PageEvidence:
    """Triage a one-sounding report and return the graph page's evidence."""
    doc = pymupdf.open()
    synth.draw_cpt_page(doc, spec)
    doc[0].insert_text((300, 20), "DOCUMENTNAAM : Proefverslag TEST-001", fontsize=6)
    return PageTriage(ocr=False).classify(doc).pages[0]


@pytest.fixture(scope="module")
def placed() -> PageEvidence:
    """A sheet that prints Lambert72 coordinates, a date and a TAW ground level."""
    return _triage_one(
        synth.SyntheticPageSpec(x=66980.21, y=224746.0, test_date="28-2-2024", ground_level=6.02)
    )


def test_the_printed_lambert72_coordinates_place_the_sounding(placed: PageEvidence) -> None:
    """The printed X and Y (Lambert72) are read, in EPSG 31370."""
    assert placed.x == pytest.approx(66980.21)
    assert placed.y == pytest.approx(224746.0)
    assert placed.epsg == 31370


def test_the_printed_ground_level_and_its_taw_datum_are_read(placed: PageEvidence) -> None:
    """HOOGTE MAAIVELD 6.02 m TAW -> ground level 6.02 on the TAW datum (EPSG 5710)."""
    assert placed.ground_level_m == pytest.approx(6.02)
    assert placed.z_epsg == 5710


def test_the_printed_date_is_kept_as_printed(placed: PageEvidence) -> None:
    """The sheet's DATUM is kept as printed (the raw token)."""
    assert placed.test_date == "28-2-2024"


def test_a_sheet_without_coordinates_is_not_placed() -> None:
    """No printed coordinates: XY and their system stay unread, never guessed."""
    evidence = _triage_one(synth.SyntheticPageSpec())
    assert evidence.x is None
    assert evidence.y is None
    assert evidence.epsg is None


@pytest.mark.parametrize(
    ("printed", "iso"),
    [("28-2-2024", "2024-02-28"), ("31/10/2024", "2024-10-31"), ("2024-01-29", "2024-01-29")],
)
def test_a_printed_day_month_year_date_reads_as_an_iso_date(printed: str, iso: str) -> None:
    """A printed day-month-year date reads as an ISO date."""
    assert sheet_date_iso(printed) == iso


def test_an_unreadable_date_is_not_invented() -> None:
    """A date that is not day-month-year gives None, not a guess."""
    assert sheet_date_iso("week 7") is None
    assert sheet_date_iso("31-2-2024") is None
