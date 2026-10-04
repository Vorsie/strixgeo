"""HTTP contract for ``POST /borehole/import`` — local DOV borehole XML files.

Owner 2026-09-28: import the DOV ``dov-schema`` borehole files he has on disk,
"flag everything that is weird". The five fixture files are his own project
data. Every file lands in one commit, every boring as its own borehole named
by its DOV alternative name, with every interpretation the file holds.

Re-importing follows the CPT rule (CLAUDE.md "API Endpoints"): the overwrite
is irreversible, so a second upload answers 409 with the diff and writes
nothing; with ``confirm_refresh=true`` it refreshes in place (200, same
borehole id).

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from tests.integration.conftest import make_project

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "dov_boring_files"


async def _post(client: AsyncClient, project_id: str, filename: str, *, confirm: bool = False):
    """POST one fixture file to ``/borehole/import``."""
    data = {"project_id": project_id}
    if confirm:
        data["confirm_refresh"] = "true"
    return await client.post(
        "/borehole/import",
        files={"file": (filename, (FIXTURES / filename).read_bytes(), "text/xml")},
        data=data,
    )


def _codes(boring: dict) -> set[str]:
    """Flag codes of one boring in the response."""
    return {issue["code"] for issue in boring["issues"]}


async def test_the_five_owner_files_import_eight_boreholes_with_their_flags(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Five files → 8 boreholes (the 121 file holds four), each with its flags."""
    project = await make_project(db_session)
    by_name: dict[str, dict] = {}
    for filename in sorted(p.name for p in FIXTURES.glob("*.xml")):
        response = await _post(async_client, str(project.id), filename)
        assert response.status_code == 201, (filename, response.text)
        for boring in response.json()["boreholes"]:
            assert boring["imported"] is True
            assert boring["refreshed"] is False
            by_name[boring["name"]] = boring

    assert sorted(by_name) == [
        "15Abcert019-B2",
        "BGD024E0220",
        "GEO-25/110-B1",
        "GEO-25/110-B2",
        "GEO-25/121-B3",
        "GEO-25/121-B4",
        "GEO-25/121-B5",
        "GEO-25/121-B6",
    ]
    assert "ELEVATION_ZERO" in _codes(by_name["15Abcert019-B2"])
    assert "DEPTH_MISMATCH" in _codes(by_name["BGD024E0220"])
    assert "FILE_HOLDS_MANY_BORINGS" in _codes(by_name["GEO-25/121-B4"])
    assert "NO_LITHOLOGICAL_DESCRIPTION" in _codes(by_name["GEO-25/121-B4"])

    count = await db_session.scalar(
        select(func.count())
        .select_from(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == project.id)
    )
    assert count == 8
    # B1: both interpretations persisted on the borehole, keyed by permkey.
    b1_id = UUID(by_name["GEO-25/110-B1"]["borehole_id"])
    b1 = await db_session.get(BoreholeOrm, b1_id)
    assert b1 is not None and b1.test_id == "1411-BORGEO2600011-21-04-2026-B1"
    assert b1.project_id == "DOV"
    permkeys = set(
        (
            await db_session.scalars(
                select(ObservationOrm.dov_permkey).where(ObservationOrm.borehole_id == b1_id)
            )
        ).all()
    )
    assert permkeys == {"2026-410960", "2026-410970"}
    # Smet: both lithological descriptions kept.
    smet_obs = await db_session.scalar(
        select(func.count())
        .select_from(ObservationOrm)
        .where(ObservationOrm.borehole_id == UUID(by_name["BGD024E0220"]["borehole_id"]))
    )
    assert smet_obs == 3


