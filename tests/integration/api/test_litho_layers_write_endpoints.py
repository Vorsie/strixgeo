"""HTTP-level tests for the litho_layer write endpoints (Slice A2).

Covers POST (bulk-create), PATCH /{lid} (single update),
PATCH /boundary-move (atomic two-row), and POST /batch-status.

Routing + JSON shape + scope guards + the boundary-move invariants
(same anchor, adjacent, depth-range guard) are all pinned here. The
forward-sync dual-write that mirrors FormationContact mutations into
litho_layer rows is exercised separately once it lands.
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
async def project_with_two_layers(
    db_session: AsyncSession,
) -> tuple[
    ProjectOrm, GeologicalModelOrm, BoreholeOrm, GeologicalFormationOrm, list[LithoLayerOrm]
]:
    """Project + litho model + borehole + formation + two adjacent layers."""
    project = ProjectOrm(id=uuid7(), name="Write endpoint test", status="active")
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
        name="Litho M",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="SAND",
        color="#fdcb6e",
    )
    db_session.add_all([bh, geo_model, model, formation])
    await db_session.flush()

    upper = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=0.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="medium",
    )
    lower = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        depth_base_m=4.0,
        status="pending",
        source="segmenter",
        confidence="medium",
    )
    db_session.add_all([upper, lower])
    await db_session.commit()
    return project, model, bh, formation, [upper, lower]


# ---------------------------------------------------------------------------
# PATCH /layers/{lid}
# ---------------------------------------------------------------------------


async def test_patch_layer_updates_status(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, layers = project_with_two_layers
    upper = layers[0]
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{upper.id}",
        json={"status": "accepted"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


async def test_patch_layer_404_on_unknown_id(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, _ = project_with_two_layers
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{uuid7()}",
        json={"status": "accepted"},
    )
    assert resp.status_code == 404


async def test_patch_layer_422_on_inverted_depths(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, layers = project_with_two_layers
    upper = layers[0]
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{upper.id}",
        json={"depth_top_m": 5.0, "depth_base_m": 1.0},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /layers/boundary-move
# ---------------------------------------------------------------------------


async def test_boundary_move_atomically_updates_both_rows(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, layers = project_with_two_layers
    upper, lower = layers
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/boundary-move",
        json={
            "upper_layer_id": str(upper.id),
            "lower_layer_id": str(lower.id),
            "new_depth_m": 2.5,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["upper"]["depth_base_m"] == 2.5
    assert body["lower"]["depth_top_m"] == 2.5
    # Outer edges untouched.
    assert body["upper"]["depth_top_m"] == 0.0
    assert body["lower"]["depth_base_m"] == 4.0


async def test_boundary_move_422_on_out_of_range_depth(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, layers = project_with_two_layers
    upper, lower = layers
    # 5.0 sits past lower's depth_base_m (= 4.0) — would invert the lower.
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/boundary-move",
        json={
            "upper_layer_id": str(upper.id),
            "lower_layer_id": str(lower.id),
            "new_depth_m": 5.0,
        },
    )
    assert resp.status_code == 422


async def test_boundary_move_422_on_non_adjacent(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
    db_session: AsyncSession,
) -> None:
    project, model, bh, formation, layers = project_with_two_layers
    upper, _ = layers
    # Build a third layer at [5, 7] — not adjacent to upper [0, 2].
    far = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=5.0,
        depth_base_m=7.0,
        status="pending",
        source="segmenter",
        confidence="medium",
    )
    db_session.add(far)
    await db_session.commit()
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/boundary-move",
        json={
            "upper_layer_id": str(upper.id),
            "lower_layer_id": str(far.id),
            "new_depth_m": 3.0,
        },
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /layers/batch-status
# ---------------------------------------------------------------------------


async def test_batch_status_accepts_all(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, layers = project_with_two_layers
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model.id}/layers/batch-status",
        json={
            "layer_ids": [str(layers[0].id), str(layers[1].id)],
            "status": "accepted",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated_count"] == 2
    assert {item["status"] for item in body["layers"]} == {"accepted"}


async def test_batch_status_422_on_unknown_id(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, _, layers = project_with_two_layers
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model.id}/layers/batch-status",
        json={
            "layer_ids": [str(layers[0].id), str(uuid7())],
            "status": "accepted",
        },
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /layers (bulk-create)
# ---------------------------------------------------------------------------


async def test_bulk_create_inserts_n_rows(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, bh, formation, _ = project_with_two_layers
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        json={
            "layers": [
                {
                    "formation_id": str(formation.id),
                    "borehole_id": str(bh.id),
                    "depth_top_m": 7.0,
                    "depth_base_m": 8.0,
                },
                {
                    "formation_id": str(formation.id),
                    "borehole_id": str(bh.id),
                    "depth_top_m": 8.0,
                    "depth_base_m": 9.0,
                    "status": "accepted",
                },
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["status"] == "pending"  # default
    assert body[1]["status"] == "accepted"


async def test_bulk_create_422_on_missing_anchor(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    project, model, _, formation, _ = project_with_two_layers
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        json={
            "layers": [
                {
                    "formation_id": str(formation.id),
                    "depth_top_m": 0.0,
                    "depth_base_m": 1.0,
                    # No anchor — XOR rejects.
                },
            ]
        },
    )
    assert resp.status_code == 422


async def test_bulk_create_with_section_id_seeds_section(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
    db_session: AsyncSession,
) -> None:
    """A4 remaining-writer cut — handleCreateLithoContact's section_id
    behaviour ports to /layers. After insert, the freshly-created
    layer ids must be unioned into the section's seeded_formation_contact_ids.
    """
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

    project, model, bh, formation, _ = project_with_two_layers
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[],
    )
    db_session.add(section)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model.id}/layers",
        json={
            "section_id": str(section.id),
            "layers": [
                {
                    "formation_id": str(formation.id),
                    "borehole_id": str(bh.id),
                    "depth_top_m": 6.5,
                    "depth_base_m": 7.5,
                    "status": "accepted",
                    "source": "manual",
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    layer_id = body[0]["id"]
    # expire_on_commit=False on the integration session keeps the
    # cached `section` object alive with its pre-update empty array;
    # a SELECT against a fresh column bypasses the identity-map cache.
    from sqlalchemy import select

    row = (
        await db_session.execute(
            select(CrossSectionOrm.seeded_formation_contact_ids).where(
                CrossSectionOrm.id == section.id
            )
        )
    ).scalar_one()
    assert layer_id in [str(x) for x in (row or [])]


# ---------------------------------------------------------------------------
# DELETE /layers/{lid} — A4 slice 4 (dogfeed 2026-05-31)
# ---------------------------------------------------------------------------


async def test_delete_layer_removes_pending_row(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
    db_session: AsyncSession,
) -> None:
    """DELETE /layers/{lid} drops the row and returns 204."""
    project, model, _, _, layers = project_with_two_layers
    upper = layers[0]
    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{upper.id}"
    )
    assert resp.status_code == 204, resp.text
    # Row gone.
    from sqlalchemy import select

    row = (
        await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.id == upper.id))
    ).scalar_one_or_none()
    assert row is None


async def test_delete_layer_is_idempotent_on_unknown_id(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    """Deleting a layer that does not exist still returns 204.

    Mirrors ``DELETE /contacts/{cid}`` semantics — the FE doesn't have
    to special-case "already gone".
    """
    project, model, _, _, _ = project_with_two_layers
    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{uuid7()}"
    )
    assert resp.status_code == 204


async def test_delete_accepted_layer_removes_fc_mirror_via_trigger(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
    db_session: AsyncSession,
) -> None:
    """Deleting an accepted layer cascades the FormationContact mirror.

    Pins the LL→FC trigger pathway end-to-end: accept the layer (so the
    trigger materialises the FC mirror), DELETE the layer, then verify
    the matching ``formation_contact`` row has also gone. Without this
    cascade the contact would linger as an orphan readable through the
    bundle export.
    """
    from sqlalchemy import select

    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm,
    )

    project, model, _, _, layers = project_with_two_layers
    upper = layers[0]
    # Accept first so the LL→FC trigger materialises the FC mirror.
    acc = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{upper.id}",
        json={"status": "accepted"},
    )
    assert acc.status_code == 200, acc.text
    # Bypass the identity-map cache: expire_on_commit=False keeps a
    # cached FC alive even after the trigger deletes the row, so
    # session.get returns the stale object. Re-SELECT from the column.
    fc_before_id = (
        await db_session.execute(
            select(FormationContactOrm.id).where(FormationContactOrm.id == upper.id)
        )
    ).scalar_one_or_none()
    assert fc_before_id is not None, "FC mirror should exist after accept"

    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{upper.id}"
    )
    assert resp.status_code == 204, resp.text

    fc_after_id = (
        await db_session.execute(
            select(FormationContactOrm.id).where(FormationContactOrm.id == upper.id)
        )
    ).scalar_one_or_none()
    assert fc_after_id is None, "FC mirror should be gone after layer delete"


async def test_delete_layer_unseeds_id_from_cross_sections(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
    db_session: AsyncSession,
) -> None:
    """Deleting a layer prunes its id from cross_section.seeded_formation_contact_ids.

    The seeded-ids array is the explicit-content invariant; an
    unpruned stale id bloats it and survives the LL row that gave it
    meaning.
    """
    from sqlalchemy import select

    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

    project, model, _, _, layers = project_with_two_layers
    upper = layers[0]
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="S",
        start_x=100000.0,
        start_y=200000.0,
        end_x=110000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[upper.id],
    )
    db_session.add(section)
    await db_session.commit()

    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model.id}/layers/{upper.id}"
    )
    assert resp.status_code == 204, resp.text

    row = (
        await db_session.execute(
            select(CrossSectionOrm.seeded_formation_contact_ids).where(
                CrossSectionOrm.id == section.id
            )
        )
    ).scalar_one()
    assert upper.id not in (row or []), (
        f"Section should no longer carry the deleted layer id; got {row}"
    )


async def test_delete_layer_404_on_unknown_model(
    async_client: AsyncClient,
    project_with_two_layers: tuple,
) -> None:
    """Wrong model_id in the URL returns 404, NOT a silent 204.

    Guards the scope check — the layer's parent model must agree with
    the URL or the FE is hitting the wrong endpoint and shouldn't get
    a destructive op acknowledged.
    """
    project, _, _, _, layers = project_with_two_layers
    upper = layers[0]
    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{uuid7()}/layers/{upper.id}"
    )
    assert resp.status_code == 404
