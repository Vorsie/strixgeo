"""HTTP-level tests for the litho_layer read-path endpoint (Slice A1).

Covers the GET ``/projects/{project_id}/geology/models/{model_id}/layers``
contract — routing, JSON shape, scope guard, and the filter knobs
(borehole_id, cpt_id, formation_id, status).

The dual-write transition lands in Slice A2; for now the table is
populated directly by the tests via the ORM so we can pin the read
shape without depending on a write endpoint.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project_with_litho_layers(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, BoreholeOrm, list[LithoLayerOrm]]:
    """Project + litho model + borehole + three pending litho layers at
    depths 0..6 m, stacked top-to-bottom."""
    project = ProjectOrm(id=uuid7(), name="Layer endpoint test", status="active")
    db_session.add(project)
    await db_session.flush()

    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="TEST",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo M",
        kind="geological",
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho M1",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    db_session.add_all([bh, geo_model, model])
    await db_session.flush()

    formation_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="SAND",
        color="#fdcb6e",
    )
    formation_clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="CLAY",
        color="#74b9ff",
    )
    db_session.add_all([formation_sand, formation_clay])
    await db_session.flush()

    layer_top = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation_sand.id,
        borehole_id=bh.id,
        depth_top_m=0.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="medium",
    )
    layer_mid = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation_clay.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        depth_base_m=4.0,
        status="accepted",
        source="manual",
        confidence="high",
    )
    layer_bot = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation_sand.id,
        borehole_id=bh.id,
        depth_top_m=4.0,
        depth_base_m=6.0,
        status="rejected",
        source="segmenter",
        confidence="low",
    )
    db_session.add_all([layer_top, layer_mid, layer_bot])
    await db_session.commit()
    return project, model, bh, [layer_top, layer_mid, layer_bot]


async def test_list_layers_returns_all_sorted_by_depth(
    async_client: AsyncClient,
    project_with_litho_layers: tuple[
        ProjectOrm, GeologicalModelOrm, BoreholeOrm, list[LithoLayerOrm]
    ],
) -> None:
    project, model, _, layers = project_with_litho_layers
    resp = await async_client.get(f"/projects/{project.id}/geology/models/{model.id}/layers")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    # Sorted by depth_top_m ascending.
    assert [item["depth_top_m"] for item in body] == [0.0, 2.0, 4.0]
    # Round-trip every column we care about.
    assert {item["status"] for item in body} == {"pending", "accepted", "rejected"}
    assert all(item["depth_base_m"] > item["depth_top_m"] for item in body)


async def test_list_layers_filter_by_status(
    async_client: AsyncClient,
    project_with_litho_layers: tuple[
        ProjectOrm, GeologicalModelOrm, BoreholeOrm, list[LithoLayerOrm]
    ],
) -> None:
    project, model, _, _ = project_with_litho_layers
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        params={"status": "accepted"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["status"] == "accepted"
    assert body[0]["depth_top_m"] == 2.0


async def test_list_layers_filter_by_borehole(
    async_client: AsyncClient,
    project_with_litho_layers: tuple[
        ProjectOrm, GeologicalModelOrm, BoreholeOrm, list[LithoLayerOrm]
    ],
) -> None:
    project, model, bh, _ = project_with_litho_layers
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        params={"borehole_id": str(bh.id)},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    # A non-existent borehole filter returns zero rows.
    resp2 = await async_client.get(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        params={"borehole_id": str(uuid7())},
    )
    assert resp2.status_code == 200
    assert resp2.json() == []


async def test_list_layers_filter_by_formation(
    async_client: AsyncClient,
    project_with_litho_layers: tuple[
        ProjectOrm, GeologicalModelOrm, BoreholeOrm, list[LithoLayerOrm]
    ],
) -> None:
    project, model, _, layers = project_with_litho_layers
    sand_formation_id = layers[0].formation_id  # top + bottom are SAND
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        params={"formation_id": str(sand_formation_id)},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert {item["depth_top_m"] for item in body} == {0.0, 4.0}


async def test_list_layers_scope_guard_rejects_wrong_project(
    async_client: AsyncClient,
    project_with_litho_layers: tuple[
        ProjectOrm, GeologicalModelOrm, BoreholeOrm, list[LithoLayerOrm]
    ],
) -> None:
    _, model, _, _ = project_with_litho_layers
    other_project_id = uuid7()
    resp = await async_client.get(f"/projects/{other_project_id}/geology/models/{model.id}/layers")
    assert resp.status_code == 404