async def test_reimporting_asks_first_then_refreshes_in_place(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Second upload → 409 + diff, nothing written; with consent → 200, same id."""
    project = await make_project(db_session)
    first = await _post(async_client, str(project.id), "GEO-25-110-B1onbewerkt.xml")
    assert first.status_code == 201, first.text
    created = first.json()["boreholes"][0]

    second = await _post(async_client, str(project.id), "GEO-25-110-B1onbewerkt.xml")
    assert second.status_code == 409, second.text
    detail = second.json()["detail"]
    assert detail["code"] == "borehole_refresh_confirmation_required"
    [diff] = detail["diffs"]
    assert diff["borehole_id"] == created["borehole_id"]
    assert diff["name"] == "GEO-25/110-B1"
    assert diff["old_total_depth_m"] == 35.0
    assert diff["new_total_depth_m"] == 35.0
    assert diff["old_n_litho_layers"] == 70
    assert diff["new_n_litho_layers"] == 70

    third = await _post(async_client, str(project.id), "GEO-25-110-B1onbewerkt.xml", confirm=True)
    assert third.status_code == 200, third.text
    [refreshed] = third.json()["boreholes"]
    assert refreshed["refreshed"] is True
    assert refreshed["borehole_id"] == created["borehole_id"]

    count = await db_session.scalar(
        select(func.count())
        .select_from(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == project.id)
    )
    assert count == 1
    n_obs = await db_session.scalar(
        select(func.count())
        .select_from(ObservationOrm)
        .where(ObservationOrm.borehole_id == UUID(created["borehole_id"]))
    )
    assert n_obs == 2  # replaced in place, not doubled


async def test_a_broken_reimport_is_refused_even_when_confirmed(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """A re-import whose boring lost its position → 422, stored borehole untouched."""
    project = await make_project(db_session)
    first = await _post(async_client, str(project.id), "GEO-25-110-B1onbewerkt.xml")
    assert first.status_code == 201, first.text
    broken = (
        (FIXTURES / "GEO-25-110-B1onbewerkt.xml")
        .read_bytes()
        .replace(b"<gml:pos>136014.22 205977.40 27.47</gml:pos>", b"<gml:pos></gml:pos>")
    )
    response = await async_client.post(
        "/borehole/import",
        files={"file": ("broken.xml", broken, "text/xml")},
        data={"project_id": str(project.id), "confirm_refresh": "true"},
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "borehole_refresh_refused"


SAMPLE_FILE = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "dov_boring_files_synthetic"
    / "boring_met_monsters.xml"
)


async def test_flags_carry_params_and_file_samples_land_with_their_curve(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Every issue on the wire has ``params``; the synthetic file's samples + curve persist.

    Owner 2026-10-03: the flags must read in Dutch -> the desktop needs the
    variable parts as params. Samples (<monster>) in a file are imported with
    their boring (synthetic file: none of the owner's files holds a sample).
    """
    project = await make_project(db_session)
    response = await async_client.post(
        "/borehole/import",
        files={"file": (SAMPLE_FILE.name, SAMPLE_FILE.read_bytes(), "text/xml")},
        data={"project_id": str(project.id)},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    [boring] = body["boreholes"]
    flags = {issue["code"]: issue for issue in boring["issues"]}
    assert flags["SAMPLES_PRESENT"]["params"] == {"count": 2, "grain_size": 1}
    assert flags["SAMPLE_WITHOUT_DEPTH"]["params"] == {"sample": "3"}
    assert all("params" in issue for issue in boring["issues"] + body["file_issues"])
    assert {i["code"] for i in body["file_issues"]} == {"SAMPLE_WITHOUT_BORING"}

    samples = (
        (
            await db_session.execute(
                select(SampleOrm)
                .where(SampleOrm.borehole_id == UUID(boring["borehole_id"]))
                .options(selectinload(SampleOrm.grain_sizes))
                .order_by(SampleOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.sample_number, s.depth_top_m, s.depth_base_m) for s in samples] == [
        ("1", 2.0, 2.5),
        ("2", 4.0, 4.0),
    ]
    assert samples[0].dov_permkey == "2025-M1"
    assert [g.dov_permkey for g in samples[0].grain_sizes] == ["2025-O1"]
