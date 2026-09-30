"""Import selected soundings of a triaged PDF report (brief 2026-09-30, piece B).

* Every sounding goes through ``ImportCpt.persist`` -- the one door every CPT
  source uses -- named by its sounding id, under the report's campaign code.
* "the consent flow (409 cpt_refresh_confirmation_required per sounding as
  the GEF import does)": a sounding already in the project is NOT overwritten
  without consent; the outcome carries the old-vs-new diff and nothing is
  written. With consent it is refreshed.
* "PDF_NO_XY when XY was not read (then the CPT cannot be placed: refuse that
  one with a message unless the user typed XY in the UI)".
* Desk-study reprints are never imported (owner answer 2).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import numpy as np
import pytest

from groundmodel.application.import_cpt_pdf import ImportCptPdf
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.pdf_sounding_import_request import PdfSoundingImportRequest
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.dropped_sheet import DroppedSheet
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.report_fingerprint import ReportFingerprint
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding
from groundmodel.shared.exceptions import (
    CptPdfReportNotFoundError,
    CptRefreshConfirmationRequiredError,
)

SHA = "a" * 64
PROJECT = UUID("00000000-0000-0000-0000-000000000001")


def _sounding(sid: str, page: int) -> DigitisedSounding:
    cal = PageCalibration(
        page_number=page,
        coordinate_space="pdf-pt",
        dpi=None,
        depth_reference=DepthReference.DEPTH_BELOW_GROUND,
        panels=(),
        ground_level_m=6.02,
        sounding_id=sid,
    )
    qc = DigitisedCurve(
        kind=PanelKind.QC,
        depth_m=np.array([1.0, 1.02, 1.04]),
        value=np.array([3.0, 4.0, 5.0]),
        clipped=np.zeros(3, dtype=bool),
        source=GraphKind.VECTOR,
    )
    return DigitisedSounding(
        sounding_id=sid, page_numbers=(page,), calibrations=(cal,), curves={PanelKind.QC: qc}
    )


def _listed(key: str, page: int, placed: bool) -> ReportSounding:
    return ReportSounding(
        key=key,
        sounding_id=key,
        origin=CptOrigin.CAMPAIGN,
        page_numbers=(page,),
        graph_kind=GraphKind.VECTOR,
        ground_level_m=6.02,
        z_epsg=5710,
        x=66980.21 if placed else None,
        y=224746.0 if placed else None,
        epsg=31370 if placed else None,
        test_date="28-2-2024",
        curves=("qc",),
    )


@pytest.fixture
def store(tmp_path: Path) -> PdfReportStore:
    """A store holding one triaged report: 110 (placed), 7 (no XY), a DOV reprint."""
    store = PdfReportStore(tmp_path)
    digest = PdfReportDigest(
        file_sha=SHA,
        page_count=300,
        class_counts={},
        campaign=(_listed("110", 231, True), _listed("7", 175, False)),
        unknown=(),
        dropped=(DroppedSheet("GEO-22/040-S2", (59,), "desk-study", "look it up in DOV"),),
        fingerprint=ReportFingerprint(campaign_codes=("CAMZ-001",)),
        ocr_available=False,
    )
    store.remember(
        PROJECT,
        CachedPdfReport(
            path=tmp_path / "r.pdf",
            file_name="camz-001.pdf",
            digest=digest,
            soundings={"110": _sounding("110", 231), "7": _sounding("7", 175)},
        ),
    )
    return store


class _Persist:
    """A stand-in for ``ImportCpt.persist`` recording what it was handed."""

    def __init__(self, outcome: Any = None) -> None:
        self.calls: list[tuple[GEFParseResult, str, bool]] = []
        self._outcome = outcome

    async def __call__(
        self,
        result: GEFParseResult,
        name: str,
        app_project_id: UUID | None = None,
        *,
        confirm_refresh: bool = False,
    ) -> ImportCptResult:
        self.calls.append((result, name, confirm_refresh))
        if isinstance(self._outcome, Exception):
            raise self._outcome
        return ImportCptResult(
            cpt_id=uuid4(), issues=result.issues, refreshed=bool(self._outcome), name=name
        )


def _use_case(store: PdfReportStore, persist: _Persist) -> ImportCptPdf:
    session = AsyncMock()
    return ImportCptPdf(session, store=store, persist=persist)


async def test_a_selected_sounding_goes_through_the_one_cpt_door(store: PdfReportStore) -> None:
    """110 is persisted as '110' under the campaign code, and reported imported."""
    persist = _Persist()
    outcomes = await _use_case(store, persist).execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key="110")], confirm_refresh=False
    )
    assert [o.status for o in outcomes] == ["imported"]
    result, name, _ = persist.calls[0]
    assert name == "110"
    assert result.header.project_id == "CAMZ-001"
    assert result.import_provenance is not None
    assert result.import_provenance["report_file_name"] == "camz-001.pdf"


async def test_a_sounding_already_in_the_project_asks_before_it_is_overwritten(
    store: PdfReportStore,
) -> None:
    """Without consent: 'confirmation_required' with the diff, and nothing refreshed."""
    ask = CptRefreshConfirmationRequiredError(
        existing_id=uuid4(),
        name="110",
        old_max_depth_m=30.0,
        new_max_depth_m=30.5,
        old_n_rows=1500,
        new_n_rows=1480,
        n_errors=0,
        n_warnings=1,
    )
    outcomes = await _use_case(store, _Persist(ask)).execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key="110")], confirm_refresh=False
    )
    (outcome,) = outcomes
    assert outcome.status == "confirmation_required"
    assert outcome.code == "cpt_refresh_confirmation_required"
    assert outcome.diff is not None
    assert outcome.diff["old_n_rows"] == 1500


async def test_with_consent_the_sounding_is_refreshed(store: PdfReportStore) -> None:
    """With consent the refresh goes ahead and says so."""
    persist = _Persist(outcome=True)
    outcomes = await _use_case(store, persist).execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key="110")], confirm_refresh=True
    )
    assert outcomes[0].status == "refreshed"
    assert persist.calls[0][2] is True


async def test_a_sounding_without_a_position_is_refused_unless_typed(
    store: PdfReportStore,
) -> None:
    """7 prints no XY: refused with a message; typed XY imports it, marked 'user'."""
    persist = _Persist()
    refused = await _use_case(store, persist).execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key="7")], confirm_refresh=False
    )
    assert refused[0].status == "refused"
    assert refused[0].code == "pdf_no_xy"
    assert persist.calls == []
    typed = await _use_case(store, persist).execute(
        PROJECT,
        SHA,
        [PdfSoundingImportRequest(key="7", x=67000.0, y=224800.0, epsg=31370)],
        confirm_refresh=False,
    )
    assert typed[0].status == "imported"
    provenance = persist.calls[0][0].import_provenance
    assert provenance is not None
    assert provenance["header_sources"]["x"] == "user"


async def test_a_desk_study_reprint_is_never_imported(store: PdfReportStore) -> None:
    """A desk-study id is not offered, so asking for it imports nothing."""
    persist = _Persist()
    outcomes = await _use_case(store, persist).execute(
        PROJECT, SHA, [PdfSoundingImportRequest(key="GEO-22/040-S2")], confirm_refresh=False
    )
    assert outcomes[0].status == "refused"
    assert outcomes[0].code == "pdf_sounding_not_offered"
    assert persist.calls == []


async def test_an_unknown_report_is_reported_as_such(store: PdfReportStore) -> None:
    """A sha the store never triaged raises the not-found error (API: 404)."""
    with pytest.raises(CptPdfReportNotFoundError):
        await _use_case(store, _Persist()).execute(
            PROJECT, "b" * 64, [PdfSoundingImportRequest(key="110")], confirm_refresh=False
        )
