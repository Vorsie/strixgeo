"""Integration tests for the litho-3D solid API endpoints (Task 5, litho-3D).

Coverage
--------
LS-1  GET .../litho-solids returns an empty list when no rebuild has run.
LS-2  POST .../litho-solids/rebuild builds at least one solid for a model
      that has a valid body (3 non-collinear boreholes with accepted layers +
      approved correlation edges).  The rebuilt list contains one row with
      non-empty ``vertices`` and ``triangles`` and ``is_stale=False``.
LS-3  GET .../litho-solids after the rebuild returns the same solid(s) as
      the ``solids`` key in the rebuild response — confirming the DB write.
LS-4  PATCH .../bodies/{body_id}/color persists ``display_color`` and a
      subsequent GET returns the updated colour in the solid response.
LS-5  A flagged body (only 2 picks — cannot form a watertight solid) is
      returned without error: ``is_flagged=True`` and
      ``vertices``/``triangles`` are non-empty (a degenerate slab, not
      empty lists) — the response schema must tolerate this shape without
      FastAPI ResponseValidationError.
LS-6  GET .../litho-solids returns 404 when the model belongs to a
      different project (cross-project IDOR guard).
LS-7  POST .../litho-solids/rebuild returns 404 on wrong-project model.
LS-8  PATCH .../bodies/{body_id}/color returns 404 when body belongs to a
      different project.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Builder helpers (mirror test_recompute_litho_solids.py)
# ---------------------------------------------------------------------------


def _borehole(
    project_id: UUID,
    *,
    suffix: str,
    x: float,
    y: float = 200000.0,
    elev: float = 5.0,
) -> BoreholeOrm:
    """Unsaved borehole with valid coordinates."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-LS-{suffix}",
        app_project_id=project_id,
        project_id="LS",
        test_id=f"BH-LS-{suffix}",
        location_x=x,
        location_y=y,
        elevation_m=elev,
        epsg=31370,
        total_depth_m=20.0,
    )


def _layer(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    top: float,
    base: float,
    status: str = "accepted",
) -> LithoLayerOrm:
    """Unsaved ``LithoLayerOrm`` anchored to *borehole*."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=top,
        depth_base_m=base,
        status=status,
        source="manual",
        confidence="medium",
    )


def _edge(
    model: GeologicalModelOrm,
    layer_a: LithoLayerOrm,
    layer_b: LithoLayerOrm,
    section_id: UUID,
) -> LithoContactCorrelationEdgeOrm:
    """Approved correlation edge between two layers."""
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        section_id=section_id,
        contact_a_id=layer_a.id,
        contact_b_id=layer_b.id,
        source="manual",
        user_approved=True,
    )


async def _seed_section(db_session: AsyncSession, project_id: UUID) -> UUID:
    """Insert a minimal cross-section row and return its id."""
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

    sec = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="S-LS",
        start_x=149000.0,
        start_y=200000.0,
        end_x=151000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=200.0,
    )
    db_session.add(sec)
    await db_session.flush()
    return sec.id


# ---------------------------------------------------------------------------
# Base scene — project + models + formation (no bodies yet)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> dict:
    """Project + geo + litho model + one formation.

    Returns keys: project, geo, litho, formation.
    """
    proj = ProjectOrm(id=uuid7(), name="LS-API test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo-LS", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho-LS",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND-LS",
        color="#f5deb3",
        display_order=0,
    )
    db_session.add(formation)
    await db_session.commit()

    return {"project": proj, "geo": geo, "litho": litho, "formation": formation}


# ---------------------------------------------------------------------------
# Scene with a valid 3-borehole body (can form a real solid)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def solid_scene(db_session: AsyncSession, scene: dict) -> dict:
    """Extends ``scene`` with 3 non-collinear boreholes + accepted layers +
    approved correlation edges so ``RecomputeLithoSolids`` produces one
    real (non-flagged) solid.

    Returns the ``scene`` dict extended with keys: bh_a, bh_b, bh_c,
    la, lb, lc, section_id.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    # Non-collinear anchors — y differs so the 3 points are not coplanar
    # in the horizontal projection → compute_tin produces a real surface.
    bh_a = _borehole(proj.id, suffix="A", x=150000.0, y=200000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="B", x=150200.0, y=200000.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="C", x=150100.0, y=200080.0, elev=5.2)
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])
    await db_session.commit()

    return {**scene, "bh_a": bh_a, "bh_b": bh_b, "bh_c": bh_c, "la": la, "lb": lb, "lc": lc}


