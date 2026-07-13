"""Integration tests for DivideBoreholes.

DivideBoreholes is a post-SAB step that TIN-divides borehole columns using
the CPT geotech layers already materialised by SubdivideAllBodies.

Scene
-----
Two CPTs (CPT-A at x=149 000 m, CPT-B at x=149 600 m) and one borehole
(BH-S at x=149 300 m) in the same lithostratigraphic body (ZAND, 0–8 m).
CPT-A transitions from matig (8 MPa) to dicht (18 MPa) at 4.0 m depth.
CPT-B transitions at 5.0 m depth.  Both have surface_level_m=5.0.
The TIN-interpolated split at BH-S's XY is ≈4.5 m ± 0.5 m.

Test assertions
---------------
DB1   SAB alone → BH-S has 0 geotech layers; after DivideBoreholes → 2 layers
      (split depth in [3.5, 5.5] m, tiling complete, body_id=None).
DB2   Idempotency — calling DivideBoreholes twice produces the same 2 layers
      (the second run deletes the first run's rows and re-inserts identically).
DB3   404 via HTTP when the geotech model does not exist (SAB has not run).

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_divide_boreholes.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Private scene helpers (duplicating only what this test module needs;
# the SAB-test file has identical helpers — extract to a shared conftest
# when a third file needs them).
# ---------------------------------------------------------------------------


def _two_layer_qc(
    n_top: int, n_bot: int, qc_top: float, qc_bot: float
) -> tuple[list[float], list[float]]:
    """Return (depths_m, qc_mpa) with a distinct top/bottom packing zone.

    Parameters
    ----------
    n_top : int
        Number of samples in the upper zone.
    n_bot : int
        Number of samples in the lower zone.
    qc_top : float
        Cone resistance for the top zone (MPa).
    qc_bot : float
        Cone resistance for the bottom zone (MPa).

    Returns
    -------
    tuple[list[float], list[float]]
        Concatenated ``(depths_m, qc_mpa)`` lists.
    """
    n = n_top + n_bot
    depths = [round(i * 0.02, 3) for i in range(n)]
    qc = [qc_top] * n_top + [qc_bot] * n_bot
    return depths, qc


async def _accept_cpt_litho(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    cpt_id: str,
    top: float,
    base: float,
    soil: str = "ZAND",
) -> str:
    """Accept one litho suggestion on a CPT and return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    cpt_id : str
        CPT id.
    top : float
        Top depth (m).
    base : float
        Base depth (m).
    soil : str, optional
        Main soil code; defaults to ``"ZAND"``.

    Returns
    -------
    str
        The created formation-contact id.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/contacts/accept-litho-suggestions",
        json={
            "cpt_id": cpt_id,
            "suggestions": [
                {
                    "depth_top_m": top,
                    "depth_base_m": base,
                    "suggested_lithology": soil,
                    "confidence": "high",
                    "source": "robertson_2015",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    contacts = resp.json()["created_contact_ids"]
    assert len(contacts) >= 1
    return contacts[0]


async def _accept_borehole_litho(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    borehole_id: str,
    top: float,
    base: float,
    soil: str = "ZAND",
) -> str:
    """Accept one litho suggestion on a borehole and return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    borehole_id : str
        Borehole id.
    top : float
        Top depth (m).
    base : float
        Base depth (m).
    soil : str, optional
        Main soil code; defaults to ``"ZAND"``.

    Returns
    -------
    str
        The created formation-contact id.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/contacts/accept-litho-suggestions",
        json={
            "borehole_id": borehole_id,
            "suggestions": [
                {
                    "depth_top_m": top,
                    "depth_base_m": base,
                    "suggested_lithology": soil,
                    "confidence": "high",
                    "source": "borehole_observation",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    contacts = resp.json()["created_contact_ids"]
    assert len(contacts) >= 1
    return contacts[0]


async def _correlate(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    contact_a: str,
    contact_b: str,
    section_id: str,
) -> None:
    """POST a correlation edge between two accepted contacts.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    contact_a : str
        First contact id.
    contact_b : str
        Second contact id.
    section_id : str
        Section the edge is authored on.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/contact-correlations",
        json={
            "layer_a_id": contact_a,
            "layer_b_id": contact_b,
            "request_section_id": section_id,
        },
    )
    assert resp.status_code in (200, 201), resp.text


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def divide_boreholes_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Two-CPT + one-borehole scene for DivideBoreholes tests.

    CPT-A (x=149 000 m) transitions matig→dicht at 4.0 m.
    CPT-B (x=149 600 m) transitions matig→dicht at 5.0 m.
    BH-S  (x=149 300 m) logs ZAND from 0–8 m (no qc series).
    All three are accepted in the same litho model and correlated into one body.
    The geo model has no formation surfaces, so geo-bounding is a no-op.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``geotech_model_id`` (None —
        SAB has not run), ``section_id``, ``bh_s_id``, ``cpt_a_id``,
        ``cpt_b_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="DivideBoreholes test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "DB-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "DB-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "DB-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_900.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # CPT-A: matig 0–4 m (200 samples) then dicht 4–8 m (200 samples).
    depths_a, qc_a = _two_layer_qc(n_top=200, n_bot=200, qc_top=8.0, qc_bot=18.0)
    # CPT-B: matig 0–5 m (250 samples) then dicht 5–8 m (150 samples).
    depths_b, qc_b = _two_layer_qc(n_top=250, n_bot=150, qc_top=8.0, qc_bot=18.0)

    cpt_a = CptOrm(
        id=uuid7(),
        name="CPT-A",
        cpt_type="CPTU",
        project_id="DB",
        test_id="DB/CPT-A",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_a.series = CptSeriesOrm(
        depths_m=depths_a,
        qc_mpa=qc_a,
        fs_mpa=[0.05] * len(depths_a),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_b = CptOrm(
        id=uuid7(),
        name="CPT-B",
        cpt_type="CPTU",
        project_id="DB",
        test_id="DB/CPT-B",
        app_project_id=proj.id,
        location_x=149_600.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_b.series = CptSeriesOrm(
        depths_m=depths_b,
        qc_mpa=qc_b,
        fs_mpa=[0.05] * len(depths_b),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    bh_s = BoreholeOrm(
        id=uuid7(),
        name="BH-S",
        app_project_id=proj.id,
        project_id="DB",
        test_id="DB/BH-S",
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )
    db_session.add_all([cpt_a, cpt_b, bh_s])
    await db_session.commit()

    ca_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_a.id),
        top=0.0,
        base=8.0,
    )
    cb_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_b.id),
        top=0.0,
        base=8.0,
    )
    bhs_id = await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_s.id),
        top=0.0,
        base=8.0,
    )

    # Correlate all three into the same litho body.
    await _correlate(
        async_client, pid, litho_model_id, contact_a=ca_id, contact_b=cb_id, section_id=section_id
    )
    await _correlate(
        async_client, pid, litho_model_id, contact_a=ca_id, contact_b=bhs_id, section_id=section_id
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "bh_s_id": bh_s.id,
        "cpt_a_id": cpt_a.id,
        "cpt_b_id": cpt_b.id,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_db1_sab_then_divide_boreholes(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB1: SAB alone writes no borehole layers; DivideBoreholes TIN-divides them.

    DB1-0  After SAB, BH-S has 0 geotech layers.
    DB1-1  After DivideBoreholes, BH-S has exactly 2 accepted geotech layers.
    DB1-2  Borehole layers have body_id=None (resolver is not re-run).
    DB1-3  Split depth in [3.5, 5.5] m (TIN interpolation of CPT-A at 4.0 m
           and CPT-B at 5.0 m; BH-S at x=149 300 sits between them).
    DB1-4  Tiling: the two layers tile 0–8 m with no gap or overlap > 1 mm.
    DB1-5  DivideBoreholeResult carries divided_borehole_count=1, layer_count=2.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = UUID(divide_boreholes_scene["litho_model_id"])
    bh_s_id = divide_boreholes_scene["bh_s_id"]

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = sab_result.geotech_model_id

    # DB1-0: SAB must not write borehole geotech layers.
    bh_after_sab = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_s_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(bh_after_sab) == 0, (
        f"DB1-0: expected 0 borehole geotech layers after SAB alone, got {len(bh_after_sab)}"
    )

    db_result = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # DB1-5: result summary.
    assert db_result.divided_borehole_count == 1, (
        f"DB1-5: expected divided_borehole_count=1, got {db_result.divided_borehole_count}"
    )
    assert db_result.layer_count == 2, (
        f"DB1-5: expected layer_count=2 (one matig + one dicht band), got {db_result.layer_count}"
    )

    bh_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_s_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    bh_sorted = sorted(bh_layers, key=lambda ll: ll.depth_top_m)

    # DB1-1: exactly 2 layers.
    assert len(bh_sorted) == 2, (
        f"DB1-1: expected 2 geotech layers for BH-S after DivideBoreholes, "
        f"got {len(bh_sorted)}: {[(ll.depth_top_m, ll.depth_base_m) for ll in bh_sorted]}"
    )

    # DB1-2: body_id is resolver-stamped. Since bec4e53ed (2026-07-07,
    # Phase 8.5) DivideBoreholes derives borehole-mediated geotech edges and
    # RE-RESOLVES the model, so divided borehole layers join the geotech body
    # graph instead of staying body-less. (The original assertion pinned the
    # pre-07-07 skip-the-resolver contract — debt #238.1.)
    for ll in bh_sorted:
        assert ll.body_id is not None, (
            f"DB1-2: BH-S layer [{ll.depth_top_m}, {ll.depth_base_m}] "
            f"has body_id=None — DivideBoreholes must re-resolve borehole "
            f"layers into the geotech body graph (Phase 8.5, bec4e53ed)"
        )

    # DB1-3: split depth in [3.5, 5.5] m.
    # CPT-A splits at 4.0 m (elev 1.0 m) and CPT-B at 5.0 m (elev 0.0 m).
    # Mean elevation 0.5 m → BH-S split depth = 5.0 - 0.5 = 4.5 m.
    split_depth = bh_sorted[0].depth_base_m
    assert 3.5 <= split_depth <= 5.5, (
        f"DB1-3: BH-S split depth {split_depth:.3f} m outside [3.5, 5.5] m; "
        f"expected ≈4.5 m (TIN interpolation of CPT-A=4.0 m and CPT-B=5.0 m)"
    )

    # DB1-4: tiling invariant (no gap > 1 mm).
    assert abs(bh_sorted[0].depth_base_m - bh_sorted[1].depth_top_m) <= 0.001, (
        f"DB1-4: BH-S layers not contiguous: "
        f"layer[0].base={bh_sorted[0].depth_base_m:.4f} m "
        f"!= layer[1].top={bh_sorted[1].depth_top_m:.4f} m"
    )


@pytest.mark.asyncio
async def test_db2_idempotent(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB2: calling DivideBoreholes twice produces the same 2 layers (idempotent).

    The second run deletes the first run's rows and re-inserts; the borehole
    must still have exactly 2 layers with the same geometry after the second run.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = UUID(divide_boreholes_scene["litho_model_id"])
    bh_s_id = divide_boreholes_scene["bh_s_id"]

    # Run SAB first to create the geotech model and CPT layers.
    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    r1 = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = r1.geotech_model_id

    layers_after_first = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_s_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    first_depths = sorted((ll.depth_top_m, ll.depth_base_m) for ll in layers_after_first)

    r2 = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    layers_after_second = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_s_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    second_depths = sorted((ll.depth_top_m, ll.depth_base_m) for ll in layers_after_second)

    assert len(layers_after_second) == 2, (
        f"DB2: expected 2 layers after second DivideBoreholes run, got {len(layers_after_second)}"
    )
    assert first_depths == second_depths, (
        f"DB2: depths differ between run 1 and run 2: {first_depths} != {second_depths}"
    )
    assert r2.layer_count == r1.layer_count, (
        f"DB2: layer_count differs: run1={r1.layer_count} run2={r2.layer_count}"
    )


@pytest.mark.asyncio
async def test_db3_no_geotech_model(
    divide_boreholes_scene: dict,
    async_client: AsyncClient,
) -> None:
    """DB3: 404 from the HTTP endpoint when SAB has not been run yet.

    Without a prior SubdivideAllBodies call there is no geotechnical child
    model, so DivideBoreholes must respond with HTTP 404.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = divide_boreholes_scene["litho_model_id"]
    pid = str(project.id)

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/divide-boreholes"
    )
    assert resp.status_code == 404, (
        f"DB3: expected 404 when no geotech model exists, got {resp.status_code}: {resp.text}"
    )
    body = resp.json()
    assert body.get("detail", {}).get("code") == "geotech_model_not_found", (
        f"DB3: unexpected error detail: {body}"
    )
