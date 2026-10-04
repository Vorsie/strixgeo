"""RB — POST .../bodies/recompute persists the geometric body merge.

Owner ruling 2026-08-12: every set of same-lithology units whose fill regions
connect shares one ``litho_layer.body_id`` ("how else are we going to extract
qc or sample data by body"). The endpoint replaces a model's geometry facts
from the frontend's partition evidence and re-runs the resolver. Since owner
2026-10-04 (*"identity follows the drawing"*) those facts are the ONLY union:
an accepted tie the fill does not paint as a band joins nothing (RB12).

Run via ``scripts\\run-integration-tests.ps1`` ONLY.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@dataclass
class _Scene:
    """Ids the two-body scene exposes to the tests."""

    project_id: UUID
    model_id: UUID
    formation_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    body_a_id: UUID
    body_b_id: UUID
    inv_1_id: UUID
    inv_2_id: UUID
    section_id: UUID


async def _build_scene(db_session: AsyncSession, *, kind: str = "lithostratigraphic") -> _Scene:
    """Two accepted, uncorrelated SAND layers on two boreholes → two bodies."""
    project = ProjectOrm(id=uuid7(), name=f"RB scene ({kind})", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="RB-Geo", kind="geological"
    )
    db_session.add(geo)
    await db_session.flush()
    parent_model_id = geo.id
    if kind == "geotechnical":
        litho = GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="RB-Litho",
            kind="lithostratigraphic",
            parent_model_id=geo.id,
        )
        db_session.add(litho)
        await db_session.flush()
        parent_model_id = litho.id
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=f"RB-{kind}",
        kind=kind,
        parent_model_id=parent_model_id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-RB",
        color="#e0c068",
        display_order=0,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    db_session.add_all([model, sand])
    await db_session.flush()

    boreholes = []
    for i in (1, 2):
        bh = BoreholeOrm(
            id=uuid7(),
            name=f"BH-RB-{i}",
            app_project_id=project.id,
            project_id="RB",
            test_id=f"BH-RB-{i}",
            location_x=160000.0 + i * 25.0,
            location_y=200000.0,
            epsg=31370,
            total_depth_m=20.0,
        )
        boreholes.append(bh)
    db_session.add_all(boreholes)
    await db_session.flush()

    layers = []
    for bh in boreholes:
        layers.append(
            LithoLayerOrm(
                id=uuid7(),
                model_id=model.id,
                formation_id=sand.id,
                borehole_id=bh.id,
                depth_top_m=2.0,
                depth_base_m=8.0,
                status="accepted",
                source="manual",
                confidence="medium",
            )
        )
    db_session.add_all(layers)
    # A REAL cross-section row: the recompute contract (audit P1-3) requires
    # the payload's section_ids to cover the project's sections exactly, so
    # the scene owns the one section its payloads speak for.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="RB-Section",
        start_x=160000.0,
        start_y=200000.0,
        end_x=160100.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add(section)
    # Plain ids captured BEFORE commit/expire — reading ORM attributes on
    # expired instances lazy-loads synchronously and raises MissingGreenlet.
    project_id, model_id, formation_id = project.id, model.id, sand.id
    section_id = section.id
    layer_ids = [ly.id for ly in layers]
    inv_ids = [bh.id for bh in boreholes]
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=model_id)
    db_session.expire_all()
    layer_a = await db_session.get(LithoLayerOrm, layer_ids[0])
    layer_b = await db_session.get(LithoLayerOrm, layer_ids[1])
    assert layer_a is not None and layer_b is not None
    assert layer_a.body_id is not None and layer_b.body_id is not None
    assert layer_a.body_id != layer_b.body_id, "the scene starts as TWO bodies"

    return _Scene(
        project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        layer_a_id=layer_ids[0],
        layer_b_id=layer_ids[1],
        body_a_id=layer_a.body_id,
        body_b_id=layer_b.body_id,
        inv_1_id=inv_ids[0],
        inv_2_id=inv_ids[1],
        section_id=section_id,
    )


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> _Scene:
    """The default lithostratigraphic two-body scene."""
    return await _build_scene(db_session)


def _canonical_fact_pair(layer_x: UUID, layer_y: UUID) -> tuple[UUID, UUID]:
    """Order a layer pair canonically (a < b), as the fact CHECK demands."""
    a, b = sorted((layer_x, layer_y), key=str)
    return a, b


def _url(s: _Scene) -> str:
    return f"/projects/{s.project_id}/geology/models/{s.model_id}/bodies/recompute"


def _minimal_section(s: _Scene) -> dict:
    """One section, two columns, one quad region per body, non-overlapping.

    The two regions sit in DIFFERENT elevation ranges at the shared column so
    the cross-section alias planner cannot union them by accident — union
    evidence in these tests comes from ``body_groups`` unless a test says
    otherwise.
    """
    return {
        "start_x": 160025.0,
        "start_y": 200000.0,
        "end_x": 160050.0,
        "end_y": 200000.0,
        "columns": [
            {
                "investigation_id": str(s.inv_1_id),
                "along_m": 0.0,
                "world_x": 160025.0,
                "world_y": 200000.0,
            },
            {
                "investigation_id": str(s.inv_2_id),
                "along_m": 25.0,
                "world_x": 160050.0,
                "world_y": 200000.0,
            },
        ],
        "regions": [
            {
                "formation_id": str(s.formation_id),
                "body_id": str(s.body_a_id),
                "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, -2.0], [0.0, -2.0]],
                "gap_index": 0,
                "kind": "quad",
                "layer_ids": [str(s.layer_a_id)],
            },
            {
                "formation_id": str(s.formation_id),
                "body_id": str(s.body_b_id),
                "polygon": [[0.0, -10.0], [1.0, -10.0], [1.0, -12.0], [0.0, -12.0]],
                "gap_index": 0,
                "kind": "quad",
                "layer_ids": [str(s.layer_b_id)],
            },
        ],
    }


def _merge_payload(s: _Scene) -> dict:
    """Union evidence: one per-section connectivity group joining the LAYERS."""
    return {
        "sections": [_minimal_section(s)],
        "section_ids": [str(s.section_id)],
        "layer_groups": [[[str(s.layer_a_id), str(s.layer_b_id)]]],
    }


async def _body_ids(db_session: AsyncSession, s: _Scene) -> set[UUID]:
    db_session.expire_all()
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm.body_id).where(LithoLayerOrm.model_id == s.model_id)
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


async def _fact_count(db_session: AsyncSession, s: _Scene) -> int:
    rows = (
        (
            await db_session.execute(
                select(BodyGeometryFactOrm).where(BodyGeometryFactOrm.model_id == s.model_id)
            )
        )
        .scalars()
        .all()
    )
    return len(rows)


@pytest.mark.asyncio
async def test_rb1_a_group_merge_persists_and_is_idempotent(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB1 — the per-section group evidence writes a fact and fuses the bodies."""
    resp = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["facts_written"] == 1
    assert body["bodies_merged"] == 1
    assert body["bodies_split"] == 0

    ids = await _body_ids(db_session, scene)
    assert len(ids) == 1, "both layers must share ONE body id after the recompute"

    # Idempotent: the same payload again changes nothing.
    resp2 = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["bodies_merged"] == 0
    assert resp2.json()["bodies_split"] == 0


