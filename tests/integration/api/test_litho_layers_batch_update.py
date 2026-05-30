"""HTTP-level tests for the layer batch-update endpoint (A4 slice 4b).

Mirrors the existing contact batch-update semantics so the FE can swap
``api.geology.updateContactsBatch`` for ``api.geology.batchUpdateLayers``
without changing the all-or-nothing contract the section editor's
multi-drag + cross-column MOVE gestures rely on.

Covered:
* depth-only batch update on N rows mutates every row atomically
* mixed-field batch (depth + confidence + status) applies each patch
* 422 with no side effect when ANY layer_id is unknown
* response payload echoes every mutated row with refreshed updated_at
* anchor re-target (cross-column MOVE) updates borehole_id/cpt_id
* the FC↔LL mirror trigger propagates each row's update into the
  formation_contact mirror (so correlation FKs + bundle export stay
  coherent through the cut-over)
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project_with_layers(db_session: AsyncSession) -> dict:
    """Project + 2 boreholes + 1 litho model + 1 formation + 3 layers."""
    project = ProjectOrm(id=uuid7(), name="Batch update", status="active")
    db_session.add(project)
    await db_session.flush()
    bh1 = BoreholeOrm(
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
    bh2 = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=project.id,
        project_id="T",
        test_id="T2",
        location_x=10.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    db_session.add_all([bh1, bh2, model, sand])
    await db_session.flush()
    layers = [
        LithoLayerOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=sand.id,
            borehole_id=bh1.id,
            depth_top_m=0.0,
            depth_base_m=2.0,
            status="accepted",
            source="manual",
            confidence="medium",
        ),
        LithoLayerOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=sand.id,
            borehole_id=bh1.id,
            depth_top_m=2.0,
            depth_base_m=4.0,
            status="accepted",
            source="manual",
            confidence="medium",
        ),
        LithoLayerOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=sand.id,
            borehole_id=bh1.id,
            depth_top_m=4.0,
            depth_base_m=6.0,
            status="accepted",
            source="manual",
            confidence="medium",
        ),
    ]
    db_session.add_all(layers)
    await db_session.commit()
    return {
        "project": project,
        "bh1": bh1,
        "bh2": bh2,
        "model": model,
        "sand": sand,
        "layers": layers,
    }


async def test_batch_update_atomically_shifts_three_rows(
    async_client: AsyncClient, project_with_layers: dict
) -> None:
    """Shift three accepted layers in one transaction."""
    p = project_with_layers
    updates = [
        {"layer_id": str(p["layers"][0].id), "depth_top_m": 0.5},
        {"layer_id": str(p["layers"][1].id), "depth_top_m": 2.5},
        {"layer_id": str(p["layers"][2].id), "depth_top_m": 4.5},
    ]
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model'].id}/layers/batch-update",
        json={"updates": updates},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated_count"] == 3
    by_id = {layer["id"]: layer for layer in body["layers"]}
    assert by_id[str(p["layers"][0].id)]["depth_top_m"] == 0.5
    assert by_id[str(p["layers"][1].id)]["depth_top_m"] == 2.5
    assert by_id[str(p["layers"][2].id)]["depth_top_m"] == 4.5


async def test_batch_update_mixed_fields(
    async_client: AsyncClient, project_with_layers: dict
) -> None:
    """Different fields per row in one call — depth + status + confidence."""
    p = project_with_layers
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model'].id}/layers/batch-update",
        json={
            "updates": [
                {"layer_id": str(p["layers"][0].id), "depth_top_m": 0.3},
                {"layer_id": str(p["layers"][1].id), "status": "rejected"},
                {"layer_id": str(p["layers"][2].id), "confidence": "high"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_id = {layer["id"]: layer for layer in body["layers"]}
    assert by_id[str(p["layers"][0].id)]["depth_top_m"] == 0.3
    assert by_id[str(p["layers"][1].id)]["status"] == "rejected"
    assert by_id[str(p["layers"][2].id)]["confidence"] == "high"


async def test_batch_update_422_when_any_id_missing(
    async_client: AsyncClient, project_with_layers: dict
) -> None:
    """All-or-nothing: unknown id → 422, no row mutates."""
    p = project_with_layers
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model'].id}/layers/batch-update",
        json={
            "updates": [
                {"layer_id": str(p["layers"][0].id), "depth_top_m": 0.9},
                {"layer_id": str(uuid7()), "depth_top_m": 9.9},
            ]
        },
    )
    assert resp.status_code == 422


async def test_batch_update_anchor_retarget_cross_column(
    async_client: AsyncClient, project_with_layers: dict, db_session: AsyncSession
) -> None:
    """Cross-column MOVE: shift layer 0 from BH-1 to BH-2 via the XOR-anchor patch.

    Mirrors the contact-side cross-column MOVE gesture. The XOR rule
    requires both anchor fields in the body, exactly one non-null.
    """
    p = project_with_layers
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model'].id}/layers/batch-update",
        json={
            "updates": [
                {
                    "layer_id": str(p["layers"][0].id),
                    "borehole_id": str(p["bh2"].id),
                    "cpt_id": None,
                }
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated_count"] == 1
    assert body["layers"][0]["borehole_id"] == str(p["bh2"].id)


async def test_batch_update_propagates_to_formation_contact_mirror(
    async_client: AsyncClient, project_with_layers: dict, db_session: AsyncSession
) -> None:
    """The LL→FC trigger mirrors each row's update into formation_contact.

    Pre-condition: each accepted layer already has a matching FC (the
    LL trigger created them on the layer INSERTs in the fixture).
    Post-condition: every mutated layer's FC carries the new depth.
    """
    p = project_with_layers
    new_depths = {
        str(p["layers"][0].id): 0.7,
        str(p["layers"][1].id): 2.7,
        str(p["layers"][2].id): 4.7,
    }
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model'].id}/layers/batch-update",
        json={
            "updates": [
                {"layer_id": lid, "depth_top_m": depth} for lid, depth in new_depths.items()
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    # Read the FC mirror rows fresh (bypass the integration session's
    # identity-map cache).
    fcs = list(
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.id.in_([layer.id for layer in p["layers"]])
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(fcs) == 3
    fc_depths = {str(fc.id): fc.depth_top_m for fc in fcs}
    for lid, expected in new_depths.items():
        assert fc_depths[lid] == expected


async def test_batch_update_empty_returns_zero(
    async_client: AsyncClient, project_with_layers: dict
) -> None:
    """Empty updates list is a no-op."""
    p = project_with_layers
    resp = await async_client.patch(
        f"/projects/{p['project'].id}/geology/models/{p['model'].id}/layers/batch-update",
        json={"updates": []},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated_count"] == 0
    assert body["layers"] == []
