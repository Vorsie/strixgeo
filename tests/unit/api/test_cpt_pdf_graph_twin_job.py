"""The triage job spawns the background read of the graph sheets (owner 2026-10-14).

Owner dogfeed on the packaged 0.1.6 (report Z2255777): "sondering wordt
gelezen is traag". After the triage of a report finishes, the graph sheets of
every printed-table sounding are read in the background, with progress the
dialog shows ("Grafiekbladen lezen ({done}/{total})..."):

* the triage's ``done`` result names the follow-up job (``graph_job_id``,
  additive) when the report has graph sheets to read, and only then;
* that job's stream ticks phase ``graph`` per sounding (with its ``key``, so
  the dialog knows which overlay is ready) and ends with what it read;
* a triage answered from memory after the read spawns nothing (cached).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from groundmodel.api.routers import cpt_pdf
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import (
    PdfReportStore,
    get_pdf_report_store,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

from ..infrastructure.parsers.cpt.pdf import _synthetic_cpt_pdf as traced
from ..infrastructure.parsers.cpt.pdf import _synthetic_table_pdf as synth

PROJECT = uuid4()


@pytest.fixture
def client(tmp_path: Path):  # type: ignore[no-untyped-def]
    """The router with a temp store, a fresh registry and no-OCR readers."""
    store = PdfReportStore(tmp_path)
    registry = JobRegistry()
    app = FastAPI()
    app.include_router(cpt_pdf.router)
    app.dependency_overrides[get_pdf_report_store] = lambda: store
    app.dependency_overrides[get_job_registry] = lambda: registry
    app.dependency_overrides[cpt_pdf.get_pdf_triager_factory] = lambda: (
        lambda: PdfReportTriager(ocr=False)
    )
    app.dependency_overrides[cpt_pdf.get_pdf_graph_detector_factory] = lambda: (
        lambda: CptPdfDigitiser(ocr=False)
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


def _triage(client: TestClient, data: bytes) -> dict[str, Any]:
    """Upload + drain the triage stream; return its terminal event."""
    spawn = client.post(
        "/cpt/pdf/triage",
        files={"file": ("report.pdf", data, "application/pdf")},
        data={"project_id": str(PROJECT)},
    )
    assert spawn.status_code == 202, spawn.text
    events = _sse(client.get(f"/cpt/pdf/triage/{spawn.json()['job_id']}").text)
    return events[-1]


def test_the_triage_names_the_background_graph_read_and_its_stream_ticks_per_sounding(
    client: TestClient,
) -> None:
    """Done -> ``graph_job_id``; its stream: 0/1, then 1/1 for CPTE001, then done."""
    done = _triage(client, bytes(synth.table_report().tobytes()))
    assert done["type"] == "done"
    job_id = done["result"]["graph_job_id"]
    assert isinstance(job_id, str)

    events = _sse(client.get(f"/cpt/pdf/triage/{job_id}").text)

    assert events[0] == {"phase": "graph", "done": 0, "total": 1, "ocr": False}
    assert {"phase": "graph", "done": 1, "total": 1, "ocr": False, "key": synth.SOUNDING} in events
    assert events[-1] == {"type": "done", "result": {"read": [synth.SOUNDING], "total": 1}}


def test_a_report_without_graph_sheets_to_read_spawns_no_background_job(
    client: TestClient,
) -> None:
    """A traced report has no printed table: the digest is answered as before."""
    doc = traced.synthetic_cpt_pdf(traced.SyntheticPageSpec(sounding_id="S1", x=1.0, y=2.0))
    done = _triage(client, bytes(doc.tobytes()))
    assert done["type"] == "done"
    assert "graph_job_id" not in done["result"]


def test_a_triage_answered_from_memory_after_the_read_spawns_nothing(
    client: TestClient,
) -> None:
    """Cached per report: the second triage of the same file has nothing left to read."""
    data = bytes(synth.table_report().tobytes())
    first = _triage(client, data)
    _sse(client.get(f"/cpt/pdf/triage/{first['result']['graph_job_id']}").text)

    again = _triage(client, data)

    assert again["type"] == "done"
    assert "graph_job_id" not in again["result"]
