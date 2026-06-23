"""Integration tests for the geotech subdivision API endpoints (Slice 1, Task C3).

Exercises the three geotech endpoints end-to-end over HTTP against PostgreSQL:

GT-1  Happy path — POST build → 200 + geotech_model_id returned; POST suggest →
      200 + investigation list with ghost sub-units; POST accept (fed back the
      suggest response) → 200 + created formation/contact ids.

GT-2  Kind guard on suggest: POST suggest with the LITHO model id (non-geotech)
      → 422 with ``code='invalid_model_kind'``.

GT-3  Kind guard on accept: POST accept with the LITHO model id (non-geotech)
      → 422 with ``code='invalid_model_kind'``.

GT-4  Kind guard on build: POST build with the GEOTECH model id (non-litho)
      → 422 with ``code='invalid_model_kind'``.

GT-5  Scope guard on build: a model id from a different project → 404.

Run via the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_geotech_endpoints.py
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Scene fixture — project + geo model + litho model + ZAND formation
#                  + CPT with qc series + section
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for geotech endpoint tests."""
    proj = ProjectOrm(id=uuid7(), name="geotech endpoint test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def scene(
    db_session: AsyncSession,
    project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Full scene: geo + litho model, ZAND formation + accepted contact,
    CPT with dense-sand qc, and a section corridor covering the CPT.

    Returns
    -------
    dict
        Keys: ``project``, ``geo_model_id``, ``litho_model_id``,
        ``formation_id``, ``cpt_id``, ``section_id``.
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
            "parent_geological_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # --- CPT with a dense-sand qc series (NAD class ~7) ---
    # Location at (150 000, 200 000) Lambert-72.  The section below is a
    # horizontal E-W line covering this x-range with a 60 m buffer, so the CPT
    # falls inside the section corridor.
    depths: list[float] = [round(z * 0.05, 2) for z in range(200)]  # 0..9.95 m
    qc: list[float] = [22.0] * len(depths)  # dense sand throughout
    fs: list[float] = [0.12] * len(depths)

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-GT",
        cpt_type="CPTU",
        project_id="GT",
        test_id="GT/001",
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
    # Commit the CPT now: the litho-accept endpoint below runs in its OWN DI
    # session (separate transaction), so it cannot see rows that are merely
    # flushed-not-committed on this test session. The integration harness
    # truncates tables for isolation, so a mid-fixture commit is safe.
    await db_session.commit()

    # --- accepted litho contact on the CPT (spans 0–10 m) ---
    # Use the suggest/accept litho flow via the API so the litho model has a real
    # accepted FormationContact that BuildGeotechModelFromLitho can pick up via
    # load_body_picks (body_id stamped by ResolveLithoInstances). The ZAND litho
    # formation is CREATED by this accept (find-or-create on litho_main_soil_code);
    # we do NOT pre-create it here, or accept would FIND it and return an empty
    # created_formation_ids list.
    accept_resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model_id}/contacts/accept-litho-suggestions",
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
    formation_id = accept_resp.json()["created_formation_ids"][0]

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
        "formation_id": formation_id,
        "cpt_id": str(cpt.id),
        "section_id": section_id,
    }


# ---------------------------------------------------------------------------
# GT-1  Happy path — build → suggest → accept round-trip
# ---------------------------------------------------------------------------