@pytest.mark.asyncio
async def test_rb2_the_full_replace_splits_when_the_evidence_disappears(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB2 — a recompute WITHOUT the group evidence removes the fact: split."""
    resp = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp.status_code == 200, resp.text
    assert len(await _body_ids(db_session, scene)) == 1

    no_union = _merge_payload(scene)
    no_union["layer_groups"] = [[]]
    resp2 = await async_client.post(_url(scene), json=no_union)
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["facts_written"] == 0
    assert resp2.json()["bodies_split"] == 1
    assert len(await _body_ids(db_session, scene)) == 2


@pytest.mark.asyncio
async def test_rb3_the_geotech_model_kind_is_served(
    db_session: AsyncSession, async_client: AsyncClient
) -> None:
    """RB3 — packing bodies get the same pipeline (qc-per-body extraction)."""
    s = await _build_scene(db_session, kind="geotechnical")
    resp = await async_client.post(_url(s), json=_merge_payload(s))
    assert resp.status_code == 200, resp.text
    assert resp.json()["bodies_merged"] == 1
    assert len(await _body_ids(db_session, s)) == 1


@pytest.mark.asyncio
async def test_rb4_an_empty_payload_is_refused_and_wipes_nothing(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB4 — an empty payload would split every merged body; it must 422."""
    resp = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp.status_code == 200, resp.text
    assert await _fact_count(db_session, scene) == 1

    resp2 = await async_client.post(_url(scene), json={"sections": [], "layer_groups": []})
    assert resp2.status_code == 422, resp2.text
    assert resp2.json()["detail"]["code"] == "empty_recompute_payload"
    assert await _fact_count(db_session, scene) == 1, "the refusal must write NOTHING"
    assert len(await _body_ids(db_session, scene)) == 1


@pytest.mark.asyncio
async def test_rb5_a_stale_layer_id_is_dropped_not_a_500(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB5 — a snapshot older than the database degrades gracefully."""
    payload = _merge_payload(scene)
    payload["layer_groups"] = [[[str(scene.layer_a_id), str(uuid7())]]]  # layer never existed
    resp = await async_client.post(_url(scene), json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["facts_dropped_stale"] == 1
    assert resp.json()["facts_written"] == 0
    assert len(await _body_ids(db_session, scene)) == 2


@pytest.mark.asyncio
async def test_rb8_the_cross_section_alias_arm_unions_without_groups(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB8 — two sections sharing a column union via plan_body_aliases.

    No ``body_groups`` at all: the union evidence is purely geometric — each
    section carries one region reaching the SHARED investigation column with
    overlapping elevation, which is exactly the stage-2 shared-column rule.
    Deleting the ``plan_body_aliases`` call from the use case turns this RED.
    """
    section_a = {
        "start_x": 160000.0,
        "start_y": 200000.0,
        "end_x": 160025.0,
        "end_y": 200000.0,
        "columns": [
            {
                "investigation_id": str(uuid7()),
                "along_m": 0.0,
                "world_x": 160000.0,
                "world_y": 200000.0,
            },
            {
                "investigation_id": str(scene.inv_1_id),
                "along_m": 25.0,
                "world_x": 160025.0,
                "world_y": 200000.0,
            },
        ],
        "regions": [
            {
                "formation_id": str(scene.formation_id),
                "body_id": str(scene.body_a_id),
                "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, -5.0], [0.0, -5.0]],
                "gap_index": 0,
                "kind": "quad",
                "layer_ids": [str(scene.layer_a_id)],
            }
        ],
    }
    section_b = {
        "start_x": 160025.0,
        "start_y": 200000.0,
        "end_x": 160050.0,
        "end_y": 200100.0,
        "columns": [
            {
                "investigation_id": str(scene.inv_1_id),
                "along_m": 0.0,
                "world_x": 160025.0,
                "world_y": 200000.0,
            },
            {
                "investigation_id": str(scene.inv_2_id),
                "along_m": 25.0,
                "world_x": 160050.0,
                "world_y": 200100.0,
            },
        ],
        "regions": [
            {
                "formation_id": str(scene.formation_id),
                "body_id": str(scene.body_b_id),
                "polygon": [[0.0, -1.0], [1.0, -1.0], [1.0, -4.0], [0.0, -4.0]],
                "gap_index": 0,
                "kind": "quad",
                "layer_ids": [str(scene.layer_b_id)],
            }
        ],
    }
    # The second frame speaks for a REAL second section — coverage is exact.
    second = CrossSectionOrm(
        id=uuid7(),
        app_project_id=scene.project_id,
        name="RB-Section-B",
        start_x=160000.0,
        start_y=200050.0,
        end_x=160100.0,
        end_y=200050.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add(second)
    await db_session.commit()
    payload = {
        "sections": [section_a, section_b],
        "section_ids": [str(scene.section_id), str(second.id)],
        "layer_groups": [],
    }
    resp = await async_client.post(_url(scene), json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["bodies_merged"] == 1
    assert len(await _body_ids(db_session, scene)) == 1


@pytest.mark.asyncio
async def test_rb10_partial_section_coverage_is_refused_and_erases_nothing(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB10 — audit P1-3 (2026-08-18): the replace is model-wide, so the
    payload must speak for the WHOLE model.

    A stale or partially loaded client that posts a subset of the sections
    must be refused before the delete — the old behaviour silently erased the
    omitted sections' connectivity evidence, splitting persisted bodies on
    the next resolver run.
    """
    # Establish evidence with full coverage first.
    resp = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp.status_code == 200, resp.text
    facts_before = await _fact_count(db_session, scene)
    assert facts_before >= 1

    # A second section now exists that the next payload does NOT speak for.
    second = CrossSectionOrm(
        id=uuid7(),
        app_project_id=scene.project_id,
        name="RB-Section-C",
        start_x=160000.0,
        start_y=200100.0,
        end_x=160100.0,
        end_y=200100.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add(second)
    await db_session.commit()

    partial = _merge_payload(scene)  # covers only the first section
    resp2 = await async_client.post(_url(scene), json=partial)
    assert resp2.status_code == 422, resp2.text
    assert resp2.json()["detail"]["code"] == "incomplete_recompute_coverage"
    assert await _fact_count(db_session, scene) == facts_before, (
        "a refused recompute must not touch the stored facts"
    )


@pytest.mark.asyncio
async def test_rb9_the_post_merge_snapshot_holds_the_merge(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB9 — the oscillator pin: a merge must survive its own success.

    The live failure (dogfeed 2026-08-12 evening): after a merge, the frontend
    refetches and every region carries the MERGED body id. Under the body-id
    wire design the next payload's evidence collapsed to singletons, the
    wholesale replace erased the facts that held the merge, and the bodies
    split again — facts flapping 74 → 3 → 69 on the dev model. With layer-id
    evidence, the post-merge payload describes the SAME geometry, so the facts
    and the bodies must not move.
    """
    resp = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp.status_code == 200, resp.text
    assert resp.json()["bodies_merged"] == 1
    merged_ids = await _body_ids(db_session, scene)
    assert len(merged_ids) == 1
    (merged_id,) = merged_ids

    # The POST-merge snapshot: identical geometry and layer evidence, but every
    # region now labelled with the merged body id — exactly what the frontend
    # sends after its refetch.
    post_merge = _merge_payload(scene)
    for region in post_merge["sections"][0]["regions"]:
        region["body_id"] = str(merged_id)

    resp2 = await async_client.post(_url(scene), json=post_merge)
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["facts_written"] == 1, "the evidence must not collapse"
    assert resp2.json()["bodies_split"] == 0, "the merge must hold"
    assert resp2.json()["bodies_merged"] == 0
    assert len(await _body_ids(db_session, scene)) == 1


# ---------------------------------------------------------------------------
# RB11 — granular body identity (owner 2026-09-01: "start totally granular —
# small disconnected bodies of litho and packing; the user lumps them into
# groups").  This REVERSES the debt-#278 class-collapse for the IDENTITY path.
# The geotech model can still hold two ZAND NAD-6 rows under different geological
# parents; two such masses touching across a shared column are NO LONGER fused
# on contact — distinct formation rows stay distinct bodies, and the user joins
# them by hand.  The recompute now compares the raw formation ROW, not the class.
# (The 3-D voxel PAINT path — plan_body_aliases in build_voxel_litho_model — is
# deliberately NOT changed here and stays class-merged.)
# ---------------------------------------------------------------------------


@dataclass
class _TwinScene:
    """Ids the twin-formation scene exposes to RB11."""

    project_id: UUID
    model_id: UUID
    f1_id: UUID
    f2_id: UUID
    layer1_id: UUID
    layer2_id: UUID
    body1_id: UUID
    body2_id: UUID
    inv_x_id: UUID
    inv_1_id: UUID
    inv_2_id: UUID
    section_a_id: UUID
    section_b_id: UUID


async def _build_twin_scene(db_session: AsyncSession) -> _TwinScene:
    """A geotech model with two NAD-6 ZAND rows under different geo parents.

    The two layers resolve to TWO bodies (distinct formation rows, no ties),
    exactly the state a real geotech model reaches wherever one packing class
    is split across a geological boundary.
    """
    project = ProjectOrm(id=uuid7(), name="RB twin scene", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="RB-Twin-Geo", kind="geological"
    )
    db_session.add(geo)
    await db_session.flush()
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="RB-Twin-Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    db_session.add(litho)
    await db_session.flush()
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="RB-Twin-Geotech",
        kind="geotechnical",
        parent_model_id=litho.id,
    )
    # The two distinct GEOLOGICAL parents that make the twins separate rows.
    geo_a = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="GEO-A", color="#808080", display_order=0
    )
    geo_b = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="GEO-B", color="#909090", display_order=1
    )
    db_session.add_all([model, geo_a, geo_b])
    await db_session.flush()

    # Twin geotech rows: same NAD class + soil, different source geo parent.
    f1 = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-NAD6-A",
        color="#e0c068",
        display_order=0,
        litho_main_soil_code="ZAND",
        nad_class=6,
        source_geo_formation_id=geo_a.id,
        instance_ordinal=0,
    )
    f2 = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-NAD6-B",
        color="#e0c068",
        display_order=1,
        litho_main_soil_code="ZAND",
        nad_class=6,
        source_geo_formation_id=geo_b.id,
        instance_ordinal=0,
    )
    db_session.add_all([f1, f2])
    await db_session.flush()

    boreholes = []
    for i in (1, 2):
        bh = BoreholeOrm(
            id=uuid7(),
            name=f"BH-TW-{i}",
            app_project_id=project.id,
            project_id="TW",
            test_id=f"BH-TW-{i}",
            location_x=160000.0 + i * 25.0,
            location_y=200000.0,
            epsg=31370,
            total_depth_m=20.0,
        )
        boreholes.append(bh)
    db_session.add_all(boreholes)
    await db_session.flush()

    layer1 = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f1.id,
        borehole_id=boreholes[0].id,
        depth_top_m=2.0,
        depth_base_m=8.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer2 = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f2.id,
        borehole_id=boreholes[1].id,
        depth_top_m=2.0,
        depth_base_m=8.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add_all([layer1, layer2])

    section_a = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="TW-Section-A",
        start_x=160000.0,
        start_y=200000.0,
        end_x=160025.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    section_b = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="TW-Section-B",
        start_x=160025.0,
        start_y=200000.0,
        end_x=160050.0,
        end_y=200100.0,
        epsg=31370,
        projection_buffer_m=60.0,
    )
    db_session.add_all([section_a, section_b])

    project_id, model_id = project.id, model.id
    f1_id, f2_id = f1.id, f2.id
    layer1_id, layer2_id = layer1.id, layer2.id
    inv_1_id, inv_2_id = boreholes[0].id, boreholes[1].id
    section_a_id, section_b_id = section_a.id, section_b.id
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=model_id)
    db_session.expire_all()
    l1 = await db_session.get(LithoLayerOrm, layer1_id)
    l2 = await db_session.get(LithoLayerOrm, layer2_id)
    assert l1 is not None and l2 is not None
    assert l1.body_id is not None and l2.body_id is not None
    assert l1.body_id != l2.body_id, "twin-row layers start as TWO bodies"

    return _TwinScene(
        project_id=project_id,
        model_id=model_id,
        f1_id=f1_id,
        f2_id=f2_id,
        layer1_id=layer1_id,
        layer2_id=layer2_id,
        body1_id=l1.body_id,
        body2_id=l2.body_id,
        inv_x_id=uuid7(),
        inv_1_id=inv_1_id,
        inv_2_id=inv_2_id,
        section_a_id=section_a_id,
        section_b_id=section_b_id,
    )


