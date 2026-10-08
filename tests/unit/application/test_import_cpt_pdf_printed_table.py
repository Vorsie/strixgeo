"""Importing a sounding read from its printed table (owner test 2026-10-08).

* The import goes through the same door (``ImportCpt.persist``) as every
  digitised sounding; the stored ground level is the table's printed level +
  depth, and the provenance says so (``ground_level_m`` sourced
  "printed-table", not "sheet").
* A printed-table sounding has no calibration: a typed ground level or a
  posted calibration never re-reads it (there is no curve to re-read).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.digitise_cpt_pdf_sounding import DigitiseCptPdfSounding
from groundmodel.application.import_cpt_pdf import ImportCptPdf
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.pdf_sounding_import_request import PdfSoundingImportRequest
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

from ..infrastructure.parsers.cpt.pdf import _synthetic_table_pdf as synth

SHA = "b" * 64
PROJECT = UUID("00000000-0000-0000-0000-000000000002")


@pytest.fixture
def store(tmp_path: Path) -> PdfReportStore:
    """A store holding the synthetic printed-table report, triaged."""
    doc = synth.table_report()
    path = tmp_path / "report.pdf"
    doc.save(path)
    digest, soundings = PdfReportTriager(ocr=False).run(doc, SHA)
    store = PdfReportStore(tmp_path)
    store.remember(
        PROJECT,
        CachedPdfReport(path=path, file_name="report.pdf", digest=digest, soundings=soundings),
    )
    return store


class _Persist:
    """A stand-in for ``ImportCpt.persist`` recording what it was handed."""

    def __init__(self) -> None:
        self.calls: list[GEFParseResult] = []

    async def __call__(self, result: GEFParseResult, name: str, *_: Any, **__: Any) -> Any:
        self.calls.append(result)
        return ImportCptResult(cpt_id=uuid4(), issues=result.issues, refreshed=False, name=name)


async def test_the_ground_level_is_stored_as_derived_from_the_printed_table(
    store: PdfReportStore,
) -> None:
    """Z = TAW + D of the table; header_sources names the table, not the sheet."""
    persist = _Persist()
    outcomes = await ImportCptPdf(AsyncMock(), store=store, persist=persist).execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key=synth.SOUNDING)], confirm_refresh=False
    )
    assert [o.status for o in outcomes] == ["imported"]
    (result,) = persist.calls
    assert result.header.z == pytest.approx(synth.GROUND_LEVEL)
    assert result.header.project_id == synth.REPORT
    assert result.import_provenance is not None
    assert result.import_provenance["header_sources"]["ground_level_m"] == "printed-table"


def test_a_typed_ground_level_does_not_re_read_a_printed_table(store: PdfReportStore) -> None:
    """No calibration to re-read through: the table's own sounding comes back."""
    use_case = DigitiseCptPdfSounding(store)
    base = store.require(PROJECT, SHA).soundings[synth.SOUNDING]
    assert use_case.sounding(PROJECT, SHA, synth.SOUNDING, ground_level_m=7.0) is base


def test_a_posted_calibration_is_refused_for_a_printed_table(store: PdfReportStore) -> None:
    """A calibration names a graph page; a printed-table sounding has none to apply."""
    use_case = DigitiseCptPdfSounding(store)
    fake = {
        "page_number": 2,
        "coordinate_space": "pdf-pt",
        "dpi": None,
        "depth_reference": "depth-below-ground",
        "panels": [],
    }
    with pytest.raises(ValueError, match="printed table"):
        use_case.sounding(PROJECT, SHA, synth.SOUNDING, calibrations=[fake])
