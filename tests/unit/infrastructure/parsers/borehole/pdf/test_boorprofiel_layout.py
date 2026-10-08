"""The second layout (boorprofiel): levels in m TAW, X/Y with no system named.

* levels with two decimals in m TAW, depth = ground level - level;
* no ground level printed in the header -> the first level of the first
  sheet is the top of the borehole, and the parse says where it came from;
* a position whose coordinate system the sheet does not name is kept raw and
  never placed on a guessed system (the CPT digitiser's rule).
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser import (
    BoreholePdfDigitiser,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity

from . import _synthetic_borehole_pdf as synth

IDENTITY = PdfReportIdentity(file_name="bp.pdf", file_sha="1" * 64, ocr_available=False)


@pytest.fixture(scope="module")
def parsed():
    """The triage and the one borehole of the boorprofiel report."""
    result = BoreholePdfTriager(ocr=None).triage(synth.build_boorprofiel_pdf(), file_name="bp.pdf")
    (borehole,) = BoreholePdfDigitiser().digitise(result, IDENTITY)
    return result, borehole


def test_the_boorprofiel_profile_reads_the_sheet(parsed) -> None:
    """One borehole B-T2 read with the boorprofiel profile."""
    result, borehole = parsed
    (listed,) = result.digest.boreholes
    assert listed.profile == "boorprofiel"
    assert borehole.header.name == "B-T2"
    assert borehole.header.remark == "Zuigboren"
    assert borehole.header.date_iso == "2024-12-19"
    assert borehole.header.project_code == "TP0001"


def test_levels_in_m_taw_become_depths_below_the_first_level(parsed) -> None:
    """6.61 / 4.11 / 1.61 / 1.11 / -22.49 m TAW -> 0 / 2.50 / 5.00 / 5.50 / 29.10 m."""
    _, borehole = parsed
    assert [(i.depth_top_m, i.depth_base_m) for i in borehole.intervals] == pytest.approx(
        [(0.0, 2.5), (2.5, 5.0), (5.0, 5.5), (5.5, 29.1)]
    )
    assert borehole.header.ground_level_m == pytest.approx(6.61)
    assert borehole.header.ground_level_source == "first-level"
    assert borehole.intervals[2].description == "Veen, zwak zandig, donkerbruin"
    assert borehole.header.surface_text == "akker"


def test_xy_without_a_named_system_is_kept_raw_and_flagged(parsed) -> None:
    """ "X: 67800,00" names no system: the numbers stay, the EPSG stays None, one finding."""
    _, borehole = parsed
    assert borehole.header.x == pytest.approx(67800.0)
    assert borehole.header.y == pytest.approx(224500.0)
    assert borehole.header.epsg is None
    assert "PDF_BOREHOLE_XY_SYSTEM_UNNAMED" in [i.code for i in borehole.issues]