# ---------------------------------------------------------------------------
# Scene with an under-constrained 2-borehole body (flagged slab)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def flagged_scene(db_session: AsyncSession, scene: dict) -> dict:
    """Extends ``scene`` with 2 boreholes + accepted layers + one edge.

    A 2-pick body cannot form a valid TIN; the builder emits a flagged
    slab (``is_flagged=True``).  Tests that the API does not blow up on
    this shape (ResponseValidationError trap).
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    bh_a = _borehole(proj.id, suffix="F1", x=150000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="F2", x=150200.0, elev=4.8)
    db_session.add_all([bh_a, bh_b])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    db_session.add_all([la, lb])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    db_session.add(edge_ab)
    await db_session.commit()

    return {**scene, "bh_a": bh_a, "bh_b": bh_b}


# ---------------------------------------------------------------------------
# LS-1: empty list before rebuild
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_litho_solids_empty_before_rebuild(
    async_client: AsyncClient,
    scene: dict,
) -> None:
    """GET .../litho-solids must return an empty list when no rebuild has run."""
    proj = scene["project"]
    litho = scene["litho"]

    resp = await async_client.get(f"/projects/{proj.id}/geology/models/{litho.id}/litho-solids")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


# ---------------------------------------------------------------------------
# LS-2: rebuild produces at least one solid with geometry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rebuild_produces_solid_with_geometry(
    async_client: AsyncClient,
    solid_scene: dict,
) -> None:
    """POST .../litho-solids/rebuild must return ≥1 solid with non-empty
    vertices + triangles and ``is_stale=False`` for a valid 3-borehole body.
    """
    proj = solid_scene["project"]
    litho = solid_scene["litho"]

    resp = await async_client.post(
        f"/projects/{proj.id}/geology/models/{litho.id}/litho-solids/rebuild"
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["bodies_considered"] >= 1
    assert data["bodies_built"] >= 1
    assert data["bodies_flagged"] == 0, "3 non-collinear boreholes must produce a non-flagged solid"

    solids = data["solids"]
    assert len(solids) >= 1, "At least one solid must be in the response"

    solid = solids[0]
    assert solid["is_stale"] is False
    assert solid["is_flagged"] is False
    assert len(solid["vertices"]) > 0
    assert len(solid["triangles"]) > 0


# ---------------------------------------------------------------------------
# LS-3: GET after rebuild returns same solids as rebuild response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_after_rebuild_returns_persisted_solids(
    async_client: AsyncClient,
    solid_scene: dict,
) -> None:
    """GET .../litho-solids after a rebuild must return the same solid(s) that
    the rebuild response included — confirming the DB write persisted.
    """
    proj = solid_scene["project"]
    litho = solid_scene["litho"]
    base = f"/projects/{proj.id}/geology/models/{litho.id}"

    rebuild_resp = await async_client.post(f"{base}/litho-solids/rebuild")
    assert rebuild_resp.status_code == 200, rebuild_resp.text
    rebuild_solids = rebuild_resp.json()["solids"]

    get_resp = await async_client.get(f"{base}/litho-solids")
    assert get_resp.status_code == 200, get_resp.text
    get_solids = get_resp.json()

    # Same ids — order may differ.
    rebuild_ids = {s["id"] for s in rebuild_solids}
    get_ids = {s["id"] for s in get_solids}
    assert rebuild_ids == get_ids, f"Rebuild returned ids {rebuild_ids}; GET returned {get_ids}"


# ---------------------------------------------------------------------------
# LS-4: PATCH .../bodies/{body_id}/color persists and is reflected in GET
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_body_color_persists_and_appears_in_get(
    async_client: AsyncClient,
    solid_scene: dict,
) -> None:
    """PATCH .../bodies/{body_id}/color must persist the colour; a subsequent
    GET .../litho-solids must include the updated ``display_color`` in the
    matching solid response.
    """
    proj = solid_scene["project"]
    litho = solid_scene["litho"]
    base = f"/projects/{proj.id}/geology/models/{litho.id}"

    # Rebuild first so solid rows exist.
    rebuild_resp = await async_client.post(f"{base}/litho-solids/rebuild")
    assert rebuild_resp.status_code == 200, rebuild_resp.text
    solids = rebuild_resp.json()["solids"]
    assert solids, "Precondition: at least one solid must exist after rebuild"

    body_id = solids[0]["body_id"]

    # Patch the colour.
    patch_resp = await async_client.patch(
        f"{base}/bodies/{body_id}/color",
        json={"display_color": "#deadbe"},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    patch_data = patch_resp.json()
    assert patch_data["body_id"] == body_id
    assert patch_data["display_color"] == "#deadbe"

    # GET must reflect the new colour.
    get_resp = await async_client.get(f"{base}/litho-solids")
    assert get_resp.status_code == 200, get_resp.text
    matching = [s for s in get_resp.json() if s["body_id"] == body_id]
    assert matching, "Solid for the patched body must appear in GET response"
    assert matching[0]["display_color"] == "#deadbe", (
        f"Expected display_color='#deadbe'; got {matching[0]['display_color']!r}"
    )

    # Verify reset to null also works.
    reset_resp = await async_client.patch(
        f"{base}/bodies/{body_id}/color",
        json={"display_color": None},
    )
    assert reset_resp.status_code == 200, reset_resp.text
    assert reset_resp.json()["display_color"] is None

    get_after_reset = await async_client.get(f"{base}/litho-solids")
    assert get_after_reset.status_code == 200
    matching_reset = [s for s in get_after_reset.json() if s["body_id"] == body_id]
    assert matching_reset[0]["display_color"] is None


# ---------------------------------------------------------------------------
# LS-5: flagged body does not cause ResponseValidationError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flagged_body_returned_without_error(
    async_client: AsyncClient,
    flagged_scene: dict,
) -> None:
    """POST .../litho-solids/rebuild on a 2-pick body must return 200 with
    ``is_flagged=True`` — not a 500 ResponseValidationError.

    The response schema must tolerate non-empty lists for a flagged slab
    (the builder emits a degenerate slab with vertices + triangles even
    for flagged bodies; the important check is that the endpoint does not
    crash on this shape).
    """
    proj = flagged_scene["project"]
    litho = flagged_scene["litho"]

    resp = await async_client.post(
        f"/projects/{proj.id}/geology/models/{litho.id}/litho-solids/rebuild"
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["bodies_flagged"] >= 1
    solids = data["solids"]
    assert solids, "A flagged solid row must be written"
    assert solids[0]["is_flagged"] is True


# ---------------------------------------------------------------------------
# LS-6 / LS-7 / LS-8: cross-project IDOR guards
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def idor_scene(db_session: AsyncSession) -> dict:
    """Two independent projects.

    project_a: litho model + 3 boreholes + solid body.
    project_b: litho model (empty).

    IDOR tests hit project_a endpoints using project_b's id.
    """
    # ---- project A ---------------------------------------------------------
    proj_a = ProjectOrm(id=uuid7(), name="LS-IDOR-A", status="active")
    db_session.add(proj_a)
    await db_session.flush()

    geo_a = GeologicalModelOrm(id=uuid7(), app_project_id=proj_a.id, name="G-A", kind="geological")
    litho_a = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj_a.id,
        name="L-A",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_a.id,
    )
    db_session.add_all([geo_a, litho_a])
    await db_session.flush()

    formation_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj_a.id,
        name="IDOR-F",
        color="#ccc",
        display_order=0,
    )
    db_session.add(formation_a)
    await db_session.flush()

    section_id = await _seed_section(db_session, proj_a.id)
    bh_a = _borehole(proj_a.id, suffix="IA", x=150000.0, y=200000.0, elev=5.0)
    bh_b = _borehole(proj_a.id, suffix="IB", x=150200.0, y=200000.0, elev=4.8)
    bh_c = _borehole(proj_a.id, suffix="IC", x=150100.0, y=200080.0, elev=5.2)
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.flush()

    la = _layer(litho_a, formation_a, bh_a, top=2.0, base=5.0)
    lb = _layer(litho_a, formation_a, bh_b, top=2.1, base=5.1)
    lc = _layer(litho_a, formation_a, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    edge_ab = _edge(litho_a, la, lb, section_id)
    edge_bc = _edge(litho_a, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])

    # ---- project B ---------------------------------------------------------
    proj_b = ProjectOrm(id=uuid7(), name="LS-IDOR-B", status="active")
    db_session.add(proj_b)
    await db_session.flush()

    geo_b = GeologicalModelOrm(id=uuid7(), app_project_id=proj_b.id, name="G-B", kind="geological")
    litho_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj_b.id,
        name="L-B",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_b.id,
    )
    db_session.add_all([geo_b, litho_b])
    await db_session.commit()

    return {
        "proj_a": proj_a,
        "litho_a": litho_a,
        "proj_b": proj_b,
        "litho_b": litho_b,
        "bh_a": bh_a,
    }


@pytest.mark.asyncio
async def test_get_litho_solids_wrong_project_returns_404(
    async_client: AsyncClient,
    idor_scene: dict,
) -> None:
    """LS-6: GET .../litho-solids with mismatched project_id must return 404."""
    proj_b = idor_scene["proj_b"]
    litho_a = idor_scene["litho_a"]

    resp = await async_client.get(f"/projects/{proj_b.id}/geology/models/{litho_a.id}/litho-solids")
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_rebuild_litho_solids_wrong_project_returns_404(
    async_client: AsyncClient,
    idor_scene: dict,
) -> None:
    """LS-7: POST .../litho-solids/rebuild with mismatched project_id must return 404."""
    proj_b = idor_scene["proj_b"]
    litho_a = idor_scene["litho_a"]

    resp = await async_client.post(
        f"/projects/{proj_b.id}/geology/models/{litho_a.id}/litho-solids/rebuild"
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_patch_body_color_wrong_project_returns_404(
    async_client: AsyncClient,
    idor_scene: dict,
) -> None:
    """LS-8: PATCH .../bodies/{body_id}/color with mismatched project_id must return 404.

    First rebuild in project_a to materialise a body row, then attempt the
    PATCH using project_b's id in the URL.
    """
    proj_a = idor_scene["proj_a"]
    proj_b = idor_scene["proj_b"]
    litho_a = idor_scene["litho_a"]

    # Build a solid in project_a so a body row exists.
    rebuild_resp = await async_client.post(
        f"/projects/{proj_a.id}/geology/models/{litho_a.id}/litho-solids/rebuild"
    )
    assert rebuild_resp.status_code == 200, rebuild_resp.text
    solids = rebuild_resp.json()["solids"]
    assert solids, "Precondition: rebuild must produce at least one solid"
    body_id = solids[0]["body_id"]

    # PATCH using project_b's id — must be 404, not 200.
    patch_resp = await async_client.patch(
        f"/projects/{proj_b.id}/geology/models/{litho_a.id}/bodies/{body_id}/color",
        json={"display_color": "#evil01"},
    )
    assert patch_resp.status_code == 404, patch_resp.text
