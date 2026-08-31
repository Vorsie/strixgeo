"""HTTP-level tests for the body extent endpoints.

Coverage:
  S4  Cross-project IDOR regression tests — every body endpoint returns 404
      (not 200 or 403) when the URL's project_id / model_id belongs to a
      different project than the body / model being addressed.

  A2  GET /bodies derives each body's geological label by thickness majority.

These tests assert routing + error-mapping only.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def bodies_api_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm, BoreholeOrm, BoreholeOrm]:
    """Minimal project + lithostratigraphic model + formation + two boreholes."""
    project = ProjectOrm(id=uuid7(), name="Bodies API test", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-API",
        kind="geological",
    )
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-API",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI-API",
        color="#aabbcc",
        display_order=0,
        instance_ordinal=0,
    )
    db_session.add(formation)
    await db_session.flush()

    bh_source = BoreholeOrm(
        id=uuid7(),
        name="BH-SRC",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-SRC-API",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    bh_neighbour = BoreholeOrm(
        id=uuid7(),
        name="BH-NBR",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-NBR-API",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_source, bh_neighbour])
    await db_session.commit()
    return project, litho, formation, bh_source, bh_neighbour


# ---------------------------------------------------------------------------
# S4: Cross-project IDOR regression tests
# ---------------------------------------------------------------------------
# Pattern: project A owns a model + body; requests use project B's id in
# the URL path.  Every endpoint must return 404, not 200 or 403.
# 404 is the correct response (the existing pattern — avoids leaking
# existence information to the caller).
# ---------------------------------------------------------------------------


import pytest  # noqa: E402  (after fixture import so ruff is happy)


@pytest_asyncio.fixture
async def idor_fixture(
    db_session: AsyncSession,
) -> dict:
    """Two independent projects, each with a lithostratigraphic model.

    project_a owns:
      - model_a (lithostratigraphic)
      - formation_a
      - bh_a (source investigation)
      - bh_a_neighbour
      - body_a (formation_a, ordinal=0, extent_left=to_target → bh_a_neighbour)

    project_b owns:
      - model_b (lithostratigraphic, geological parent model_b_geo)

    The IDOR tests hit project_a endpoints using project_b's id (and
    vice-versa where noted) — the scope guards must reject all of them.
    """
    # ---- project A ---------------------------------------------------------
    project_a = ProjectOrm(id=uuid7(), name="IDOR-project-A", status="active")
    db_session.add(project_a)
    await db_session.flush()

    geo_a = GeologicalModelOrm(
        id=uuid7(), app_project_id=project_a.id, name="Geo-A", kind="geological"
    )
    model_a = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_a.id,
        name="Litho-A",
        kind="lithostratigraphic",
        parent_model_id=geo_a.id,
    )
    db_session.add_all([geo_a, model_a])
    await db_session.flush()

    formation_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_a.id,
        name="KLEI-A",
        color="#aabbcc",
        display_order=0,
        instance_ordinal=0,
    )
    db_session.add(formation_a)
    await db_session.flush()

    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-A-SRC",
        app_project_id=project_a.id,
        project_id="IDOR",
        test_id="BH-A-SRC-IDOR",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    bh_a_neighbour = BoreholeOrm(
        id=uuid7(),
        name="BH-A-NBR",
        app_project_id=project_a.id,
        project_id="IDOR",
        test_id="BH-A-NBR-IDOR",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_a, bh_a_neighbour])
    await db_session.flush()

    body_a = BodyOrm(
        id=uuid7(),
        app_project_id=project_a.id,
        model_id=model_a.id,
        formation_id=formation_a.id,
        body_ordinal=0,
        source_investigation_id=bh_a.id,
    )
    db_session.add(body_a)

    # ---- project B (only needs its own lithostratigraphic model) -----------
    project_b = ProjectOrm(id=uuid7(), name="IDOR-project-B", status="active")
    db_session.add(project_b)
    await db_session.flush()

    geo_b = GeologicalModelOrm(
        id=uuid7(), app_project_id=project_b.id, name="Geo-B", kind="geological"
    )
    model_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_b.id,
        name="Litho-B",
        kind="lithostratigraphic",
        parent_model_id=geo_b.id,
    )
    db_session.add_all([geo_b, model_b])

    await db_session.commit()

    return {
        "project_a": project_a,
        "project_b": project_b,
        "model_a": model_a,
        "model_b": model_b,
        "formation_a": formation_a,
        "bh_a": bh_a,
        "bh_a_neighbour": bh_a_neighbour,
        "body_a": body_a,
    }


@pytest.mark.asyncio
async def test_idor_list_bodies_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: GET /projects/{B}/geology/models/{A-model}/bodies → 404."""
    f = idor_fixture
    resp = await async_client.get(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on list bodies: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_patch_body_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: PATCH /projects/{B}/geology/models/{A-model}/bodies/{A-body} → 404.

    NameBodyRequest requires ``formation_id`` + ``name`` — we supply both so
    Pydantic passes and the real scope guard (body.app_project_id != project_b)
    is actually exercised.
    """
    f = idor_fixture
    resp = await async_client.patch(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies/{f['body_a'].id}",
        json={
            "formation_id": str(f["formation_a"].id),
            "name": "attempted rename",
        },
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on PATCH body: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_delete_body_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: DELETE /projects/{B}/geology/models/{A-model}/bodies/{A-body} → 404."""
    f = idor_fixture
    resp = await async_client.delete(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies/{f['body_a'].id}"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on DELETE body: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_get_body_boundary_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: GET /projects/{B}/geology/models/{A-model}/bodies/{A-body}/boundary → 404."""
    f = idor_fixture
    resp = await async_client.get(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}"
        f"/bodies/{f['body_a'].id}/boundary"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on GET boundary: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_put_body_boundary_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: PUT /projects/{B}/geology/models/{A-model}/bodies/{A-body}/boundary → 404."""
    f = idor_fixture
    resp = await async_client.put(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}"
        f"/bodies/{f['body_a'].id}/boundary",
        json={"upper_nodes": [], "lower_nodes": [], "render_style": "straight"},
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on PUT boundary: expected 404, got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# A2: GET /bodies derives each body's geological label by thickness majority.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_bodies_derives_majority_geo_label(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """A2: ``GET /bodies`` labels each body with its majority geological formation.

    The geological model tops Quartair at 0 m and Pleistoceen at 8 m. A ZAND
    body whose member straddles that boundary with its midpoint below it is
    labelled Pleistoceen — derived fresh from the body membership + the geo
    contacts, never stored. This pins the endpoint wiring (the unit tests cover
    the majority maths).
    """
    project, litho, _litho_formation, bh, _nbr = bodies_api_fixture
    geo_model_id = litho.parent_model_id

    quartair = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="Quartair", color="#ffcc00", display_order=0
    )
    pleistocene = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="Pleistoceen", color="#cc8800", display_order=1
    )
    db_session.add_all([quartair, pleistocene])
    await db_session.flush()
    db_session.add_all(
        [
            FormationContactOrm(
                id=uuid7(),
                model_id=geo_model_id,
                formation_id=quartair.id,
                borehole_id=bh.id,
                depth_top_m=0.0,
                source="manual_pick",
                confidence="high",
            ),
            FormationContactOrm(
                id=uuid7(),
                model_id=geo_model_id,
                formation_id=pleistocene.id,
                borehole_id=bh.id,
                depth_top_m=8.0,
                source="manual_pick",
                confidence="high",
            ),
        ]
    )

    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND",
        color="#fbbf24",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    db_session.add(sand)
    await db_session.flush()
    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=sand.id,
        body_ordinal=0,
        source_investigation_id=bh.id,
    )
    db_session.add(body)
    await db_session.flush()
    # Single member straddling the 8 m boundary; midpoint 11 m → Pleistoceen.
    db_session.add(
        LithoLayerOrm(
            id=uuid7(),
            model_id=litho.id,
            formation_id=sand.id,
            borehole_id=bh.id,
            depth_top_m=6.0,
            depth_base_m=16.0,
            status="accepted",
            source="segmenter",
            body_id=body.id,
        )
    )
    await db_session.commit()

    resp = await async_client.get(f"/projects/{project.id}/geology/models/{litho.id}/bodies")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    assert items[0]["geo_formation_id"] == str(pleistocene.id)
    assert items[0]["geo_formation_name"] == "Pleistoceen"


@pytest.mark.asyncio
async def test_list_bodies_lists_every_geo_formation_a_body_crosses(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """R2: a body crossing two geological formations answers BOTH, shallowest first.

    Owner ruling 2026-08-31: a body may span geological-formation boundaries, so
    its geological attribution is a LIST — every formation it falls in, shallowest
    first — not just the majority stamp. The body has a shallow, thin member in
    Quartair at one borehole and a deeper, thicker member in Pleistoceen at
    another. The response lists [Quartair, Pleistoceen], AND the additive singular
    fields still carry the thickness-majority winner (Pleistoceen).

    Geometry note: the litho column is kept gap-free by triggers that snap a
    non-last layer's base to the next layer's top and extend a lone layer's base
    to the borehole's total depth. To keep the thickness deterministic (and to
    avoid a same-borehole second layer losing its ``body_id`` to the resolver),
    each member is the ONLY layer in its own borehole, with its base already at
    that borehole's total depth. A shallow 5 m Quartair borehole and a deep 20 m
    Pleistoceen borehole therefore make Pleistoceen the genuine thickness winner.
    """
    project, litho, _litho_formation, _bh, _nbr = bodies_api_fixture
    geo_model_id = litho.parent_model_id

    # Two purpose-built boreholes with controlled total depths — see the note.
    bh_q = BoreholeOrm(
        id=uuid7(),
        name="BH-Q",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-Q-API",
        location_x=150600.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=5.0,
    )
    bh_p = BoreholeOrm(
        id=uuid7(),
        name="BH-P",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-P-API",
        location_x=150900.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_q, bh_p])
    await db_session.flush()

    quartair = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="Quartair", color="#ffcc00", display_order=0
    )
    pleistocene = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="Pleistoceen", color="#cc8800", display_order=1
    )
    db_session.add_all([quartair, pleistocene])
    await db_session.flush()
    # bh_q is all Quartair; bh_p is all Pleistoceen (the body spans the boundary).
    db_session.add_all(
        [
            FormationContactOrm(
                id=uuid7(),
                model_id=geo_model_id,
                formation_id=quartair.id,
                borehole_id=bh_q.id,
                depth_top_m=0.0,
                source="manual_pick",
                confidence="high",
            ),
            FormationContactOrm(
                id=uuid7(),
                model_id=geo_model_id,
                formation_id=pleistocene.id,
                borehole_id=bh_p.id,
                depth_top_m=0.0,
                source="manual_pick",
                confidence="high",
            ),
        ]
    )

    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND",
        color="#fbbf24",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    db_session.add(sand)
    await db_session.flush()
    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=sand.id,
        body_ordinal=0,
        source_investigation_id=bh_q.id,
    )
    db_session.add(body)
    await db_session.flush()
    db_session.add_all(
        [
            # Shallow, thin Quartair member (0..5 m → mid 2.5 m, thickness 5).
            LithoLayerOrm(
                id=uuid7(),
                model_id=litho.id,
                formation_id=sand.id,
                borehole_id=bh_q.id,
                depth_top_m=0.0,
                depth_base_m=5.0,
                status="accepted",
                source="segmenter",
                body_id=body.id,
            ),
            # Deeper, thicker Pleistoceen member (8..20 m → mid 14 m, thickness 12).
            LithoLayerOrm(
                id=uuid7(),
                model_id=litho.id,
                formation_id=sand.id,
                borehole_id=bh_p.id,
                depth_top_m=8.0,
                depth_base_m=20.0,
                status="accepted",
                source="segmenter",
                body_id=body.id,
            ),
        ]
    )
    await db_session.commit()

    resp = await async_client.get(f"/projects/{project.id}/geology/models/{litho.id}/bodies")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    item = items[0]
    # Both crossed formations, shallowest first (Quartair at 0 m, then Pleistoceen).
    assert [g["name"] for g in item["geo_formations"]] == ["Quartair", "Pleistoceen"]
    assert [g["id"] for g in item["geo_formations"]] == [str(quartair.id), str(pleistocene.id)]
    # The additive singular fields still carry the thickness-majority winner.
    assert item["geo_formation_id"] == str(pleistocene.id)
    assert item["geo_formation_name"] == "Pleistoceen"