async def test_gt1_build_suggest_accept_roundtrip(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """GT-1: full geotech round-trip produces expected response shapes."""
    pid = project.id
    litho_id = scene["litho_model_id"]
    section_id = scene["section_id"]

    # --- Step 1: build the geotech skeleton ---
    build_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_id}/geotech/build",
        json={"section_id": section_id},
    )
    assert build_resp.status_code == 200, build_resp.text
    build_body = build_resp.json()

    # The response must carry a geotech model id and at least one contact.
    geotech_model_id = build_body["geotech_model_id"]
    assert geotech_model_id, "Expected a geotech_model_id in the build response"
    assert isinstance(build_body["created_model"], bool)
    assert isinstance(build_body["created_formation_ids"], list)
    assert isinstance(build_body["created_contact_ids"], list)
    assert len(build_body["created_contact_ids"]) >= 1, (
        "Build must create at least one geotech skeleton contact"
    )

    # --- Step 2: suggest NAD sub-units ---
    suggest_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/geotech/suggest",
        json={"section_id": section_id},
    )
    assert suggest_resp.status_code == 200, suggest_resp.text
    inv_suggestions = suggest_resp.json()

    # At least one investigation with at least one segment containing ghost sub-units.
    assert len(inv_suggestions) >= 1, "Expected at least one investigation suggestion"
    first_inv = inv_suggestions[0]
    assert "investigation_id" in first_inv
    assert "is_cpt" in first_inv
    assert "segments" in first_inv
    assert len(first_inv["segments"]) >= 1
    first_seg = first_inv["segments"][0]
    assert len(first_seg["ghost_sub_units"]) >= 1

    # CPT investigations should yield ghost sub-units with a nad_class assigned
    # (dense-sand qc=22 MPa → NAD class should be non-null).
    if first_inv["is_cpt"]:
        assert first_seg["ghost_sub_units"][0]["nad_class"] is not None, (
            "Dense-sand CPT should yield a non-null nad_class suggestion"
        )

    # --- Step 3: accept — feed the suggest response back ---
    # Build the accept payload from the suggest response (full accept of all
    # suggested sub-units for every investigation / segment).
    segments_payload: list[dict] = []
    for inv in inv_suggestions:
        inv_id = inv["investigation_id"]
        for seg in inv["segments"]:
            sub_units = [
                {
                    "investigation_id": inv_id,
                    "depth_top_m": sub["depth_top_m"],
                    "depth_base_m": sub["depth_base_m"],
                    "nad_class": sub["nad_class"],
                    "source_litho_formation_id": sub["source_litho_formation_id"],
                    "source_geo_formation_id": sub["source_geo_formation_id"],
                }
                for sub in seg["ghost_sub_units"]
            ]
            segments_payload.append(
                {
                    "investigation_id": inv_id,
                    "segment_top_m": seg["segment_top_m"],
                    "segment_base_m": seg["segment_base_m"],
                    "sub_units": sub_units,
                }
            )

    accept_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/contacts/accept-geotech-suggestions",
        json={"section_id": section_id, "segments": segments_payload},
    )
    assert accept_resp.status_code == 200, accept_resp.text
    accept_body = accept_resp.json()

    assert isinstance(accept_body["created_formation_ids"], list)
    assert isinstance(accept_body["created_contact_ids"], list)
    assert isinstance(accept_body["deleted_skeleton_ids"], list)
    # At least one classified formation and one contact must have been created.
    assert len(accept_body["created_contact_ids"]) >= 1, (
        "Accept must create at least one geotech contact"
    )


# ---------------------------------------------------------------------------
# GT-2  Kind guard on suggest: non-geotech model → 422
# ---------------------------------------------------------------------------


async def test_gt2_suggest_rejects_non_geotech_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """GT-2: POST suggest with the litho model id (not geotechnical) → 422."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{scene['litho_model_id']}/geotech/suggest",
        json={"section_id": scene["section_id"]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "invalid_model_kind"


# ---------------------------------------------------------------------------
# GT-3  Kind guard on accept: non-geotech model → 422
# ---------------------------------------------------------------------------


async def test_gt3_accept_rejects_non_geotech_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """GT-3: POST accept with the litho model id (not geotechnical) → 422."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{scene['litho_model_id']}"
        "/contacts/accept-geotech-suggestions",
        json={"section_id": scene["section_id"], "segments": []},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "invalid_model_kind"


# ---------------------------------------------------------------------------
# GT-4  Kind guard on build: geotech model id on the build endpoint → 422
# ---------------------------------------------------------------------------


async def test_gt4_build_rejects_non_litho_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
) -> None:
    """GT-4: POST build with a geological model id (not lithostratigraphic) → 422."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{scene['geo_model_id']}/geotech/build",
        json={"section_id": scene["section_id"]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "invalid_model_kind"


# ---------------------------------------------------------------------------
# GT-5  Scope guard: model from a different project → 404
# ---------------------------------------------------------------------------


async def test_gt5_build_scope_guard_rejects_foreign_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    scene: dict,
    db_session: AsyncSession,
) -> None:
    """GT-5: build endpoint with a model belonging to a DIFFERENT project → 404."""
    # Create a second project + litho model.
    other_proj = ProjectOrm(id=uuid7(), name="other project", status="active")
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
        parent_geological_model_id=other_geo.id,
    )
    db_session.add_all([other_geo, other_litho])
    await db_session.commit()

    # Attempt to build using the OTHER project's litho model but with the
    # CURRENT project's project_id — the scope guard must reject this.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{other_litho.id}/geotech/build",
        json={"section_id": scene["section_id"]},
    )
    assert resp.status_code == 404
