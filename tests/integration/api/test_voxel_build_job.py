"""Integration tests for the background voxel-build job endpoints (debt #282).

These exercise the REAL build through the job/SSE plumbing against a real
database — the unit tests (`tests/unit/api/test_voxel_build_job_endpoints.py`)
fake the build; here it actually labels a grid and persists solids.

Coverage
--------
VBJ-1  A full round-trip: ``POST .../build-voxel/jobs`` answers 202 with a
       job-id, the SSE stream carries ``progress`` ticks (phase ``"label"``)
       then a terminal ``done`` carrying the built solids, and the rows are
       persisted in the DB.
VBJ-2  Cancel mid-build: once the first ``label`` progress tick proves the
       build is inside the column loop, ``POST .../jobs/{id}/cancel`` sets the
       cooperative flag; the stream then ends with
       ``{"type":"error","code":"build_cancelled"}`` and NO solid rows were
       written (the model is left exactly as it was).

⚠ NOT RUN in the authoring session (no database was available). VBJ-2 keys its
cancel on observing the first progress event, so it is deterministic as long as
the labelling of the (deliberately fine) grid outlasts one cancel round-trip;
if it proves flaky on a very fast machine, drop ``grid_spacing_m`` further.
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> dict:
    """Project + geological + lithostratigraphic model + one ZAND formation."""
    proj = ProjectOrm(id=uuid7(), name="BVJob test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    db_session.add(zand)
    await db_session.commit()
    return {"project": proj, "litho": litho, "zand": zand}


def _payload(scene: dict, *, grid_spacing_m: float = 2.0) -> dict:
    """A buildable 3-column, single-band ZAND payload (two sections)."""
    zand = str(scene["zand"].id)
    body = str(uuid4())

    def band(cols: list[dict], gap: int = 0) -> dict:
        return {
            "columns": cols,
            "regions": [
                {
                    "formation_id": zand,
                    "body_id": body,
                    "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, -10.0], [0.0, -10.0]],
                    "gap_index": gap,
                }
            ],
        }

    col_a = {"investigation_id": str(uuid4()), "along_m": 0.0, "world_x": 0.0, "world_y": 0.0}
    col_b = {"investigation_id": str(uuid4()), "along_m": 20.0, "world_x": 20.0, "world_y": 0.0}
    col_c = {"investigation_id": str(uuid4()), "along_m": 22.4, "world_x": 10.0, "world_y": 20.0}

    section0 = {"start_x": 0.0, "start_y": 0.0, "end_x": 20.0, "end_y": 0.0, **band([col_a, col_b])}
    section1 = {
        "start_x": 20.0,
        "start_y": 0.0,
        "end_x": 10.0,
        "end_y": 20.0,
        **band([col_b, col_c]),
    }
    return {"sections": [section0, section1], "grid_spacing_m": grid_spacing_m}


def _jobs_url(project_id: UUID, model_id: UUID) -> str:
    """The build-voxel jobs collection URL."""
    return f"/projects/{project_id}/geology/models/{model_id}/litho-solids/build-voxel/jobs"


def _sse(line: str) -> dict | None:
    """Parse one ``data: <json>`` SSE line (or None for a non-data line)."""
    if not line.startswith("data: "):
        return None
    return json.loads(line[len("data: ") :])


async def _solid_count(db_session: AsyncSession, model_id: UUID) -> int:
    """Number of persisted litho solid rows for a model."""
    return (
        await db_session.execute(
            select(func.count())
            .select_from(LithoBodySolidOrm)
            .where(LithoBodySolidOrm.model_id == model_id)
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_vbj1_round_trip_streams_progress_then_done_and_persists(
    async_client: AsyncClient,
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """Spawn → stream (progress + done) → solids persisted in the DB."""
    proj, litho = scene["project"], scene["litho"]
    spawn = await async_client.post(_jobs_url(proj.id, litho.id), json=_payload(scene))
    assert spawn.status_code == 202, spawn.text
    job_id = spawn.json()["job_id"]

    events: list[dict] = []
    async with async_client.stream("GET", f"{_jobs_url(proj.id, litho.id)}/{job_id}") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            ev = _sse(line)
            if ev is not None:
                events.append(ev)

    phases = [e for e in events if e.get("type") == "progress"]
    assert any(e["phase"] == "label" for e in phases), "no label-phase progress arrived"
    assert events[-1]["type"] == "done", events[-1]
    assert events[-1]["bodies_built"] >= 1
    assert len(events[-1]["solids"]) == events[-1]["bodies_built"]

    # The build actually persisted its solids.
    assert await _solid_count(db_session, litho.id) == events[-1]["bodies_built"]


@pytest.mark.asyncio
async def test_vbj2_cancel_mid_build_ends_cancelled_and_writes_nothing(
    async_client: AsyncClient,
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """Cancelling after the first progress tick ends the build cancelled, unwritten."""
    proj, litho = scene["project"], scene["litho"]
    # A fine grid so labelling has many columns left after the first tick.
    spawn = await async_client.post(
        _jobs_url(proj.id, litho.id), json=_payload(scene, grid_spacing_m=0.5)
    )
    assert spawn.status_code == 202, spawn.text
    job_id = spawn.json()["job_id"]

    cancel_sent = False
    events: list[dict] = []
    async with async_client.stream("GET", f"{_jobs_url(proj.id, litho.id)}/{job_id}") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            ev = _sse(line)
            if ev is None:
                continue
            events.append(ev)
            # The moment the build reports it is labelling, ask it to stop.
            if not cancel_sent and ev.get("type") == "progress":
                cancel = await async_client.post(f"{_jobs_url(proj.id, litho.id)}/{job_id}/cancel")
                assert cancel.status_code == 202
                assert cancel.json()["cancelling"] is True
                cancel_sent = True

    assert events[-1]["type"] == "error", events[-1]
    assert events[-1]["code"] == "build_cancelled"
    # Nothing was written for a cancelled build — the model is untouched.
    assert await _solid_count(db_session, litho.id) == 0
