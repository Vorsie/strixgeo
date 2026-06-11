"""IDOR regression tests for the litho-layer batch / boundary endpoints.

Audit finding #2: the batch-status, batch-update, and boundary-move use
cases loaded layers purely by id, so a known layer UUID from model B could
be mutated via a call whose URL scopes it to model A. The fix threads the
URL's ``model_id`` into ``list_layers_by_ids`` so a foreign layer is simply
not found, and the existing all-or-nothing guard rejects the call.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
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
async def project_two_models(db_session: AsyncSession) -> dict:
    """One project, two litho models (A and B), each with two stacked layers."""
    project = ProjectOrm(id=uuid7(), name="IDOR", status="active")
    db_session.add(project)
    await db_session.flush()
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="T",
        test_id="T1",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="G", kind="geological")
    model_a = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="A",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    model_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="B",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    db_session.add_all([bh, geo, model_a, model_b, sand])
    await db_session.flush()

    def _layer(model_id, top, base):
        return LithoLayerOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=sand.id,
            borehole_id=bh.id,
            depth_top_m=top,
            depth_base_m=base,
            status="accepted",
            source="manual",
            confidence="medium",
        )

    a_layers = [_layer(model_a.id, 0.0, 2.0), _layer(model_a.id, 2.0, 4.0)]
    b_layers = [_layer(model_b.id, 0.0, 2.0), _layer(model_b.id, 2.0, 4.0)]
    db_session.add_all([*a_layers, *b_layers])
    await db_session.commit()
    return {
        "project": project,
        "model_a": model_a,
        "model_b": model_b,
        "a_layers": a_layers,
        "b_layers": b_layers,
    }


async def test_batch_status_rejects_foreign_model_layer(
    async_client: AsyncClient, project_two_models: dict, db_session: AsyncSession
) -> None:
    """A model-B layer id in a model-A batch-status call is rejected, not mutated."""
    p = project_two_models
    foreign = p["b_layers"][0]
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['model_a'].id}/layers/batch-status",
        json={"layer_ids": [str(foreign.id)], "status": "rejected"},
    )
    assert resp.status_code == 422, resp.text
    # The foreign layer is untouched.
    fresh = (
        await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.id == foreign.id))
    ).scalar_one()
    await db_session.refresh(fresh)
    assert fresh.status == "accepted"


async def test_batch_update_rejects_foreign_model_layer(
    async_client: AsyncClient, project_two_models: dict, db_session: AsyncSession
) -> None:
    """A model-B layer id in a model-A batch-update call is rejected, not mutated."""
    p = project_two_models
    foreign = p["b_layers"][0]
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model_a'].id}/layers/batch-update",
        json={"updates": [{"layer_id": str(foreign.id), "depth_top_m": 9.9}]},
    )
    assert resp.status_code == 422, resp.text
    fresh = (
        await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.id == foreign.id))
    ).scalar_one()
    await db_session.refresh(fresh)
    assert fresh.depth_top_m == 0.0


async def test_boundary_move_rejects_foreign_model_layers(
    async_client: AsyncClient, project_two_models: dict
) -> None:
    """Model-B adjacent layers in a model-A boundary-move call are rejected."""
    p = project_two_models
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model_a'].id}/layers/boundary-move",
        json={
            "upper_layer_id": str(p["b_layers"][0].id),
            "lower_layer_id": str(p["b_layers"][1].id),
            "new_depth_m": 1.5,
        },
    )
    assert resp.status_code == 422, resp.text
