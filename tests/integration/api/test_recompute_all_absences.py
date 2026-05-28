"""Integration tests for RecomputeAllAbsencesForModel (#153 optimisation).

Covers the recompute path that the batch accept runs once at the end, against
PostgreSQL — including the batched ``INSERT … ON CONFLICT`` UPSERT and the
per-section corridor/observation cache (the #153 levers):

RA1  A formation present at one borehole and absent at another (where the
     absent borehole has an overlapping observation layer of a different
     lithology) produces one inferred ``formation_absence`` row.
RA2  Re-running is idempotent — the batched UPSERT writes no duplicate row.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_all_absences_for_model import (
    RecomputeAllAbsencesForModel,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    proj = ProjectOrm(id=uuid7(), name="recompute test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def scenario(
    db_session: AsyncSession,
    project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Litho model with a ZAND unit at bh0; bh1 has a KLEI observation layer.

    Both boreholes sit in one section's corridor.  bh1 carries no contact for
    the ZAND unit but its observation layer (different lithology) overlapping
    the unit's depth band is the positive evidence that makes bh1 ABSENT.
    """
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    geo_model = geo_resp.json()
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model["id"],
        },
    )
    litho_model = litho_resp.json()

    boreholes = []
    for i, x in enumerate((50.0, 150.0)):
        bh = BoreholeOrm(
            id=uuid7(),
            name=f"BH-{i}",
            app_project_id=project.id,
            project_id="TEST",
            test_id=f"RA-{i}",
            location_x=x,
            location_y=100.0,
            epsg=31370,
            total_depth_m=20.0,
            elevation_m=10.0,
        )
        db_session.add(bh)
        boreholes.append(bh)
    await db_session.commit()

    # Section spanning both boreholes (corridor buffer 35 m).
    sec_resp = await async_client.post(
        f"/projects/{project.id}/sections",
        json={
            "name": "S1",
            "start_x": 0.0,
            "start_y": 100.0,
            "end_x": 200.0,
            "end_y": 100.0,
            "epsg": 31370,
            "projection_buffer_m": 35.0,
        },
    )
    section_id = sec_resp.json()["id"]

    # Accept a ZAND unit at bh0 only (defer inference — we run it explicitly).
    accept = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model['id']}/contacts/accept-litho-suggestions",
        json={
            "borehole_id": str(boreholes[0].id),
            "section_id": section_id,
            "defer_inference": True,
            "suggestions": [
                {
                    "depth_top_m": 2.0,
                    "depth_base_m": 5.0,
                    "suggested_lithology": "ZAND",
                    "confidence": "high",
                    "source": "borehole_observation",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert accept.status_code == 200, accept.text
    formation_id = accept.json()["created_formation_ids"][0]

    # bh1: a KLEI observation layer overlapping the ZAND unit's depth band —
    # positive evidence of a different lithology → bh1 is ABSENT for ZAND.
    obs = ObservationOrm(id=uuid7(), borehole_id=boreholes[1].id, observation_type="formal")
    db_session.add(obs)
    await db_session.flush()
    db_session.add(
        ObservationLayerOrm(
            id=uuid7(),
            observation_id=obs.id,
            top_m=1.0,
            base_m=4.0,
            main_soil_codes=["KLEI"],
            layer_index=0,
        )
    )
    await db_session.commit()

    return {
        "litho_model_id": litho_model["id"],
        "formation_id": formation_id,
        "bh_absent_id": boreholes[1].id,
    }


async def _absence_count(db_session: AsyncSession, formation_id: str) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(FormationAbsenceOrm)
            .where(FormationAbsenceOrm.formation_id == formation_id)
        )
    ).scalar_one()


async def test_ra1_infers_absence_for_different_lithology_borehole(
    project: ProjectOrm,
    scenario: dict,
    db_session: AsyncSession,
) -> None:
    """RA1: recompute writes one inferred absence for the absent borehole."""
    result = await RecomputeAllAbsencesForModel(db_session).execute(
        project_id=project.id, model_id=scenario["litho_model_id"]
    )
    assert result.formations_processed >= 1
    assert result.total_written == 1

    row = (
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(
                    FormationAbsenceOrm.formation_id == scenario["formation_id"]
                )
            )
        )
        .scalars()
        .one()
    )
    assert row.investigation_id == scenario["bh_absent_id"]
    assert row.source == "inferred"


async def test_ra2_recompute_is_idempotent(
    project: ProjectOrm,
    scenario: dict,
    db_session: AsyncSession,
) -> None:
    """RA2: a second recompute writes no duplicate (batched UPSERT no-op)."""
    mid = scenario["litho_model_id"]
    await RecomputeAllAbsencesForModel(db_session).execute(project_id=project.id, model_id=mid)
    assert await _absence_count(db_session, scenario["formation_id"]) == 1

    await RecomputeAllAbsencesForModel(db_session).execute(project_id=project.id, model_id=mid)
    assert await _absence_count(db_session, scenario["formation_id"]) == 1


async def test_ra3_incremental_filter_scopes_to_requested_formations(
    project: ProjectOrm,
    scenario: dict,
    db_session: AsyncSession,
) -> None:
    """RA3 (#155): only_formation_ids restricts recompute to the listed formations.

    Filtering OUT the formation skips it (no absence written); filtering it IN
    processes it (absence written). This is the incremental-recompute lever the
    batch accept uses to re-infer only the formations it touched.
    """
    from uuid import uuid4

    mid = scenario["litho_model_id"]
    fid = scenario["formation_id"]

    # Filtered to an unrelated id → the real formation is skipped.
    res_skip = await RecomputeAllAbsencesForModel(db_session).execute(
        project_id=project.id, model_id=mid, only_formation_ids=[uuid4()]
    )
    assert res_skip.formations_processed == 0
    assert await _absence_count(db_session, fid) == 0

    # Filtered to the real formation → it IS processed and its absence written.
    res_hit = await RecomputeAllAbsencesForModel(db_session).execute(
        project_id=project.id, model_id=mid, only_formation_ids=[fid]
    )
    assert res_hit.formations_processed == 1
    assert await _absence_count(db_session, fid) == 1
