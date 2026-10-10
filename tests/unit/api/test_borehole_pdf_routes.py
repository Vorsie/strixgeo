"""The ``/borehole/pdf`` routes of the borehole-log PDF import dialog (phase 2, 2026-10-10).

"The same user path as the CPT one", in the brief's words:

* ``POST /borehole/pdf/triage``: the upload is spooled keyed by its sha256 and
  triaged as a JOB with progress, cancel and cache-by-sha (the CPT triage's
  semantics); a non-PDF is 400;
* ``GET /borehole/pdf/triage/{job_id}``: the SSE stream; its terminal event
  lists one row per borehole with the findings the import asks about;
* ``GET /borehole/pdf/page/{sha}/{page}.png``: the row thumbnails;
* ``POST /borehole/pdf/import``: consented (409
  ``borehole_refresh_confirmation_required`` + the diff), and REFUSES (422) a
  borehole whose ``CRS_ASSUMED`` / ``WATER_UNIT_ASSUMED`` was not confirmed.

TestClient against the router alone; a real triage (no OCR) of the parser
tests' synthetic reports; the import use case is stubbed where the route's own
mapping is under test.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from groundmodel.api.routers import borehole_pdf
from groundmodel.application.import_borehole_file_result import ImportBoreholeFileResult
from groundmodel.application.import_borehole_pdf import ImportBoreholePdf
from groundmodel.application.imported_boring import ImportedBoring
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_report_store import (
    get_borehole_pdf_report_store,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.exceptions import (
    BoreholePdfImportRefusedError,
    BoreholeRefreshConfirmationRequiredError,
    BoreholeRefreshRefusedError,
)

from ..infrastructure.parsers.borehole.pdf import _synthetic_borehole_pdf as synth

PROJECT = uuid4()


@pytest.fixture(scope="module")
def profile_bytes() -> bytes:
    """B-T2: X/Y without a named system, "GWS: 380"."""
    return bytes(synth.build_boorprofiel_pdf(water="380").tobytes())


@pytest.fixture
def client(tmp_path: Path):  # type: ignore[no-untyped-def]
    """The router with a temp store, a fresh job registry and a triager without OCR."""
    store = PdfReportStore(tmp_path)
    registry = JobRegistry()
    app = FastAPI()
    app.include_router(borehole_pdf.router)
    app.dependency_overrides[get_borehole_pdf_report_store] = lambda: store
    app.dependency_overrides[get_job_registry] = lambda: registry
    app.dependency_overrides[borehole_pdf.get_borehole_pdf_triager_factory] = lambda: (
        lambda: BoreholePdfTriager(ocr=None)
    )
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
        "/borehole/pdf/triage",
        files={"file": ("profielen.pdf", data, "application/pdf")},
        data={"project_id": str(PROJECT)},
    )
    assert spawn.status_code == 202, spawn.text
    body = spawn.json()
    stream = client.get(f"/borehole/pdf/triage/{body['job_id']}")
    return body["file_sha"], _sse(stream.text)


def test_the_triage_runs_as_a_job_and_lists_each_borehole_with_its_findings(
    client: TestClient, profile_bytes: bytes
) -> None:
    """202 + job id + sha; ticks, then one row per borehole with CRS + water findings."""
    sha, events = _triage(client, profile_bytes)

    assert sha == hashlib.sha256(profile_bytes).hexdigest()
    assert {"phase": "classify", "done": 1, "total": 1, "ocr": False} in events
    done = events[-1]
    assert done["type"] == "done"
    [row] = done["result"]["boreholes"]
    assert row["key"] == "B-T2@p1"
    assert row["crs_assumed"] is True and row["water_unit_assumed"] is True
    assert {"CRS_ASSUMED", "WATER_UNIT_ASSUMED"} <= {f["code"] for f in row["findings"]}
    assert done["result"]["file_name"] == "profielen.pdf"


def test_a_file_that_is_not_a_pdf_is_refused(client: TestClient) -> None:
    """A .pdf name on non-PDF bytes is a 400, nothing spooled."""
    response = client.post(
        "/borehole/pdf/triage",
        files={"file": ("report.pdf", b"<boring/>", "application/pdf")},
        data={"project_id": str(PROJECT)},
    )
    assert response.status_code == 400


def test_a_page_renders_as_a_png_thumbnail(client: TestClient, profile_bytes: bytes) -> None:
    """GET page PNG: 200 image/png for a real page, 404 past the last page."""
    sha, _ = _triage(client, profile_bytes)
    ok = client.get(f"/borehole/pdf/page/{sha}/1.png", params={"project_id": str(PROJECT)})
    assert ok.status_code == 200
    assert ok.content[:8] == b"\x89PNG\r\n\x1a\n"
    missing = client.get(f"/borehole/pdf/page/{sha}/9.png", params={"project_id": str(PROJECT)})
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "borehole_pdf_page_unknown"


def _import_body(sha: str, **item: Any) -> dict[str, Any]:
    return {
        "project_id": str(PROJECT),
        "file_sha": sha,
        "boreholes": [{"key": "B-T2@p1", **item}],
    }


def test_the_import_hands_each_rows_confirmations_to_the_use_case(
    client: TestClient, profile_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``crs`` {epsg, scope} and ``water_unit_confirmed`` travel per borehole; 201 on new."""
    sha, _ = _triage(client, profile_bytes)
    seen: dict[str, Any] = {}

    async def execute(self, project_id, file_sha, requests, *, confirm_refresh=False):  # type: ignore[no-untyped-def]
        seen.update(requests=requests, confirm=confirm_refresh)
        return ImportBoreholeFileResult(
            boreholes=[ImportedBoring(borehole_id=uuid4(), name="B-T2", test_id="B-T2")]
        )

    monkeypatch.setattr(ImportBoreholePdf, "execute", execute)
    response = client.post(
        "/borehole/pdf/import",
        json=_import_body(sha, crs={"epsg": 31370, "scope": "report"}, water_unit_confirmed=True),
    )

    assert response.status_code == 201, response.text
    [request] = seen["requests"]
    assert (request.key, request.crs_epsg, request.crs_scope) == ("B-T2@p1", 31370, "report")
    assert request.water_unit_confirmed is True
    assert seen["confirm"] is False
    assert response.json()["boreholes"][0]["name"] == "B-T2"


