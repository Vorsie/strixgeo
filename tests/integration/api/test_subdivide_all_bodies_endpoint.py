"""Integration tests for POST .../geotech/subdivide-all-bodies (Task E4).

Exercises the ``SubdivideAllBodies`` endpoint end-to-end over HTTP against
PostgreSQL.  The scene mirrors ``test_geotech_endpoints.py`` exactly (geo +
litho model, ZAND accepted contact, CPT with dense-sand qc, section corridor).

SAB-IT-1  Happy path — build skeleton first, then subdivide-all-bodies →
          200 + geotech_model_id returned + non-zero layer_count.

SAB-IT-2  Kind guard — POST subdivide-all-bodies with a GEOLOGICAL model id
          (not lithostratigraphic) → 422 with ``code='invalid_model_kind'``.

SAB-IT-3  Kind guard — POST subdivide-all-bodies with the GEOTECH model id
          (not lithostratigraphic) → 422 with ``code='invalid_model_kind'``.

SAB-IT-4  Scope guard — model from a different project → 404.

SAB-IT-5  Idempotency — two consecutive subdivide-all-bodies calls return the
          same geotech_model_id and a non-zero layer_count on both runs.

Run via the wrapper:
    .\\scripts\\run-integration-tests.ps1 `
        tests/integration/api/test_subdivide_all_bodies_endpoint.py
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Scene fixture — project + geo model + litho model + ZAND formation
#                  + CPT with qc series + section
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for subdivide-all-bodies endpoint tests."""
    proj = ProjectOrm(id=uuid7(), name="subdivide all bodies endpoint test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def scene(
    db_session: AsyncSession,
    project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Full scene: geo + litho model, ZAND accepted contact, CPT with
    dense-sand qc (NAD class ~7), and a section corridor covering the CPT.

    Returns
    -------
    dict
        Keys: ``project``, ``geo_model_id``, ``litho_model_id``,
        ``cpt_id``, ``section_id``.
    """
    # --- geo model ---
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    # --- litho model ---
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # --- CPT with a dense-sand qc series (NAD class ~7) ---
    # Location at (150 000, 200 000) Lambert-72; the section below is a
    # horizontal E-W line covering this x-range with a 60 m buffer so the
    # CPT falls inside the section corridor.
    depths: list[float] = [round(z * 0.05, 2) for z in range(200)]  # 0..9.95 m
    qc: list[float] = [22.0] * len(depths)  # dense sand throughout
    fs: list[float] = [0.12] * len(depths)

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-SAB",
        cpt_type="CPTU",
        project_id="SAB",
        test_id="SAB/001",
        app_project_id=project.id,
        location_x=150_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=fs,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    db_session.add(cpt)
    # Commit before the API calls — each endpoint call runs in its own DI
    # session and cannot see unflushed rows from this test session.
    await db_session.commit()

    # --- accepted litho contact on the CPT (spans 0–10 m) ---
    accept_resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
        json={
            "cpt_id": str(cpt.id),
            "suggestions": [
                {
                    "depth_top_m": 0.0,
                    "depth_base_m": 10.0,
                    "suggested_lithology": "ZAND",
                    "confidence": "high",
                    "source": "robertson_2015",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert accept_resp.status_code == 200, accept_resp.text

    # --- section covering the CPT location ---
    sec_resp = await async_client.post(
        f"/projects/{project.id}/sections",
        json={
            "name": "S1",
            "start_x": 149_900.0,
            "start_y": 200_000.0,
            "end_x": 150_100.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    await db_session.commit()

    return {
        "project": project,
        "geo_model_id": geo_model_id,
        "litho_model_id": litho_model_id,
        "cpt_id": str(cpt.id),
        "section_id": section_id,
    }


# ---------------------------------------------------------------------------
# SAB-IT-1  Happy path — build skeleton + subdivide-all-bodies round-trip
# ---------------------------------------------------------------------------


async def test_sab_it1_subdivide_all_bodies_happy_path(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """SAB-IT-1: subdivide-all-bodies → 200 + non-zero layer_count."""
    pid = project.id
    litho_id = scene["litho_model_id"]

    # Subdivide all bodies — the use case ensures the geotech sibling model
    # itself (find-or-create), no prior build step exists since #237.2.
    sab_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": litho_id},
    )
    assert sab_resp.status_code == 200, sab_resp.text
    body = sab_resp.json()

    geotech_model_id = body["geotech_model_id"]
    assert geotech_model_id, "subdivide-all-bodies must return a geotech_model_id"
    assert isinstance(body["created_formation_ids"], list)
    assert isinstance(body["layer_count"], int)
    assert body["layer_count"] >= 1, (
        "subdivide-all-bodies must materialise at least one geotech layer for the dense-sand CPT"
    )
    assert isinstance(body["body_count"], int)
    assert isinstance(body["split_body_count"], int)
    assert isinstance(body["one_class_body_count"], int)
    assert isinstance(body["borehole_only_count"], int)
    # The single-CPT scene has no boreholes, so borehole_only_count must be 0.
    assert body["borehole_only_count"] == 0, (
        "Scene has no boreholes — borehole_only_count must be 0"
    )
    # The tie-review breakdown must survive the API boundary: the frontend's
    # "N accepted packing ties need checking" warning reads it off the HTTP
    # response, and the use-case-level gates cannot see a dropped field.
    assert isinstance(body["review_tie_reasons"], dict), (
        "review_tie_reasons must reach the client — the post-Subdivide review "
        "warning is computed from it and is silently dead without it"
    )
    assert isinstance(body["lost_tie_reasons"], dict)


# ---------------------------------------------------------------------------
# SAB-IT-2  Kind guard: geological model id on subdivide-all-bodies → 422
# ---------------------------------------------------------------------------


async def test_sab_it2_kind_guard_rejects_geological_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """SAB-IT-2: POST subdivide-all-bodies with a geological model id → 422."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{scene['geo_model_id']}"
        "/geotech/subdivide-all-bodies",
        json={"litho_model_id": scene["geo_model_id"]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "invalid_model_kind"


# ---------------------------------------------------------------------------
# SAB-IT-3  Kind guard: geotech model id on subdivide-all-bodies → 422
# ---------------------------------------------------------------------------


async def test_sab_it3_kind_guard_rejects_geotech_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """SAB-IT-3: POST subdivide-all-bodies with the geotech model id → 422."""
    pid = project.id
    litho_id = scene["litho_model_id"]

    # Run subdivide-all-bodies once to obtain the geotech model id (the use
    # case find-or-creates the geotech sibling model itself).
    first_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": litho_id},
    )
    assert first_resp.status_code == 200, first_resp.text
    geotech_model_id = first_resp.json()["geotech_model_id"]

    # Now pass the GEOTECH model id to subdivide-all-bodies — must reject.
    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": geotech_model_id},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "invalid_model_kind"


# ---------------------------------------------------------------------------
# SAB-IT-4  Scope guard: model from a different project → 404
# ---------------------------------------------------------------------------


async def test_sab_it4_scope_guard_rejects_foreign_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
    db_session: AsyncSession,
) -> None:
    """SAB-IT-4: subdivide-all-bodies with a model from a different project → 404."""
    # Create a second project + litho model in a different project.
    other_proj = ProjectOrm(id=uuid7(), name="other project sab", status="active")
    db_session.add(other_proj)
    await db_session.flush()

    other_geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=other_proj.id,
        name="OtherGeo",
        kind="geological",
    )
    other_litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=other_proj.id,
        name="OtherLitho",
        kind="lithostratigraphic",
        parent_model_id=other_geo.id,
    )
    db_session.add_all([other_geo, other_litho])
    await db_session.commit()

    # Use the OTHER project's litho model id with the CURRENT project's project_id.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{other_litho.id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": str(other_litho.id)},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# SAB-IT-5  Idempotency — two calls return the same geotech_model_id
