"""The ``/cpt/pdf`` routes of the import dialog (brief 2026-09-30, piece B).

TestClient against the router alone, with a fake triager (canned digest) and a
fake ``persist``; the report bytes are a real synthetic PDF so the page and
overlay renders are real.

* ``POST /cpt/pdf/triage``: the upload is spooled keyed by its sha256 and
  triaged as a JOB with progress (the DOV stream pattern); a non-PDF is 400,
  an over-cap upload 413.
* ``GET /cpt/pdf/page/{sha}/{page}.png``: the page thumbnail.
* ``POST /cpt/pdf/digitise``: the series, the calibration used, the
  assumptions and an overlay PNG per page; re-runs on every calibration change.
* ``POST /cpt/pdf/import``: per sounding, the GEF import's own consent flow.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from groundmodel.api.routers import cpt_pdf
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.dropped_sheet import DroppedSheet
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import (
    PdfReportStore,
    get_pdf_report_store,
)
from groundmodel.infrastructure.parsers.cpt.pdf.report_fingerprint import ReportFingerprint
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note import ReportSoundingNote
from groundmodel.shared.exceptions import (
    CptRefreshConfirmationRequiredError,
    TriageCancelled,
)

from ..infrastructure.parsers.cpt.pdf import _synthetic_cpt_pdf as synth

PROJECT = uuid4()


@pytest.fixture(scope="module")
def report_bytes() -> bytes:
    """A one-sounding synthetic report."""
    doc = synth.synthetic_cpt_pdf(synth.SyntheticPageSpec(sounding_id="S1", x=1.0, y=2.0))
    return bytes(doc.tobytes())


# What the last fake triage was handed (stop flag, OCR cache), for the tests.
_LAST_RUN: dict[str, Any] = {}


class _FakeTriager:
    """Stands in for PdfReportTriager: ticks progress, returns a canned triage."""

    def run(
        self,
        doc: pymupdf.Document,
        file_sha: str,
        progress: Any = None,
        should_stop: Any = None,
        ocr_cache: Any = None,
    ) -> tuple[PdfReportDigest, dict[str, DigitisedSounding]]:
        _LAST_RUN.update(should_stop=should_stop, ocr_cache=ocr_cache)
        if progress is not None:
            progress("classify", 1, 1)
            progress("classify", 1, 1, ocr=True)
            progress("digitise", 1, 1)
        sounding = CptPdfDigitiser(ocr=False).digitise_page(doc, 1)
        listed = ReportSounding(
            key="S1",
            sounding_id="S1",
            origin=CptOrigin.CAMPAIGN,
            page_numbers=(1,),
            graph_kind=GraphKind.VECTOR,
            ground_level_m=3.0,
            x=150000.0,
            y=200000.0,
            epsg=31370,
            curves=("qc", "fs"),
            warnings=("2 point(s) on an axis maximum: the true value is higher",),
            notes=(ReportSoundingNote("CLIPPED_POINTS", {"count": 2}),),
        )
        digest = PdfReportDigest(
            file_sha=file_sha,
            page_count=1,
            class_counts={"cpt-graph": 1},
            campaign=(listed,),
            unknown=(),
            dropped=(DroppedSheet("GEO-22/040-S2", (5,), "desk-study", "look it up in DOV"),),
            fingerprint=ReportFingerprint(campaign_codes=("TEST-001",)),
            ocr_available=False,
        )
        return digest, {"S1": sounding}


@pytest.fixture
def client(tmp_path: Path):  # type: ignore[no-untyped-def]
    """The router with a temp store, a fresh job registry and the fake triager."""
    store = PdfReportStore(tmp_path)
    registry = JobRegistry()
    app = FastAPI()
    app.include_router(cpt_pdf.router)
    app.dependency_overrides[get_pdf_report_store] = lambda: store
    app.dependency_overrides[get_job_registry] = lambda: registry
    app.dependency_overrides[cpt_pdf.get_pdf_triager_factory] = lambda: _FakeTriager
    app.dependency_overrides[get_session] = lambda: AsyncMock()
    with TestClient(app) as test_client:
        yield test_client


def _sse(text: str) -> list[dict[str, Any]]:
    return [
        json.loads(line[len("data: ") :])
        for frame in text.split("\n\n")
        for line in frame.split("\n")
        if line.startswith("data: ")
    ]


def _triage(client: TestClient, data: bytes) -> tuple[str, list[dict[str, Any]]]:
    """Upload + drain the job stream; return the sha and the events."""
    spawn = client.post(
        "/cpt/pdf/triage",
        files={"file": ("camz-001.pdf", data, "application/pdf")},
        data={"project_id": str(PROJECT)},
    )
    assert spawn.status_code == 202, spawn.text
    body = spawn.json()
    stream = client.get(f"/cpt/pdf/triage/{body['job_id']}")
    return body["file_sha"], _sse(stream.text)


def test_triage_runs_as_a_job_and_streams_progress_then_the_digest(
    client: TestClient, report_bytes: bytes
) -> None:
    """202 + job id + the file's sha256; the stream ticks, then carries the digest."""
    sha, events = _triage(client, report_bytes)
    assert sha == hashlib.sha256(report_bytes).hexdigest()
    assert {"phase": "classify", "done": 1, "total": 1, "ocr": False} in events
    done = events[-1]
    assert done["type"] == "done"
    assert [s["sounding_id"] for s in done["result"]["campaign"]] == ["S1"]
    assert done["result"]["desk_study_ids"] == ["GEO-22/040-S2"]