def test_an_unconfirmed_assumption_is_a_422_naming_the_borehole_and_its_codes(
    client: TestClient, profile_bytes: bytes
) -> None:
    """The real use case: no confirmation on B-T2 = 422, the codes listed."""
    sha, _ = _triage(client, profile_bytes)

    response = client.post("/borehole/pdf/import", json=_import_body(sha))

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "borehole_pdf_assumption_unconfirmed"
    assert detail["boreholes"][0]["codes"] == ["CRS_ASSUMED", "WATER_UNIT_ASSUMED"]


def test_a_scope_outside_this_or_report_is_a_validation_error(
    client: TestClient, profile_bytes: bytes
) -> None:
    """The CRS scope is "this" or "report"; anything else is refused by the schema."""
    sha, _ = _triage(client, profile_bytes)
    response = client.post(
        "/borehole/pdf/import", json=_import_body(sha, crs={"epsg": 31370, "scope": "all"})
    )
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_a_borehole_already_in_the_project_is_a_409_with_the_diff(
    client: TestClient, profile_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The XML import's consent code and diffs; with ``confirm_refresh`` a 200."""
    sha, _ = _triage(client, profile_bytes)
    diff = {"borehole_id": str(uuid4()), "name": "B-T2", "test_id": "B-T2"}

    async def ask(self, project_id, file_sha, requests, *, confirm_refresh=False):  # type: ignore[no-untyped-def]
        if not confirm_refresh:
            raise BoreholeRefreshConfirmationRequiredError([diff])
        return ImportBoreholeFileResult(
            boreholes=[
                ImportedBoring(borehole_id=uuid4(), name="B-T2", test_id="B-T2", refreshed=True)
            ]
        )

    monkeypatch.setattr(ImportBoreholePdf, "execute", ask)
    body = _import_body(sha, crs={"epsg": 31370, "scope": "this"}, water_unit_confirmed=True)

    first = client.post("/borehole/pdf/import", json=body)
    assert first.status_code == 409
    assert first.json()["detail"]["code"] == "borehole_refresh_confirmation_required"
    assert first.json()["detail"]["diffs"] == [diff]

    second = client.post("/borehole/pdf/import", json={**body, "confirm_refresh": True})
    assert second.status_code == 200
    assert second.json()["boreholes"][0]["refreshed"] is True


def test_a_refused_refresh_and_a_refused_request_are_422s(
    client: TestClient, profile_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``borehole_refresh_refused`` and every ``borehole_pdf_*`` refusal answer 422."""
    sha, _ = _triage(client, profile_bytes)
    body = _import_body(sha, crs={"epsg": 31370, "scope": "this"}, water_unit_confirmed=True)

    async def refuse_refresh(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        raise BoreholeRefreshRefusedError("parse_errors", "nothing to store")

    monkeypatch.setattr(ImportBoreholePdf, "execute", refuse_refresh)
    response = client.post("/borehole/pdf/import", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "borehole_refresh_refused"

    async def refuse_repeat(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        raise BoreholePdfImportRefusedError(
            "borehole_pdf_repeat_choose_one", "tick one print", [{"key": "B-T2@p1"}]
        )

    monkeypatch.setattr(ImportBoreholePdf, "execute", refuse_repeat)
    response = client.post("/borehole/pdf/import", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "borehole_pdf_repeat_choose_one"


def test_an_import_of_a_report_the_backend_forgot_is_a_404(client: TestClient) -> None:
    """A restarted backend: ``borehole_pdf_report_unknown``, the dialog picks it again."""
    response = client.post("/borehole/pdf/import", json=_import_body("c" * 64))
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "borehole_pdf_report_unknown"