# ---------------------------------------------------------------------------


async def test_sab_it5_idempotent_reruns(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """SAB-IT-5: a second subdivide-all-bodies call reuses the same geotech model."""
    pid = project.id
    litho_id = scene["litho_model_id"]

    # First call.
    resp1 = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": litho_id},
    )
    assert resp1.status_code == 200, resp1.text
    body1 = resp1.json()

    # Second call.
    resp2 = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": litho_id},
    )
    assert resp2.status_code == 200, resp2.text
    body2 = resp2.json()

    assert body1["geotech_model_id"] == body2["geotech_model_id"], (
        "Idempotent re-run must reuse the same geotech model"
    )
    assert body2["layer_count"] >= 1, "Re-run must still materialise layers"


# ---------------------------------------------------------------------------
# SAB-IT-6  Full HTTP save/reopen — a subdivided project survives GET /bundle
#            + POST /restore with its geotech body grouping intact
# ---------------------------------------------------------------------------


async def test_sab_it6_subdivided_project_survives_save_and_reopen(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
    db_session: AsyncSession,
) -> None:
    """SAB-IT-6: a subdivided project reopens intact over the REAL HTTP path.

    Drives the whole save/reopen pipeline through the actual endpoints —
    subdivide-all-bodies → GET /bundle → POST /restore?replace=true — and asserts
    every geotech ``litho_layer.body_id`` survives. This is the faithful
    end-to-end counterpart to the DB-level reconcile test: it proves GET /bundle
    can serialise a subdivided geotech project (geotech emits Shape-A contacts=[])
    and that the restore endpoint's post-restore reconcile re-stamps geotech bodies.
    """
    pid = project.id
    litho_id = scene["litho_model_id"]

    sab_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_id}/geotech/subdivide-all-bodies",
        json={"litho_model_id": litho_id},
    )
    assert sab_resp.status_code == 200, sab_resp.text
    geotech_model_id = sab_resp.json()["geotech_model_id"]

    async def _geotech_body_ids() -> list:
        await db_session.rollback()  # drop any snapshot; read the API sessions' commits
        return list(
            (
                await db_session.execute(
                    select(LithoLayerOrm.body_id).where(LithoLayerOrm.model_id == geotech_model_id)
                )
            )
            .scalars()
            .all()
        )

    before = await _geotech_body_ids()
    assert before and all(b is not None for b in before), (
        "precondition: geotech layers must be body_id-stamped after subdivide"
    )

    # Save: GET /bundle must serialise the subdivided geotech project (no 500).
    bundle_resp = await async_client.get(f"/projects/{pid}/bundle")
    assert bundle_resp.status_code == 200, (
        f"GET /bundle on a subdivided project failed: {bundle_resp.status_code} {bundle_resp.text}"
    )
    bundle = bundle_resp.json()

    # Reopen: POST /restore (replace) must round-trip + reconcile geotech bodies.
    restore_resp = await async_client.post(f"/projects/{pid}/restore?replace=true", json=bundle)
    assert restore_resp.status_code == 200, (
        f"POST /restore failed: {restore_resp.status_code} {restore_resp.text}"
    )

    after = await _geotech_body_ids()
    assert after, "geotech layers must exist after reopen"
    assert all(b is not None for b in after), (
        "geotech litho_layer.body_id must survive a real GET /bundle + POST /restore "
        "round-trip — the restore endpoint must re-stamp geotech bodies, not only litho"
    )
