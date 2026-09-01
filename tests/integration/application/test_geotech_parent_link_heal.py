"""The geotech Build heals stale/NULL litho parent links (owner 2026-09-01).

Pins the fix for the bug diagnosed on the owner's real data: every geotech band
had ``parent_litho_layer_id = NULL`` and every geotech body had
``parent_litho_body_id = NULL``, so the units tree collapsed everything into the
"No litho body" bucket. Root cause: those links were stamped only at
subdivide/recompute — BEFORE the user's final edits — and never re-derived, so an
edited/re-materialised band read them stale. Owner ruling: re-derive them at the
LAST whole-model operation, the geotech voxel Build, which does NOT run the
resolver and so must heal both links itself.

Scene (one borehole, one covering litho band, two geotech member bands of one
body, all parent links NULL):

  BH1
    litho model L:   LB1  [0, 5) accepted  → resolved into litho body LBODY1
    geotech model G: GB1  [1, 3) accepted  parent_litho_layer_id = NULL
                     GB2  [3, 4.5) accepted parent_litho_layer_id = NULL
                     body GBODY (members GB1, GB2) parent_litho_body_id = NULL

Both geotech midpoints (2.0, 3.75) fall inside LB1 [0, 5), so after the Build:
  * GB1.parent_litho_layer_id == GB2.parent_litho_layer_id == LB1.id (overwrite),
  * GBODY.parent_litho_body_id == LBODY1 (shallowest covered member GB1 → LB1's
    litho body), and
  * a subsequent LITHO recompute must NOT clobber the band FKs.

RUN ONLY via ``.\\scripts\\run-integration-tests.ps1`` (it TRUNCATEs a sibling
DB and holds the single-run lock). A bare ``pytest tests/integration`` wipes
whatever ``DATABASE_URL`` points at — never do that.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

pytestmark = pytest.mark.asyncio


@dataclass
class _Scene:
    """Ids the parent-link-heal scene exposes to the tests."""

    litho_model_id: UUID
    geotech_model_id: UUID
    litho_band_id: UUID
    litho_body_id: UUID
    geo_band_shallow_id: UUID
    geo_band_deep_id: UUID
    geo_body_id: UUID
    orphan_band_id: UUID
    orphan_body_id: UUID


async def _build_scene(db_session: AsyncSession) -> _Scene:
    """Seed the geotech scene with every litho parent link NULL.

    Runs the LITHO resolver (to give ``LB1`` a real body) but stamps the geotech
    bodies + member links by hand, so the starting state is exactly the bug's:
    accepted geotech bands with ``parent_litho_layer_id = NULL`` and geotech
    bodies with ``parent_litho_body_id = NULL``.
    """
    project = ProjectOrm(id=uuid7(), name="PLH scene", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="PLH-Geo", kind="geological"
    )
    db_session.add(geo)
    await db_session.flush()
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="PLH-Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    db_session.add(litho)
    await db_session.flush()
    geotech = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="PLH-Geotech",
        kind="geotechnical",
        parent_model_id=litho.id,
    )
    litho_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-litho",
        color="#e0c068",
        display_order=0,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    geotech_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-geotech",
        color="#e0c068",
        display_order=1,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
        nad_class=19,
    )
    db_session.add_all([geotech, litho_sand, geotech_sand])
    await db_session.flush()

    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-PLH",
        app_project_id=project.id,
        project_id="PLH",
        test_id="BH-PLH",
        location_x=160000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add(bh)
    await db_session.flush()

    # One accepted litho band [0, 5) — the covering band for both geotech bands.
    litho_band = LithoLayerOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=litho_sand.id,
        borehole_id=bh.id,
        depth_top_m=0.0,
        depth_base_m=5.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    # Two accepted geotech bands whose midpoints (2.0, 3.75) fall inside LB1, plus
    # a THIRD band [12, 14) whose midpoint 13.0 falls below LB1 — a true orphan.
    geo_shallow = LithoLayerOrm(
        id=uuid7(),
        model_id=geotech.id,
        formation_id=geotech_sand.id,
        borehole_id=bh.id,
        depth_top_m=1.0,
        depth_base_m=3.0,
        status="accepted",
        source="segmenter",
        confidence="medium",
        parent_litho_layer_id=None,
    )
    geo_deep = LithoLayerOrm(
        id=uuid7(),
        model_id=geotech.id,
        formation_id=geotech_sand.id,
        borehole_id=bh.id,
        depth_top_m=3.0,
        depth_base_m=4.5,
        status="accepted",
        source="segmenter",
        confidence="medium",
        parent_litho_layer_id=None,
    )
    orphan_band = LithoLayerOrm(
        id=uuid7(),
        model_id=geotech.id,
        formation_id=geotech_sand.id,
        borehole_id=bh.id,
        depth_top_m=12.0,
        depth_base_m=14.0,
        status="accepted",
        source="segmenter",
        confidence="medium",
        parent_litho_layer_id=None,
    )
    db_session.add_all([litho_band, geo_shallow, geo_deep, orphan_band])

    litho_model_id, geotech_model_id = litho.id, geotech.id
    litho_band_id = litho_band.id
    geo_shallow_id, geo_deep_id, orphan_band_id = geo_shallow.id, geo_deep.id, orphan_band.id
    project_id, geotech_formation_id, bh_id = project.id, geotech_sand.id, bh.id
    await db_session.commit()

    # A prior LITHO resolve gives LB1 a real body — the state the Build reads.
    await ResolveLithoInstances(db_session).execute(model_id=litho_model_id)
    db_session.expire_all()
    resolved_litho_band = await db_session.get(LithoLayerOrm, litho_band_id)
    assert resolved_litho_band is not None and resolved_litho_band.body_id is not None
    litho_body_id = resolved_litho_band.body_id

    # Hand-stamp the geotech bodies with NULL parent_litho_body_id — the bug's
    # starting state. GB1 + GB2 share ONE body; the orphan band is its own body.
    geo_body = BodyOrm(
        id=uuid7(),
        app_project_id=project_id,
        model_id=geotech_model_id,
        formation_id=geotech_formation_id,
        body_ordinal=0,
        source_investigation_id=bh_id,
        parent_litho_body_id=None,
    )
    orphan_body = BodyOrm(
        id=uuid7(),
        app_project_id=project_id,
        model_id=geotech_model_id,
        formation_id=geotech_formation_id,
        body_ordinal=1,
        source_investigation_id=bh_id,
        parent_litho_body_id=None,
    )
    db_session.add_all([geo_body, orphan_body])
    await db_session.flush()
    for band_id, body_id in (
        (geo_shallow_id, geo_body.id),
        (geo_deep_id, geo_body.id),
        (orphan_band_id, orphan_body.id),
    ):
        band = await db_session.get(LithoLayerOrm, band_id)
        assert band is not None
        band.body_id = body_id
    geo_body_id, orphan_body_id = geo_body.id, orphan_body.id
    await db_session.commit()

    return _Scene(
        litho_model_id=litho_model_id,
        geotech_model_id=geotech_model_id,
        litho_band_id=litho_band_id,
        litho_body_id=litho_body_id,
        geo_band_shallow_id=geo_shallow_id,
        geo_band_deep_id=geo_deep_id,
        geo_body_id=geo_body_id,
        orphan_band_id=orphan_band_id,
        orphan_body_id=orphan_body_id,
    )


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> _Scene:
    """The geotech scene with every litho parent link NULL."""
    return await _build_scene(db_session)


async def _band_parent(db_session: AsyncSession, band_id: UUID) -> UUID | None:
    return (
        await db_session.execute(
            select(LithoLayerOrm.parent_litho_layer_id).where(LithoLayerOrm.id == band_id)
        )
    ).scalar_one()


async def _body_parent(db_session: AsyncSession, body_id: UUID) -> UUID | None:
    return (
        await db_session.execute(select(BodyOrm.parent_litho_body_id).where(BodyOrm.id == body_id))
    ).scalar_one()


async def _run_geotech_build(db_session: AsyncSession, scene: _Scene) -> None:
    """Run the geotech voxel Build. Empty sections isolate the heal: it runs at
    the TOP of ``execute`` (before the "no sections" early return), so the parent
    links are re-derived + committed without needing a full voxel payload."""
    await BuildVoxelLithoModel(db_session).execute(
        scene.geotech_model_id, [], grid_spacing_m=1.0, force=True
    )
    db_session.expire_all()


async def test_glh1_the_build_populates_both_null_parent_links(
    scene: _Scene, db_session: AsyncSession
) -> None:
    """GLH1 — the geotech Build re-derives band FKs and stamps body FKs from NULL."""
    # Pre: everything NULL (the bug's state).
    assert await _band_parent(db_session, scene.geo_band_shallow_id) is None
    assert await _band_parent(db_session, scene.geo_band_deep_id) is None
    assert await _body_parent(db_session, scene.geo_body_id) is None

    await _run_geotech_build(db_session, scene)

    # (a) both covered bands take the covering litho band by the midpoint rule.
    assert await _band_parent(db_session, scene.geo_band_shallow_id) == scene.litho_band_id
    assert await _band_parent(db_session, scene.geo_band_deep_id) == scene.litho_band_id
    # (b) the body takes its shallowest covered member's litho BODY.
    assert await _body_parent(db_session, scene.geo_body_id) == scene.litho_body_id


async def test_glh2_a_band_with_no_covering_litho_stays_null(
    scene: _Scene, db_session: AsyncSession
) -> None:
    """GLH2 — an orphan band (midpoint below every litho band) heals to NULL, honestly."""
    await _run_geotech_build(db_session, scene)

    assert await _band_parent(db_session, scene.orphan_band_id) is None
    # Its single-member body has no covered member, so its litho parent is NULL.
    assert await _body_parent(db_session, scene.orphan_body_id) is None


async def test_glh3_a_litho_recompute_does_not_clobber_the_healed_band_links(
    scene: _Scene, db_session: AsyncSession
) -> None:
    """GLH3 — a later LITHO recompute leaves the geotech band FKs intact.

    The litho resolver re-stamps the geotech BODY's parent from the band FKs but
    never writes the band FK itself, so the covering-band links the Build derived
    survive a litho recompute (they self-heal at the next Build regardless).
    """
    await _run_geotech_build(db_session, scene)
    assert await _band_parent(db_session, scene.geo_band_shallow_id) == scene.litho_band_id

    # A litho recompute re-mints/reconciles litho bodies + re-stamps sibling
    # geotech bodies (resolver step 6).
    await ResolveLithoInstances(db_session).execute(model_id=scene.litho_model_id)
    db_session.expire_all()

    # Band FKs untouched by the litho side.
    assert await _band_parent(db_session, scene.geo_band_shallow_id) == scene.litho_band_id
    assert await _band_parent(db_session, scene.geo_band_deep_id) == scene.litho_band_id
    # And the body FK still resolves to the (stable) litho body.
    assert await _body_parent(db_session, scene.geo_body_id) == scene.litho_body_id
