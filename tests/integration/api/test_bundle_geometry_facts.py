"""BF — body geometry facts ride the bundle: save/restore and Save As clone.

Facts are the persisted stage-3 body merge (owner ruling 2026-08-12). A
reopened ``.strix`` must keep its merged bodies WITHOUT waiting for the first
recompute, so the facts restore before ``reconcile_bodies_after_restore``
re-runs the resolver — and a Save As clone must carry them with remapped,
re-canonicalised layer endpoints.

Run via ``scripts\\run-integration-tests.ps1`` ONLY.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.test_recompute_bodies import _build_scene, _canonical_fact_pair


@pytest.mark.asyncio
async def test_bf1_facts_survive_save_delete_restore_and_reunion(
    db_session: AsyncSession, async_client: AsyncClient
) -> None:
    """BF1 — the open-from-file path keeps merged bodies merged.

    Save the bundle, wipe the project, restore it: the fact row is back, and
    the route's post-restore reconcile unions the two layers into ONE body —
    no recompute needed before the packing-tie guard answers correctly.
    """
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        BodyGeometryFactOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b)
    )
    await db_session.commit()

    bundle_resp = await async_client.get(f"/projects/{scene.project_id}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    assert len(bundle["body_geometry_facts"]) == 1, "the bundle must carry the fact"

    project = await db_session.get(ProjectOrm, scene.project_id)
    assert project is not None
    await db_session.delete(project)
    await db_session.commit()

    restore_resp = await async_client.post(f"/projects/{scene.project_id}/restore", json=bundle)
    assert restore_resp.status_code == 200, restore_resp.text

    db_session.expire_all()
    facts = (
        (
            await db_session.execute(
                select(BodyGeometryFactOrm).where(BodyGeometryFactOrm.model_id == scene.model_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(facts) == 1, "the fact must restore with the bundle"
    body_ids = set(
        (
            await db_session.execute(
                select(LithoLayerOrm.body_id).where(LithoLayerOrm.model_id == scene.model_id)
            )
        )
        .scalars()
        .all()
    )
    assert None not in body_ids
    assert len(body_ids) == 1, (
        "the post-restore resolver must union the restored fact — a reopened "
        "project keeps its merged bodies"
    )


@pytest.mark.asyncio
async def test_bf2_the_clone_remaps_and_recanonicalises_fact_endpoints(
    db_session: AsyncSession, async_client: AsyncClient
) -> None:
    """BF2 — Save As carries facts onto the copied layers, canonical order held."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        BodyGeometryFactOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b)
    )
    await db_session.commit()

    dup_resp = await async_client.post(
        f"/projects/{scene.project_id}/duplicate", json={"name": "BF2 clone"}
    )
    assert dup_resp.status_code in (200, 201), dup_resp.text
    clone_project_id = UUID(dup_resp.json()["id"])

    db_session.expire_all()
    clone_facts = (
        (
            await db_session.execute(
                select(BodyGeometryFactOrm)
                .join(LithoLayerOrm, LithoLayerOrm.id == BodyGeometryFactOrm.layer_a_id)
                .where(LithoLayerOrm.model_id == BodyGeometryFactOrm.model_id)
            )
        )
        .scalars()
        .all()
    )
    # Scope to the clone: its fact is the one whose endpoints are NOT the
    # source layers.
    source_layers = {scene.layer_a_id, scene.layer_b_id}
    cloned = [
        f
        for f in clone_facts
        if f.layer_a_id not in source_layers and f.layer_b_id not in source_layers
    ]
    assert len(cloned) == 1, "the clone must carry exactly one remapped fact"
    fact = cloned[0]
    assert str(fact.layer_a_id) < str(fact.layer_b_id), "canonical order must survive the remap"
    clone_layer_ids = set(
        (
            await db_session.execute(
                select(LithoLayerOrm.id)
                .join(
                    BodyGeometryFactOrm,
                    BodyGeometryFactOrm.model_id == LithoLayerOrm.model_id,
                )
                .where(BodyGeometryFactOrm.id == fact.id)
            )
        )
        .scalars()
        .all()
    )
    assert fact.layer_a_id in clone_layer_ids and fact.layer_b_id in clone_layer_ids, (
        "the fact endpoints must be the CLONE's layers"
    )
    assert clone_project_id != scene.project_id


@pytest.mark.asyncio
async def test_bf3_a_fact_pointing_at_another_models_layer_is_dropped(
    db_session: AsyncSession, async_client: AsyncClient
) -> None:
    """BF3 — audit P2-7 (2026-08-18): fact endpoints must belong to the
    fact's OWN model.

    The restore used to check endpoints against a project-wide layer set, so
    a malformed fact for model A whose endpoint sits in model B (same
    project) persisted and round-tripped — an internally incoherent bundle.
    """
    from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

    scene = await _build_scene(db_session)
    # A second litho model in the SAME project, with one accepted layer.
    other = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=scene.project_id,
        name="RB-other",
        kind="lithostratigraphic",
        parent_model_id=(
            await db_session.execute(
                select(GeologicalModelOrm.parent_model_id).where(
                    GeologicalModelOrm.id == scene.model_id
                )
            )
        ).scalar_one(),
    )
    db_session.add(other)
    await db_session.flush()
    foreign_layer = LithoLayerOrm(
        id=uuid7(),
        model_id=other.id,
        formation_id=scene.formation_id,
        borehole_id=scene.inv_1_id,
        depth_top_m=10.0,
        depth_base_m=12.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(foreign_layer)
    foreign_layer_id = foreign_layer.id
    other_id = other.id
    await db_session.commit()

    bundle_resp = await async_client.get(f"/projects/{scene.project_id}/bundle")
    assert bundle_resp.status_code == 200
    bundle = bundle_resp.json()
    # The malformed fact: registered on the SCENE model, one endpoint in the
    # OTHER model.
    a, b = _canonical_fact_pair(scene.layer_a_id, foreign_layer_id)
    bundle["body_geometry_facts"] = [
        {
            "id": str(uuid7()),
            "model_id": str(scene.model_id),
            "layer_a_id": str(a),
            "layer_b_id": str(b),
        }
    ]

    project = await db_session.get(ProjectOrm, scene.project_id)
    assert project is not None
    await db_session.delete(project)
    await db_session.commit()

    restore_resp = await async_client.post(f"/projects/{scene.project_id}/restore", json=bundle)
    assert restore_resp.status_code == 200, restore_resp.text

    db_session.expire_all()
    facts = (
        (
            await db_session.execute(
                select(BodyGeometryFactOrm).where(BodyGeometryFactOrm.model_id == scene.model_id)
            )
        )
        .scalars()
        .all()
    )
    assert facts == [], "a fact whose endpoint belongs to another model must be dropped at restore"
    assert str(other_id)  # silence unused warnings honestly
