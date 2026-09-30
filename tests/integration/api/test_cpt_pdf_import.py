"""HTTP round trip of the PDF CPT import: triage -> import -> re-import with consent.

A synthetic one-sounding vector report (the digitiser tests' PyMuPDF builder)
is uploaded to a seeded project, triaged as a job, and its sounding imported:
the CPT stands at the sheet's XY with the sheet's ground level and carries the
"pdf-digitised" provenance. Importing it again is the GEF import's own consent
flow: ``confirmation_required`` + the diff and nothing written, then with
``confirm_refresh`` the same CPT is replaced in place.

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.main import app
from groundmodel.api.routers import cpt_pdf
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import (
    PdfReportStore,
    get_pdf_report_store,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager
from tests.integration.conftest import make_project
from tests.unit.infrastructure.parsers.cpt.pdf import _synthetic_cpt_pdf as synth

X, Y, GROUND = 150000.0, 200000.0, 3.0


@pytest.fixture
def pdf_store(tmp_path: Path) -> Iterator[PdfReportStore]:
    """A throw-away report store, and a triager without OCR (deterministic)."""
    store = PdfReportStore(tmp_path)
    app.dependency_overrides[get_pdf_report_store] = lambda: store
    app.dependency_overrides[cpt_pdf.get_pdf_triager_factory] = lambda: (
        lambda: PdfReportTriager(ocr=False)
    )
    try:
        yield store
    finally:
        app.dependency_overrides.pop(get_pdf_report_store, None)
        app.dependency_overrides.pop(cpt_pdf.get_pdf_triager_factory, None)


def _report() -> bytes:
    """A one-sounding campaign report: S1 at (X, Y), ground level 3.00 m TAW."""
    doc = synth.synthetic_cpt_pdf(
        synth.SyntheticPageSpec(
            sounding_id="S1", x=X, y=Y, test_date="28-2-2024", ground_level=GROUND
        )
    )
    doc[0].insert_text((300, 20), "DOCUMENTNAAM : Proefverslag TEST-001", fontsize=6)
    return bytes(doc.tobytes())


async def _triage(client: AsyncClient, project_id: str) -> dict[str, Any]:
    """Upload + drain the triage job; return the digest."""
    spawn = await client.post(
        "/cpt/pdf/triage",
        files={"file": ("test-001.pdf", _report(), "application/pdf")},
        data={"project_id": project_id},
    )
    assert spawn.status_code == 202, spawn.text
    stream = await client.get(f"/cpt/pdf/triage/{spawn.json()['job_id']}")
    events = [
        json.loads(line[len("data: ") :])
        for line in stream.text.splitlines()
        if line.startswith("data: ")
    ]
    done = events[-1]
    assert done["type"] == "done", events
    return dict(done["result"])


async def _import(
    client: AsyncClient, project_id: str, sha: str, *, confirm: bool = False
) -> dict[str, Any]:
    response = await client.post(
        "/cpt/pdf/import",
        json={
            "project_id": project_id,
            "file_sha": sha,
            "sounding_ids": ["S1"],
            "confirm_refresh": confirm,
        },
    )
    assert response.status_code == 200, response.text
    return dict(response.json()["results"][0])


async def test_a_pdf_sounding_is_imported_at_the_sheets_position_with_its_provenance(
    async_client: AsyncClient, db_session: AsyncSession, pdf_store: PdfReportStore
) -> None:
    """Triage offers S1; importing it stores a CPT at the sheet's XY, stamped pdf-digitised."""
    project = await make_project(db_session)
    digest = await _triage(async_client, str(project.id))
    assert [s["sounding_id"] for s in digest["campaign"]] == ["S1"]

    outcome = await _import(async_client, str(project.id), digest["file_sha"])
    assert outcome["status"] == "imported", outcome

    detail = await async_client.get(
        f"/cpt/{outcome['cpt_id']}", params={"project_id": str(project.id)}
    )
    assert detail.status_code == 200, detail.text
    cpt = detail.json()
    assert (cpt["location_x"], cpt["location_y"], cpt["epsg"]) == (X, Y, 31370)
    assert cpt["elevation_m"] == pytest.approx(GROUND)
    assert cpt["elevation_source"] == "pdf"
    assert cpt["import_provenance"]["source"] == "pdf-digitised"
    assert cpt["import_provenance"]["report_file_name"] == "test-001.pdf"
    assert cpt["import_provenance"]["pages"] == [1]
    assert cpt["n_rows"] > 600

    stored = (
        await db_session.execute(select(CptOrm).where(CptOrm.id == UUID(outcome["cpt_id"])))
    ).scalar_one()
    assert stored.import_provenance is not None
    assert stored.import_provenance["digitiser_version"].startswith("pdf-digitiser")


async def test_reimporting_asks_first_then_replaces_in_place_with_consent(
    async_client: AsyncClient, db_session: AsyncSession, pdf_store: PdfReportStore
) -> None:
    """Second import: confirmation_required + diff, nothing written; with consent: refreshed."""
    project = await make_project(db_session)
    digest = await _triage(async_client, str(project.id))
    first = await _import(async_client, str(project.id), digest["file_sha"])
    assert first["status"] == "imported"

    asked = await _import(async_client, str(project.id), digest["file_sha"])
    assert asked["status"] == "confirmation_required"
    assert asked["code"] == "cpt_refresh_confirmation_required"
    assert asked["cpt_id"] == first["cpt_id"]
    assert asked["diff"]["old_n_rows"] == asked["diff"]["new_n_rows"]

    replaced = await _import(async_client, str(project.id), digest["file_sha"], confirm=True)
    assert replaced["status"] == "refreshed"
    assert replaced["cpt_id"] == first["cpt_id"]
    count = (
        (await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(count) == 1
