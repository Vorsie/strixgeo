"""HTTP round trip of the PDF borehole import: triage -> import -> re-import with consent.

The brief (owner 2026-10-10, phase 2) and the rulings of 2026-10-08, in their
words:

* the chosen boreholes go through "the SAME persistence as ImportBoreholeFile
  uses for a DOV XML borehole": header, the description track verbatim, samples
  with ``sample_label`` + the verbatim id, the water level, and
  ``borehole.import_provenance`` stamped ``pdf-digitised``;
* "the import REFUSES (422) a borehole whose CRS_ASSUMED / WATER_UNIT_ASSUMED
  finding was not confirmed"; confirmed, it is stored;
* "same consented-refresh rule as the XML import": 409
  ``borehole_refresh_confirmation_required`` + the diff and nothing written,
  then with ``confirm_refresh`` the SAME borehole is replaced in place.

Synthetic reports from the parser tests' PyMuPDF builder; no OCR.

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
from groundmodel.api.routers import borehole_pdf
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_report_store import (
    get_borehole_pdf_report_store,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from tests.integration.conftest import make_project
from tests.unit.infrastructure.parsers.borehole.pdf import _synthetic_borehole_pdf as synth


@pytest.fixture
def pdf_store(tmp_path: Path) -> Iterator[PdfReportStore]:
    """A throw-away borehole report store, and a triager without OCR (deterministic)."""
    store: PdfReportStore = PdfReportStore(tmp_path)
    app.dependency_overrides[get_borehole_pdf_report_store] = lambda: store
    app.dependency_overrides[borehole_pdf.get_borehole_pdf_triager_factory] = lambda: (
        lambda: BoreholePdfTriager(ocr=None)
    )
    try:
        yield store
    finally:
        app.dependency_overrides.pop(get_borehole_pdf_report_store, None)
        app.dependency_overrides.pop(borehole_pdf.get_borehole_pdf_triager_factory, None)


async def _triage(client: AsyncClient, project_id: str, data: bytes) -> dict[str, Any]:
    """Upload + drain the triage job; return the listing."""
    spawn = await client.post(
        "/borehole/pdf/triage",
        files={"file": ("boorstaten.pdf", data, "application/pdf")},
        data={"project_id": project_id},
    )
    assert spawn.status_code == 202, spawn.text
    stream = await client.get(f"/borehole/pdf/triage/{spawn.json()['job_id']}")
    events = [
        json.loads(line[len("data: ") :])
        for line in stream.text.splitlines()
        if line.startswith("data: ")
    ]
    done = events[-1]
    assert done["type"] == "done", events
    return dict(done["result"])


def _boorstaat() -> bytes:
    """B-T1: two boorstaat sheets, Lambert72 named, water "[cm-mv]" (nothing assumed)."""
    return bytes(synth.build_boorstaat_pdf().tobytes())


async def test_a_pdf_borehole_is_stored_with_its_track_samples_water_and_provenance(
    async_client: AsyncClient, db_session: AsyncSession, pdf_store: PdfReportStore
) -> None:
    """Triage lists B-T1; the import stores it like a DOV XML borehole, stamped pdf-digitised."""
    project = await make_project(db_session)
    listing = await _triage(async_client, str(project.id), _boorstaat())
    [row] = listing["boreholes"]
    assert row["key"] == "B-T1@p1" and row["importable"] is True

    response = await async_client.post(
        "/borehole/pdf/import",
        json={
            "project_id": str(project.id),
            "file_sha": listing["file_sha"],
            "boreholes": [{"key": "B-T1@p1"}],
        },
    )
    assert response.status_code == 201, response.text
    [boring] = response.json()["boreholes"]
    borehole_id = UUID(boring["borehole_id"])

    stored = (
        await db_session.execute(select(BoreholeOrm).where(BoreholeOrm.id == borehole_id))
    ).scalar_one()
    assert (stored.name, stored.test_id) == ("B-T1", "B-T1")
    assert (stored.location_x, stored.location_y, stored.epsg) == (68000.5, 224000.25, 31370)
    assert stored.elevation_m == pytest.approx(6.5)
    assert stored.elevation_source == "pdf"
    assert stored.water_table_depth_m == pytest.approx(2.0)
    assert stored.import_provenance["source"] == "pdf-digitised"
    assert stored.import_provenance["report_file_name"] == "boorstaten.pdf"
    assert stored.import_provenance["header"]["surface_label"] == "asfalt"

    [track] = (
        (
            await db_session.execute(
                select(ObservationOrm).where(ObservationOrm.borehole_id == borehole_id)
            )
        )
        .scalars()
        .all()
    )
    assert track.observation_type == "lithological_description"
    assert track.source == "pdf-digitised"

    samples = (
        (await db_session.execute(select(SampleOrm).where(SampleOrm.borehole_id == borehole_id)))
        .scalars()
        .all()
    )
    assert sorted((s.sample_number, s.sample_label) for s in samples) == [
        ("1-0000000002", "1"),
        ("S1-0000000001", "S1"),
    ]

    detail = await async_client.get(
        f"/borehole/{borehole_id}", params={"project_id": str(project.id)}
    )
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["import_provenance"]["source"] == "pdf-digitised"
    assert {s["sample_label"] for s in body["samples"]} == {"1", "S1"}


async def test_an_unconfirmed_assumption_is_refused_and_a_confirmed_one_is_stored(
    async_client: AsyncClient, db_session: AsyncSession, pdf_store: PdfReportStore
) -> None:
    """B-T2 ("X:"/"Y:", "GWS: 380"): 422 without the answers, stored with them."""
    project = await make_project(db_session)
    listing = await _triage(
        async_client, str(project.id), bytes(synth.build_boorprofiel_pdf(water="380").tobytes())
    )
    body: dict[str, Any] = {
        "project_id": str(project.id),
        "file_sha": listing["file_sha"],
        "boreholes": [{"key": "B-T2@p1"}],
    }

    refused = await async_client.post("/borehole/pdf/import", json=body)
    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["code"] == "borehole_pdf_assumption_unconfirmed"
    none_stored = (
        (
            await db_session.execute(
                select(BoreholeOrm).where(BoreholeOrm.app_project_id == project.id)
            )
        )
        .scalars()
        .all()
    )
    assert none_stored == []

    body["boreholes"] = [
        {"key": "B-T2@p1", "crs": {"epsg": 31370, "scope": "this"}, "water_unit_confirmed": True}
    ]
    accepted = await async_client.post("/borehole/pdf/import", json=body)
    assert accepted.status_code == 201, accepted.text
    stored = (
        await db_session.execute(
            select(BoreholeOrm).where(BoreholeOrm.app_project_id == project.id)
        )
    ).scalar_one()
    assert stored.epsg == 31370
    assert stored.water_table_depth_m == pytest.approx(3.80)
    assert stored.import_provenance["confirmations"] == {
        "crs": {"epsg": 31370, "scope": "this"},
        "water_unit_confirmed": True,
    }


async def test_reimporting_asks_first_then_replaces_in_place_with_consent(
    async_client: AsyncClient, db_session: AsyncSession, pdf_store: PdfReportStore
) -> None:
    """Second import: 409 + diff, nothing written; with consent: 200, the same borehole."""
    project = await make_project(db_session)
    listing = await _triage(async_client, str(project.id), _boorstaat())
    body: dict[str, Any] = {
        "project_id": str(project.id),
        "file_sha": listing["file_sha"],
        "boreholes": [{"key": "B-T1@p1"}],
    }
    first = await async_client.post("/borehole/pdf/import", json=body)
    assert first.status_code == 201, first.text
    first_id = first.json()["boreholes"][0]["borehole_id"]

    asked = await async_client.post("/borehole/pdf/import", json=body)
    assert asked.status_code == 409, asked.text
    detail = asked.json()["detail"]
    assert detail["code"] == "borehole_refresh_confirmation_required"
    assert detail["diffs"][0]["borehole_id"] == first_id

    replaced = await async_client.post(
        "/borehole/pdf/import", json={**body, "confirm_refresh": True}
    )
    assert replaced.status_code == 200, replaced.text
    [boring] = replaced.json()["boreholes"]
    assert (boring["borehole_id"], boring["refreshed"]) == (first_id, True)
    rows = (
        (
            await db_session.execute(
                select(BoreholeOrm).where(BoreholeOrm.app_project_id == project.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    tracks = (
        (
            await db_session.execute(
                select(ObservationOrm).where(ObservationOrm.borehole_id == UUID(first_id))
            )
        )
        .scalars()
        .all()
    )
    assert len(tracks) == 1
