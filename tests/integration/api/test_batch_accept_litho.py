"""Integration tests for the batch-accept-litho-suggestions endpoint (#153).

Exercises the real router orchestration against PostgreSQL:

BT1  Two anchors accepted in one call → both anchors' contacts persisted, the
     section is seeded ONCE with every created contact id, totals + per-anchor
     results are correct, and inference ran.
BT2  Idempotent re-accept of the same batch → contacts are found, not created
     (no duplicate rows).
BT3  A bad anchor (unknown investigation id) is reported in its ``error`` field
     while the other anchor still commits — the batch is not aborted.
BT4  ``run_inference=False`` skips the recompute (inference_ran False) but still
     commits the contacts.
BT5  A non-lithostratigraphic model returns 422.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    proj = ProjectOrm(id=uuid7(), name="batch accept test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def stack(
    db_session: AsyncSession,
    project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Geo model + formation + litho model + 2 boreholes + a section."""
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201
    geo_model = geo_resp.json()

    geo_f_resp = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={"name": "Boom Klei", "color": "#888", "display_order": 0},
    )
    assert geo_f_resp.status_code == 201

    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model["id"],
        },
    )
    assert litho_resp.status_code == 201
    litho_model = litho_resp.json()

    boreholes = []
    for i, x in enumerate((50.0, 150.0)):
        bh = BoreholeOrm(
            id=uuid7(),
            name=f"BH-{i}",
            app_project_id=project.id,
            project_id="TEST",
            test_id=f"BT-{i}",
            location_x=x,
            location_y=100.0,
            epsg=31370,
            total_depth_m=20.0,
            elevation_m=10.0,
        )
        db_session.add(bh)
        boreholes.append(bh)
    await db_session.commit()

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
    assert sec_resp.status_code == 201, sec_resp.text

    return {
        "litho_model_id": litho_model["id"],
        "section_id": sec_resp.json()["id"],
        "boreholes": boreholes,
    }


def _anchor(borehole_id: str, lithology: str, top: float, base: float) -> dict:
    return {
        "borehole_id": borehole_id,
        "suggestions": [
            {
                "depth_top_m": top,
                "depth_base_m": base,
                "suggested_lithology": lithology,
                "confidence": "high",
                "source": "borehole_observation",
                "suggested_admixtures": [],
            }
        ],
    }


async def _contact_count(db_session: AsyncSession, model_id: str) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(FormationContactOrm)
            .where(FormationContactOrm.model_id == model_id)
        )
    ).scalar_one()


async def test_bt1_two_anchors_one_transaction_one_seed(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """BT1: both anchors persist; section seeded once with all created ids."""
    mid = stack["litho_model_id"]
    sid = stack["section_id"]
    bh0, bh1 = (str(b.id) for b in stack["boreholes"])

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/contacts/batch-accept-litho-suggestions",
        json={
            "anchors": [
                _anchor(bh0, "ZAND", 0.0, 3.0),
                _anchor(bh1, "KLEI", 0.0, 4.0),
            ],
            "section_id": sid,
            "run_inference": True,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["anchors"]) == 2
    assert body["failed_anchor_count"] == 0
    assert body["total_created_contacts"] == 2
    assert body["total_created_formations"] == 2
    assert body["inference_ran"] is True

    # Both anchors' contacts are in the DB.
    assert await _contact_count(db_session, mid) == 2

    # The section was seeded ONCE with both created contact ids.
    created = [cid for a in body["anchors"] for cid in a["created_contact_ids"]]
    assert len(created) == 2
    seeded = body["updated_section"]["seeded_formation_contact_ids"]
    assert set(created).issubset(set(seeded))


async def test_bt2_reaccept_is_idempotent(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """BT2: re-accepting the same batch finds existing contacts, creates none."""
    mid = stack["litho_model_id"]
    sid = stack["section_id"]
    bh0, bh1 = (str(b.id) for b in stack["boreholes"])
    payload = {
        "anchors": [_anchor(bh0, "ZAND", 0.0, 3.0), _anchor(bh1, "KLEI", 0.0, 4.0)],
        "section_id": sid,
        "run_inference": False,
    }

    first = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/contacts/batch-accept-litho-suggestions",
        json=payload,
    )
    assert first.status_code == 200, first.text
    assert first.json()["total_created_contacts"] == 2

    second = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/contacts/batch-accept-litho-suggestions",
        json=payload,
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["total_created_contacts"] == 0
    assert body["total_found_contacts"] == 2
    # No duplicate rows.
    assert await _contact_count(db_session, mid) == 2


async def test_bt3_bad_anchor_recorded_others_commit(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """BT3: an unknown investigation id fails that anchor only; the rest commit."""
    mid = stack["litho_model_id"]
    sid = stack["section_id"]
    bh0 = str(stack["boreholes"][0].id)
    bogus = str(uuid7())

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/contacts/batch-accept-litho-suggestions",
        json={
            "anchors": [
                _anchor(bh0, "ZAND", 0.0, 3.0),
                _anchor(bogus, "KLEI", 0.0, 4.0),
            ],
            "section_id": sid,
            "run_inference": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["failed_anchor_count"] == 1
    assert body["total_created_contacts"] == 1

    by_bh = {a["borehole_id"]: a for a in body["anchors"]}
    assert by_bh[bh0]["error"] is None
    assert by_bh[bogus]["error"] is not None
    # The good anchor still committed.
    assert await _contact_count(db_session, mid) == 1


async def test_bt4_run_inference_false_skips_recompute(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """BT4: run_inference=False commits contacts but does not run inference."""
    mid = stack["litho_model_id"]
    bh0 = str(stack["boreholes"][0].id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/contacts/batch-accept-litho-suggestions",
        json={"anchors": [_anchor(bh0, "ZAND", 0.0, 3.0)], "run_inference": False},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["inference_ran"] is False
    assert body["total_created_contacts"] == 1
    assert await _contact_count(db_session, mid) == 1


async def test_bt5_non_litho_model_returns_422(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
) -> None:
    """BT5: batch accept on a geological model is rejected with 422."""
    # Create a second geological model to target.
    geo = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo2", "kind": "geological"},
    )
    assert geo.status_code == 201
    geo_mid = geo.json()["id"]
    bh0 = str(stack["boreholes"][0].id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{geo_mid}/contacts/batch-accept-litho-suggestions",
        json={"anchors": [_anchor(bh0, "ZAND", 0.0, 3.0)]},
    )
    assert resp.status_code == 422, resp.text