def test_a_tick_says_when_ocr_is_what_the_triage_is_doing(
    client: TestClient, report_bytes: bytes
) -> None:
    """Additive ``ocr`` flag next to phase / done / total (old clients ignore it)."""
    _, events = _triage(client, report_bytes)
    assert {"phase": "classify", "done": 1, "total": 1, "ocr": True} in events


def test_the_triage_job_hands_the_worker_a_stop_flag_and_the_reports_ocr_cache(
    client: TestClient, report_bytes: bytes
) -> None:
    """The worker can be stopped (closing the dialog) and reuses the OCR words on disk."""
    _LAST_RUN.clear()
    _triage(client, report_bytes)
    assert callable(_LAST_RUN["should_stop"])
    assert _LAST_RUN["should_stop"]() is False
    assert _LAST_RUN["ocr_cache"] is not None


class _CancelledTriager:
    """A triage whose worker saw the stop flag after page 1 of 97."""

    def run(self, doc: Any, file_sha: str, progress: Any = None, **_: Any) -> Any:
        raise TriageCancelled(1, 97)


def test_a_cancelled_triage_ends_quietly_not_as_an_error(
    client: TestClient, report_bytes: bytes
) -> None:
    """A cancel is no failure: the stream ends ``cancelled``, never ``error``."""
    client.app.dependency_overrides[cpt_pdf.get_pdf_triager_factory] = lambda: _CancelledTriager
    _, events = _triage(client, report_bytes)
    assert events[-1] == {"type": "cancelled"}
    assert not any(e.get("type") == "error" for e in events)


def test_a_file_that_is_not_a_pdf_is_refused(client: TestClient) -> None:
    """A .pdf name on non-PDF bytes is a 400, nothing spooled."""
    response = client.post(
        "/cpt/pdf/triage",
        files={"file": ("report.pdf", b"#GEF not a pdf", "application/pdf")},
        data={"project_id": str(PROJECT)},
    )
    assert response.status_code == 400