@pytest.mark.asyncio
async def test_rb11_twin_class_rows_stay_granular_across_sections(
    db_session: AsyncSession, async_client: AsyncClient
) -> None:
    """RB11 — two NAD-6 ZAND rows touching a shared column stay TWO bodies.

    The only connectivity is geometric: each section carries one region reaching
    the SHARED column with overlapping elevation, but the regions carry DIFFERENT
    formation rows. Under the granular ruling (owner 2026-09-01) the identity
    engine keys on the raw formation ROW, so the twin-class masses are NOT fused
    on contact — they remain two disconnected bodies for the user to lump. This
    is the reverse of the old debt-#278 class-collapse: no fact lands, no merge.
    """
    s = await _build_twin_scene(db_session)
    section_a = {
        "start_x": 160000.0,
        "start_y": 200000.0,
        "end_x": 160025.0,
        "end_y": 200000.0,
        "columns": [
            {
                "investigation_id": str(s.inv_x_id),
                "along_m": 0.0,
                "world_x": 160000.0,
                "world_y": 200000.0,
            },
            {
                "investigation_id": str(s.inv_1_id),
                "along_m": 25.0,
                "world_x": 160025.0,
                "world_y": 200000.0,
            },
        ],
        "regions": [
            {
                "formation_id": str(s.f1_id),
                "body_id": str(s.body1_id),
                "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, -5.0], [0.0, -5.0]],
                "gap_index": 0,
                "kind": "quad",
                "layer_ids": [str(s.layer1_id)],
            }
        ],
    }
    section_b = {
        "start_x": 160025.0,
        "start_y": 200000.0,
        "end_x": 160050.0,
        "end_y": 200100.0,
        "columns": [
            {
                "investigation_id": str(s.inv_1_id),
                "along_m": 0.0,
                "world_x": 160025.0,
                "world_y": 200000.0,
            },
            {
                "investigation_id": str(s.inv_2_id),
                "along_m": 25.0,
                "world_x": 160050.0,
                "world_y": 200100.0,
            },
        ],
        "regions": [
            {
                "formation_id": str(s.f2_id),
                "body_id": str(s.body2_id),
                "polygon": [[0.0, -1.0], [1.0, -1.0], [1.0, -4.0], [0.0, -4.0]],
                "gap_index": 0,
                "kind": "quad",
                "layer_ids": [str(s.layer2_id)],
            }
        ],
    }
    payload = {
        "sections": [section_a, section_b],
        "section_ids": [str(s.section_a_id), str(s.section_b_id)],
        "layer_groups": [],
    }
    url = f"/projects/{s.project_id}/geology/models/{s.model_id}/bodies/recompute"
    resp = await async_client.post(url, json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["bodies_merged"] == 0
    ids = (
        (
            await db_session.execute(
                select(LithoLayerOrm.body_id).where(LithoLayerOrm.model_id == s.model_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(set(ids)) == 2, "the twin-class layers stay TWO granular bodies"


@pytest.mark.asyncio
async def test_rb12_an_accepted_tie_with_no_painted_band_leaves_two_bodies(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB12 — owner 2026-10-04, "identity follows the drawing" (testproject_dev CS4).

    Two ZAND bands joined by ONE accepted tie the fill does not paint as a band
    (a lone top tie in the sub-TD zone: no base tie = no band). The renderer's
    recompute carries no connectivity group for the pair, so no fact is written
    and the bands stay TWO bodies — the tie is a surface statement. When the fill
    paints the band (the base tie added), the group arrives and they are ONE.
    """
    a_id, b_id = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=scene.model_id,
            layer_a_id=a_id,
            layer_b_id=b_id,
            source="manual",
            user_approved=True,
            section_id=scene.section_id,
        )
    )
    await db_session.commit()

    unbanded = _merge_payload(scene)
    unbanded["layer_groups"] = [[]]
    resp = await async_client.post(_url(scene), json=unbanded)
    assert resp.status_code == 200, resp.text
    assert resp.json()["facts_written"] == 0
    assert len(await _body_ids(db_session, scene)) == 2, (
        "an accepted tie the fill does not band must not join the two bands"
    )

    resp2 = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["facts_written"] == 1
    assert resp2.json()["bodies_merged"] == 1
    assert len(await _body_ids(db_session, scene)) == 1, "the painted band joins them"


async def _seed_fresh_solid(db_session: AsyncSession, s: _Scene) -> None:
    """Insert one NON-stale cached solid for the scene's model (a built model)."""
    db_session.add(
        LithoBodySolidOrm(
            id=uuid7(),
            model_id=s.model_id,
            body_id=uuid7(),
            formation_id=s.formation_id,
            vertices=[],
            triangles=[],
            source_pick_count=0,
            source_pick_checksum=b"",
            is_stale=False,
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_rb13_the_answer_says_when_the_recompute_staled_the_built_solids(
    scene: _Scene, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RB13 — owner 2026-10-04: "adding a new correlation doesn't mark the litho stale".

    The recompute that merges two bodies stales the model's built 3-D solids, and
    it runs AFTER the edit's own re-read. Its answer must say so, so the desktop
    re-reads the solids and the Build badge turns amber. A recompute that changes
    nothing must not claim it staled anything.
    """
    await _seed_fresh_solid(db_session, scene)

    resp = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp.status_code == 200, resp.text
    assert resp.json()["bodies_merged"] == 1
    assert resp.json()["solids_stale"] is True, "a merge staled the built solids"

    # The same payload again: no body changes, the solids were already stale.
    resp2 = await async_client.post(_url(scene), json=_merge_payload(scene))
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["solids_stale"] is False, "a no-op recompute stales nothing"