def test_an_upload_over_the_cap_is_refused(
    client: TestClient, report_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Past the byte cap the upload answers 413."""
    monkeypatch.setattr(cpt_pdf, "MAX_PDF_UPLOAD_BYTES", 100)
    response = client.post(
        "/cpt/pdf/triage",
        files={"file": ("big.pdf", report_bytes, "application/pdf")},
        data={"project_id": str(PROJECT)},
    )
    assert response.status_code == 413


def test_a_page_renders_as_a_png_thumbnail(client: TestClient, report_bytes: bytes) -> None:
    """GET page PNG: 200 image/png for a real page, 404 past the last page."""
    sha, _ = _triage(client, report_bytes)
    ok = client.get(f"/cpt/pdf/page/{sha}/1.png", params={"project_id": str(PROJECT)})
    assert ok.status_code == 200
    assert ok.headers["content-type"] == "image/png"
    assert ok.content[:8] == b"\x89PNG\r\n\x1a\n"
    missing = client.get(f"/cpt/pdf/page/{sha}/9.png", params={"project_id": str(PROJECT)})
    assert missing.status_code == 404


def test_digitise_returns_the_series_the_calibration_and_an_overlay(
    client: TestClient, report_bytes: bytes
) -> None:
    """The series, the calibration used (dict), assumptions and one overlay PNG per page."""
    sha, _ = _triage(client, report_bytes)
    response = client.post(
        "/cpt/pdf/digitise",
        json={"project_id": str(PROJECT), "file_sha": sha, "sounding_id": "S1"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["series"]["depth_m"]) > 100
    assert len(body["series"]["depth_m"]) == len(body["series"]["qc_mpa"])
    assert body["calibrations"][0]["page_number"] == 1
    assert isinstance(body["assumptions"], list)
    png = base64.b64decode(body["overlays"][0]["png_base64"])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_digitise_carries_the_notes_as_codes_next_to_the_english_warnings(
    client: TestClient, report_bytes: bytes
) -> None:
    """The overlay answer keeps ``warnings`` and adds ``notes`` (code + params), additively."""
    sha, _ = _triage(client, report_bytes)
    body = client.post(
        "/cpt/pdf/digitise",
        json={"project_id": str(PROJECT), "file_sha": sha, "sounding_id": "S1"},
    ).json()
    assert body["warnings"] == ["2 point(s) on an axis maximum: the true value is higher"]
    assert body["notes"] == [{"code": "CLIPPED_POINTS", "params": {"count": 2}}]


def test_digitise_re_reads_through_an_edited_calibration(
    client: TestClient, report_bytes: bytes
) -> None:
    """Posting an edited calibration dict re-extracts through it (qc tick 20 -> 40)."""
    sha, _ = _triage(client, report_bytes)
    first = client.post(
        "/cpt/pdf/digitise",
        json={"project_id": str(PROJECT), "file_sha": sha, "sounding_id": "S1"},
    ).json()
    cal = first["calibrations"][0]
    for panel in cal["panels"]:
        if panel["kind"] == "qc":
            scale = panel["value_scale"]
            scale["value_a"] *= 2.0
            scale["value_b"] *= 2.0
    second = client.post(
        "/cpt/pdf/digitise",
        json={
            "project_id": str(PROJECT),
            "file_sha": sha,
            "sounding_id": "S1",
            "calibrations": [cal],
        },
    ).json()
    before = [q for q, c in zip(first["series"]["qc_mpa"], first["series"]["qc_clipped"]) if not c]
    after = [q for q, c in zip(second["series"]["qc_mpa"], second["series"]["qc_clipped"]) if not c]
    assert after == pytest.approx([2.0 * q for q in before], abs=1e-6)


def test_unknown_report_and_unknown_sounding_are_404_with_a_code(
    client: TestClient, report_bytes: bytes
) -> None:
    """An untriaged sha and an unlisted sounding answer 404 with machine codes."""
    sha, _ = _triage(client, report_bytes)
    report = client.post(
        "/cpt/pdf/digitise",
        json={"project_id": str(PROJECT), "file_sha": "c" * 64, "sounding_id": "S1"},
    )
    assert report.status_code == 404
    assert report.json()["detail"]["code"] == "cpt_pdf_report_unknown"
    sounding = client.post(
        "/cpt/pdf/digitise",
        json={"project_id": str(PROJECT), "file_sha": sha, "sounding_id": "GEO-22/040-S2"},
    )
    assert sounding.status_code == 404
    assert sounding.json()["detail"]["code"] == "cpt_pdf_sounding_unknown"


def test_import_answers_per_sounding_with_the_gef_consent_flow(
    client: TestClient, report_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """New -> imported; already there -> confirmation_required + diff, nothing written."""
    sha, _ = _triage(client, report_bytes)
    calls: list[bool] = []

    async def fresh(self: ImportCpt, result: Any, name: str, *a: Any, **kw: Any) -> ImportCptResult:
        calls.append(kw.get("confirm_refresh", False))
        return ImportCptResult(cpt_id=uuid4(), issues=result.issues, name=name)

    monkeypatch.setattr(ImportCpt, "persist", fresh)
    body = {"project_id": str(PROJECT), "file_sha": sha, "sounding_ids": ["S1"]}
    imported = client.post("/cpt/pdf/import", json=body)
    assert imported.status_code == 200, imported.text
    assert imported.json()["results"][0]["status"] == "imported"

    async def existing(self: ImportCpt, result: Any, name: str, *a: Any, **kw: Any) -> Any:
        raise CptRefreshConfirmationRequiredError(
            existing_id=uuid4(),
            name=name,
            old_max_depth_m=13.5,
            new_max_depth_m=13.5,
            old_n_rows=675,
            new_n_rows=675,
            n_errors=0,
            n_warnings=0,
        )

    monkeypatch.setattr(ImportCpt, "persist", existing)
    asked = client.post("/cpt/pdf/import", json=body).json()["results"][0]
    assert asked["status"] == "confirmation_required"
    assert asked["code"] == "cpt_refresh_confirmation_required"
    assert asked["diff"]["old_n_rows"] == 675
