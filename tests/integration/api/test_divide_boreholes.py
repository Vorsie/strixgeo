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
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
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
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
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
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
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


async def _accept_shallowest_borehole_cpt_tie(
    session: AsyncSession,
    *,
    geotech_model_id: UUID,
    section_id: UUID,
    borehole_id: UUID,
    cpt_id: UUID,
) -> None:
    """Hand-tie a borehole's shallowest packing band to a CPT's, and accept it.

    The engineer's gesture, reduced to its database effect. Phase 8.5 may
    already have PROPOSED this pair; accepting a proposal and drawing one by
    hand both end at the same place — an edge the engineer owns
    (``user_approved=True``) — so the helper promotes an existing row rather
    than inserting a duplicate the unique triple would reject.

    Parameters
    ----------
    session : AsyncSession
        Live session; committed before returning.
    geotech_model_id : UUID
        The geotech model the bands live in.
    section_id : UUID
        Section the tie is authored on (geotech edges are section-scoped).
    borehole_id : UUID
        The borehole endpoint.
    cpt_id : UUID
        The CPT endpoint.
    """

    async def _shallowest(column: object, value: UUID) -> LithoLayerOrm | None:
        return (
            (
                await session.execute(
                    select(LithoLayerOrm)
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        column == value,
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .first()
        )

    bh_band = await _shallowest(LithoLayerOrm.borehole_id, borehole_id)
    cpt_band = await _shallowest(LithoLayerOrm.cpt_id, cpt_id)
    assert bh_band is not None and cpt_band is not None, (
        "setup: expected both a borehole band and a CPT band to tie together"
    )
    # ck_litho_contact_corr_canonical_order requires layer_a_id < layer_b_id.
    # Both sides are 'top', so ordering the ids alone satisfies it.
    layer_a_id = min(bh_band.id, cpt_band.id)
    layer_b_id = max(bh_band.id, cpt_band.id)
    existing = (
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id == layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id == layer_b_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        existing.user_approved = True
        existing.source = "manual"
    else:
        session.add(
            LithoContactCorrelationEdgeOrm(
                id=uuid7(),
                model_id=geotech_model_id,
                section_id=section_id,
                layer_a_id=layer_a_id,
                layer_b_id=layer_b_id,
                layer_a_side="top",
                layer_b_side="top",
                source="manual",
                user_approved=True,
            )
        )
    await session.commit()


async def _accept_all_geotech_ties(
    client: AsyncClient, project_id: str, geotech_model_id: UUID
) -> None:
    """Run the pipeline's accept step over every proposed packing tie.

    Since the four-step pipeline landed (owner ruling 2026-08-04) the
    divide-boreholes ENDPOINT refuses while ties are still proposed, because an
    accepted tie spanning a borehole decides which CPTs its packing comes from.
    A test that goes through HTTP therefore has to walk the real flow: propose,
    accept, then divide.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    geotech_model_id : UUID
        The geotech model whose proposals are accepted.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{geotech_model_id}/contact-correlations/accept",
        json={},
    )
    assert resp.status_code == 200, resp.text


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

    # DB1-6 (parent-band FK, Parameters body-tree A3): each borehole geotech
    # band names the covering litho band it fills within — the accepted litho
    # band on BH-S whose interval contains the band's midpoint. The tree derives
    # the band's litho body live through it.
    bh_litho_by_id = {
        ly.id: ly
        for ly in (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == litho_model_id,
                        LithoLayerOrm.borehole_id == bh_s_id,
                        LithoLayerOrm.status == "accepted",
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    for ll in bh_sorted:
        assert ll.parent_litho_layer_id is not None, (
            f"DB1-6: BH-S band [{ll.depth_top_m}, {ll.depth_base_m}] carries no covering litho band"
        )
        parent = bh_litho_by_id.get(ll.parent_litho_layer_id)
        assert parent is not None, (
            f"DB1-6: BH-S band parent {ll.parent_litho_layer_id} is not an "
            "accepted litho band on BH-S"
        )
        mid = 0.5 * (ll.depth_top_m + ll.depth_base_m)
        assert parent.depth_top_m - 1e-6 <= mid <= parent.depth_base_m + 1e-6, (
            f"DB1-6: band midpoint {mid} outside its parent litho band "
            f"[{parent.depth_top_m}, {parent.depth_base_m}]"
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


@pytest.mark.asyncio
async def test_db4_accepted_borehole_tie_survives_a_re_divide(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB4: an accepted packing tie on a borehole band is still there afterwards.

    The engineer hand-ties a borehole packing band to the neighbouring CPT's
    band — the tie the machine did not propose is exactly the one worth
    keeping — and then clicks "Divide boreholes" again (the button ambers
    after any packing correlation, so re-clicking it is the normal flow).

    The rule, in the owner's words for the sibling verb: *an accepted edge
    never disappears without the engineer deleting it.*  So after the second
    run the tie must still be there, still accepted, still joining the same
    borehole to the same CPT — re-anchored onto whichever band came back in
    its place — and the operation must SAY how many it carried.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = UUID(divide_boreholes_scene["litho_model_id"])
    section_id = UUID(divide_boreholes_scene["section_id"])
    bh_s_id = divide_boreholes_scene["bh_s_id"]
    cpt_a_id = divide_boreholes_scene["cpt_a_id"]

    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    first = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = first.geotech_model_id

    # The engineer's gesture: tie BH-S's shallowest packing band to CPT-A's
    # shallowest one, by hand, and accept it.
    await _accept_shallowest_borehole_cpt_tie(
        db_session,
        geotech_model_id=geotech_model_id,
        section_id=section_id,
        borehole_id=bh_s_id,
        cpt_id=cpt_a_id,
    )

    # Re-click "Divide boreholes".
    second = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # The tie must still join BH-S to CPT-A, and still be accepted.
    surviving = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    endpoint_ids = {e.layer_a_id for e in surviving} | {e.layer_b_id for e in surviving}
    anchors = (
        await db_session.execute(
            select(LithoLayerOrm.id, LithoLayerOrm.cpt_id, LithoLayerOrm.borehole_id).where(
                LithoLayerOrm.id.in_(endpoint_ids or {uuid7()})
            )
        )
    ).all()
    anchor_by_layer = {r.id: (r.cpt_id, r.borehole_id) for r in anchors}
    joined_pairs = {
        frozenset(
            (
                anchor_by_layer.get(e.layer_a_id, (None, None)),
                anchor_by_layer.get(e.layer_b_id, (None, None)),
            )
        )
        for e in surviving
    }
    expected_pair = frozenset(((None, bh_s_id), (cpt_a_id, None)))
    assert expected_pair in joined_pairs, (
        "DB4: the accepted BH-S↔CPT-A packing tie did not survive the re-divide — "
        f"{len(surviving)} accepted tie(s) remain, joining {joined_pairs}"
    )

    # And the app must say so rather than reporting a bare success.
    assert second.reanchored_tie_count == 3, (
        # 3 since Phase 8.6 (owner ruling 2026-08-17 night: a tie spanning a
        # data-bearing borehole splits into the chain): the FIRST divide splits
        # the accepted CPT-to-CPT restatement at BH-S, and the resulting chain
        # piece is itself an accepted borehole-anchored tie the re-divide must
        # carry — alongside his hand tie and the restatement of the litho tie.
        # (It was 2 after the "don't invent correlations" wave removed the
        # donor-hop machinery, and 3 before that for a different reason.)
        f"DB4: expected the hand tie, the litho restatement AND the split "
        f"chain piece to be carried, "
        f"got reanchored={second.reanchored_tie_count} lost={second.lost_tie_count}"
    )


# ---------------------------------------------------------------------------
# DB5 — THE parity gate: preview == commit
# ---------------------------------------------------------------------------


async def _committed_borehole_bands(
    session: AsyncSession, geotech_model_id: UUID
) -> dict[str, list[tuple[float, float, int | None, str | None]]]:
    """Read every committed borehole packing band, keyed by borehole.

    Parameters
    ----------
    session : AsyncSession
        Live session.
    geotech_model_id : UUID
        The geotech model to read.

    Returns
    -------
    dict[str, list[tuple[float, float, int | None, str | None]]]
        Borehole id (stringified) -> the band tuples ``(top, base, nad_class,
        confidence)``, sorted by top depth.  Depths are mm-rounded, the grain
        ``litho_layer`` itself stores intervals at, so float noise cannot make
        an identical band look different.

        ``body_id`` is deliberately NOT compared: the commit re-runs
        ``ResolveLithoInstances`` after the borehole-mediated edges exist, which
        re-stamps it on every band, so no plan can know it in advance.  That is
        why the preview does not report one — this gate is what found it.
    """
    # ORDER BY at the query level, not only the per-borehole sort below: two
    # bands of one borehole may share a top depth after a re-divide, and an
    # unordered SELECT would then let Postgres' physical row order decide the
    # tuple sequence — turning a parity gate into a flaky one.
    rows = (
        await session.execute(
            select(
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
                LithoLayerOrm.confidence,
                GeologicalFormationOrm.nad_class,
            )
            .join(
                GeologicalFormationOrm,
                LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
            )
            .where(
                LithoLayerOrm.model_id == geotech_model_id,
                LithoLayerOrm.borehole_id.is_not(None),
            )
            .order_by(
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
            )
        )
    ).all()
    out: dict[str, list[tuple[float, float, int | None, str | None]]] = {}
    for row in rows:
        out.setdefault(str(row.borehole_id), []).append(
            (
                round(row.depth_top_m, 3),
                round(row.depth_base_m, 3),
                row.nad_class,
                row.confidence,
            )
        )
    for bands in out.values():
        bands.sort(key=lambda b: b[0])
    return out


@pytest.mark.asyncio
async def test_db5_preview_equals_commit(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """DB5: the previewed bands ARE the committed bands, exactly.

    This is the gate the whole preview feature rests on.  The ghosts drawn over
    a borehole are a promise about what "Divide boreholes" will do; a preview
    that can diverge from the commit is worse than no preview at all, because
    the engineer has no way to notice.  So the assertion is equality of the full
    band tuple — depth interval, NAD class and confidence — not a tolerance and
    not a count.

    DB5-1  The preview writes nothing: the boreholes are still empty afterwards.
    DB5-2  Preview and commit agree on every band of every borehole.
    DB5-3  Preview and commit agree on the summary counts.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = divide_boreholes_scene["litho_model_id"]
    pid = str(project.id)

    sab = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=UUID(litho_model_id),
    )
    geotech_model_id = sab.geotech_model_id
    # The pipeline's accept step, run BEFORE the preview: accepting a tie
    # between preview and commit would legitimately change the plan, and this
    # gate is about the two agreeing on ONE model state.
    await _accept_all_geotech_ties(async_client, pid, geotech_model_id)

    preview_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/divide-boreholes/preview",
    )
    assert preview_resp.status_code == 200, preview_resp.text
    preview = preview_resp.json()

    # DB5-1: a dry run is dry.
    assert await _committed_borehole_bands(db_session, geotech_model_id) == {}, (
        "DB5-1: the preview endpoint wrote borehole geotech layers — it must only SELECT"
    )

    previewed = {
        column["borehole_id"]: [
            (
                round(band["depth_top_m"], 3),
                round(band["depth_base_m"], 3),
                band["nad_class"],
                band["confidence"],
            )
            for band in column["bands"]
        ]
        for column in preview["columns"]
    }
    assert previewed, "DB5: the preview reported no borehole at all — nothing was compared"

    # DB5-provenance: the donor fields must SERIALISE through the router — the
    # tooltip reads them, and DB5's band comparison cannot catch a preview-only
    # field going missing (it compares depths/class/confidence only). The scene
    # flanks BH-S with CPT-A and CPT-B on the section, so at least one band
    # must arrive donor-backed with its mode, its donor names + distances and
    # the section name on the wire.
    donor_backed = [
        band
        for column in preview["columns"]
        for band in column["bands"]
        if band.get("mode")
        in (
            "tie_interpolated",
            "flank_interpolated",
            "single_donor",
            "nearest_fallback",
        )
    ]
    assert donor_backed, (
        "DB5-provenance: no band carried a donor-backed mode — the new preview "
        f"fields are not reaching the wire: {preview['columns']!r}"
    )
    for band in donor_backed:
        assert band["donors"], f"DB5-provenance: mode={band['mode']} but donors is empty"
        for donor in band["donors"]:
            assert donor["name"], "DB5-provenance: a donor arrived without a name"
            assert donor["side"] in ("left", "right", "nearest")
    flank_modes = {band["mode"] for band in donor_backed}
    if flank_modes & {"tie_interpolated", "flank_interpolated", "single_donor"}:
        assert any(band.get("section_name") for band in donor_backed), (
            "DB5-provenance: a flank mode arrived with no section_name anywhere"
        )

    commit_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/divide-boreholes",
        json={},
    )
    assert commit_resp.status_code == 200, commit_resp.text
    committed_summary = commit_resp.json()
    committed = await _committed_borehole_bands(db_session, geotech_model_id)

    # DB5-2: band-for-band identity.
    assert previewed == committed, (
        "DB5-2: the committed bands differ from the previewed ones.\n"
        f"previewed={previewed}\ncommitted={committed}"
    )

    # DB5-3: the summaries have to agree too, or the preview's own counts lie.
    assert preview["layer_count"] == committed_summary["layer_count"]
    assert preview["divided_borehole_count"] == committed_summary["divided_borehole_count"]
    assert preview["single_band_borehole_count"] == committed_summary["single_band_borehole_count"]


@pytest.mark.asyncio
async def test_db6_preview_reports_the_ties_the_commit_carries(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """DB6: the preview tie-carry counts match what the commit actually does.

    A re-divide destroys and re-creates every accepted tie anchored on a
    borehole.  Telling the engineer that up front is only useful if the number
    is the real one, so it is asserted against the commit's own report rather
    than against a hand-written expectation.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = divide_boreholes_scene["litho_model_id"]
    bh_s_id = divide_boreholes_scene["bh_s_id"]
    cpt_a_id = divide_boreholes_scene["cpt_a_id"]
    section_id = divide_boreholes_scene["section_id"]
    pid = str(project.id)

    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=UUID(litho_model_id),
    )
    first = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=UUID(litho_model_id),
    )
    geotech_model_id = first.geotech_model_id

    # Accept a hand tie between BH-S's top band and CPT-A's top band.
    await _accept_shallowest_borehole_cpt_tie(
        db_session,
        geotech_model_id=geotech_model_id,
        section_id=UUID(section_id),
        borehole_id=bh_s_id,
        cpt_id=cpt_a_id,
    )

    preview_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/divide-boreholes/preview",
    )
    assert preview_resp.status_code == 200, preview_resp.text
    preview = preview_resp.json()
    assert preview["carried_tie_count"] == 3, (
        # 3 — see DB4 (the split chain piece counts too). What this test is
        # really guarding is the line below: whatever the count is, the preview
        # and the commit must agree on it.
        f"DB6: preview should see the hand tie, the restatement and the split piece, got {preview}"
    )

    second = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=UUID(litho_model_id),
    )
    assert preview["carried_tie_count"] == second.reanchored_tie_count
    assert preview["lost_tie_count"] == second.lost_tie_count
    assert preview["review_tie_reasons"] == second.review_tie_reasons


# ---------------------------------------------------------------------------
# DB7 — the parity gate again, but on a model that has ALREADY been divided
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_db7_preview_between_two_divides_equals_the_second_divide(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """DB7: previewing a RE-divide is as honest as previewing the first one.

    ``plan()`` now runs before the Phase-7 delete of the existing borehole
    layers, which is only sound because it never reads those layers.  DB5 pins
    that on a virgin model (no borehole bands committed yet) and DB6 pins the
    tie counts, but the band-for-band claim on an already-divided model — the
    docstring's *"planning before or after the delete produces identical
    bands"* — had no gate at all.  This is that gate.

    DB7-1  The preview changes nothing: the bands the first divide committed are
           byte-identical afterwards.
    DB7-2  The previewed bands equal the ones the SECOND divide commits.
    DB7-3  The preview's summary counts equal the second divide's.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = divide_boreholes_scene["litho_model_id"]
    pid = str(project.id)

    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=UUID(litho_model_id),
    )
    first = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=UUID(litho_model_id),
    )
    geotech_model_id = first.geotech_model_id
    # The pipeline's accept step, run BEFORE the preview for the same reason as
    # in DB5: preview and commit must be looking at one model state.
    await _accept_all_geotech_ties(async_client, pid, geotech_model_id)
    before = await _committed_borehole_bands(db_session, geotech_model_id)
    assert before, "DB7: the first divide committed no borehole band — nothing is being tested"

    preview_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/divide-boreholes/preview",
    )
    assert preview_resp.status_code == 200, preview_resp.text
    preview = preview_resp.json()

    # DB7-1: a dry run over a divided model is still dry — the rows the first
    # divide wrote are untouched, delete-then-rebuild notwithstanding.
    assert await _committed_borehole_bands(db_session, geotech_model_id) == before, (
        "DB7-1: the preview mutated the borehole bands committed by the first divide"
    )

    previewed = {
        column["borehole_id"]: [
            (
                round(band["depth_top_m"], 3),
                round(band["depth_base_m"], 3),
                band["nad_class"],
                band["confidence"],
            )
            for band in column["bands"]
        ]
        for column in preview["columns"]
    }
    assert previewed, "DB7: the preview reported no borehole at all — nothing was compared"

    second_resp = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/divide-boreholes",
        json={},
    )
    assert second_resp.status_code == 200, second_resp.text
    second_summary = second_resp.json()
    committed = await _committed_borehole_bands(db_session, geotech_model_id)

    # DB7-2: band-for-band identity across the delete/rebuild.
    assert previewed == committed, (
        "DB7-2: the re-divide committed different bands than the preview promised.\n"
        f"previewed={previewed}\ncommitted={committed}"
    )

    # DB7-3: and the counts it reported were the real ones.
    assert preview["layer_count"] == second_summary["layer_count"]
    assert preview["divided_borehole_count"] == second_summary["divided_borehole_count"]
    assert preview["single_band_borehole_count"] == second_summary["single_band_borehole_count"]


@pytest.mark.asyncio
async def test_db8_a_manual_span_over_the_borehole_splits_into_the_chain(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB8 — owner ruling 2026-08-17 night: *"The ties i manually made spanning
    both boreholes aren't replaced by hops but never deleted. You can delete
    user correlations spanning 2 boreholes. If the borehole has data"*.

    A manual accepted CPT-A ↔ CPT-B tie drawn at a depth BH-S (between them)
    covers is replaced on divide: the span is deleted and chain pieces land on
    BH-S's nearest contact — accepted, machine-owned.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = UUID(divide_boreholes_scene["litho_model_id"])
    bh_s_id = divide_boreholes_scene["bh_s_id"]
    cpt_a_id = divide_boreholes_scene["cpt_a_id"]
    cpt_b_id = divide_boreholes_scene["cpt_b_id"]
    section_id = UUID(divide_boreholes_scene["section_id"])

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    geotech_model_id = sab_result.geotech_model_id
    await db_session.commit()

    async def _bands(inv_col, inv_id):
        return (
            (
                await db_session.execute(
                    select(LithoLayerOrm)
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        inv_col == inv_id,
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .all()
        )

    a_bands = await _bands(LithoLayerOrm.cpt_id, cpt_a_id)
    b_bands = await _bands(LithoLayerOrm.cpt_id, cpt_b_id)
    assert len(a_bands) >= 2 and len(b_bands) >= 2

    # SAB's own machine proposal for the pair would collide with the plant —
    # in his real scene the manual span sits at depths the machine never tied,
    # so clear the machine's claim on this pair first.
    await db_session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
            LithoContactCorrelationEdgeOrm.layer_a_id.in_([a_bands[1].id, b_bands[1].id]),
            LithoContactCorrelationEdgeOrm.layer_b_id.in_([a_bands[1].id, b_bands[1].id]),
        )
    )
    await db_session.commit()

    # The manual span: A's dicht top (4.0 m) to B's dicht top (5.0 m) — the
    # depth BH-S's committed bands will cover (its split lands ~4.5 m).
    span = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=geotech_model_id,
        section_id=section_id,
        layer_a_id=min(a_bands[1].id, b_bands[1].id),
        layer_b_id=max(a_bands[1].id, b_bands[1].id),
        layer_a_side="top",
        layer_b_side="top",
        source="manual",
        user_approved=True,
    )
    db_session.add(span)
    await db_session.commit()
    span_id = span.id
    # Plain ids, captured before expire_all — an expired ORM row read after
    # the divide would lazy-refresh outside the greenlet.
    watched_band_ids = {a_bands[0].id, a_bands[1].id, b_bands[0].id, b_bands[1].id}

    result = await DivideBoreholes(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    await db_session.commit()
    db_session.expire_all()

    assert result.replaced_span_count >= 1, "the span over a data-bearing borehole must split"
    remaining = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert span_id not in {e.id for e in remaining}, "the original span must be deleted"
    bh_bands = await _bands(LithoLayerOrm.borehole_id, bh_s_id)
    bh_ids = {b.id for b in bh_bands}
    chain_pieces = [
        e
        for e in remaining
        if (e.layer_a_id in bh_ids) != (e.layer_b_id in bh_ids)
        and {e.layer_a_id, e.layer_b_id} & watched_band_ids
    ]
    assert chain_pieces, "chain pieces landing on BH-S must exist"
    assert all(e.user_approved and e.source == "auto" for e in chain_pieces)


@pytest.mark.asyncio
async def test_db10_a_span_that_cannot_hop_over_the_borehole_is_deleted(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB10 — owner rulings 2026-08-24: *"i also had to manually deleted a
    correlation spanning a borehole from cpt to cpt over borehole, write a
    check that checks if all those are gone after divide boreholes"* and *"if
    no hops can be made, you just auto delete the crossing correlation, user
    will notice something weird in the fill if he/she needs to subdivide"*.

    A span from CPT-A to CPT-B drawn at a depth BH-S covers, but passing
    mid-band 2 m from BH-S's nearest seam, can make no hop.  After the divide
    it is GONE — and so is every other accepted CPT↔CPT tie over BH-S, whose
    column is banded end to end.  Ties that END on the borehole are untouched:
    only a tie passing OVER one is a crossing.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = UUID(divide_boreholes_scene["litho_model_id"])
    bh_s_id = divide_boreholes_scene["bh_s_id"]
    cpt_a_id = divide_boreholes_scene["cpt_a_id"]
    cpt_b_id = divide_boreholes_scene["cpt_b_id"]
    section_id = UUID(divide_boreholes_scene["section_id"])

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    geotech_model_id = sab_result.geotech_model_id
    await db_session.commit()

    async def _bands(inv_col, inv_id):
        return (
            (
                await db_session.execute(
                    select(LithoLayerOrm)
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        inv_col == inv_id,
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .all()
        )

    a_bands = await _bands(LithoLayerOrm.cpt_id, cpt_a_id)
    b_bands = await _bands(LithoLayerOrm.cpt_id, cpt_b_id)
    assert len(a_bands) >= 2 and len(b_bands) >= 2

    # The span: CPT-A's matig TOP (0.0 m) to CPT-B's dicht TOP (5.0 m).  Half
    # way across, over BH-S, the line sits at 2.5 m depth — 2.0 m from BH-S's
    # nearest contact (its ~4.5 m split), so no landing is within reach and the
    # splitter can make no hop.  Clear the machine's claim on the pair first,
    # exactly as DB8 does.
    await db_session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
            LithoContactCorrelationEdgeOrm.layer_a_id.in_([a_bands[0].id, b_bands[1].id]),
            LithoContactCorrelationEdgeOrm.layer_b_id.in_([a_bands[0].id, b_bands[1].id]),
        )
    )
    span = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=geotech_model_id,
        section_id=section_id,
        layer_a_id=min(a_bands[0].id, b_bands[1].id),
        layer_b_id=max(a_bands[0].id, b_bands[1].id),
        layer_a_side="top",
        layer_b_side="top",
        source="manual",
        user_approved=True,
    )
    db_session.add(span)
    await db_session.commit()
    span_id = span.id
    cpt_band_ids = {band.id for band in [*a_bands, *b_bands]}

    result = await DivideBoreholes(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    await db_session.commit()
    db_session.expire_all()

    # DB10-1: the span that could not hop was deleted, not kept.
    assert result.deleted_crossing_span_count >= 1
    remaining = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert span_id not in {e.id for e in remaining}, (
        "a cpt-to-cpt correlation over a borehole that cannot land must be gone "
        "after divide boreholes"
    )

    # DB10-2: "all those are gone" — BH-S is banded over its whole column, so
    # EVERY accepted CPT↔CPT tie here passes through its banded range.
    bh_bands = await _bands(LithoLayerOrm.borehole_id, bh_s_id)
    assert bh_bands, "setup: BH-S must be banded for the crossing rule to apply"
    survivors_over_the_borehole = [
        e
        for e in remaining
        if e.user_approved and e.layer_a_id in cpt_band_ids and e.layer_b_id in cpt_band_ids
    ]
    assert survivors_over_the_borehole == [], (
        "no accepted cpt-to-cpt tie may still span the banded borehole: "
        f"{[(str(e.id), e.source) for e in survivors_over_the_borehole]}"
    )

    # DB10-3: a tie that ENDS on the borehole is not a crossing and survives.
    bh_ids = {band.id for band in bh_bands}
    touching_the_borehole = [
        e
        for e in remaining
        if e.user_approved and ((e.layer_a_id in bh_ids) != (e.layer_b_id in bh_ids))
    ]
    assert touching_the_borehole, "ties anchored on the borehole must be left alone"


@pytest.mark.asyncio
async def test_db9_a_base_base_tie_steers_placement_like_its_top_top_twin(
    divide_boreholes_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB9 — audit P1-2 (2026-08-18): the endpoint SIDE decides the seam.

    Band 0's base and band 1's top are ONE physical seam.  A base↔base tie on
    the matig bands states exactly what a top↔top tie on the dicht bands
    states.  The old placement assumed every endpoint was a top, so the
    base↔base form hit the ``li == 0`` guard and was silently dropped — the
    engineer's accepted correlation stopped steering the borehole.
    """
    project = divide_boreholes_scene["project"]
    litho_model_id = UUID(divide_boreholes_scene["litho_model_id"])
    cpt_a_id = divide_boreholes_scene["cpt_a_id"]
    cpt_b_id = divide_boreholes_scene["cpt_b_id"]
    section_id = UUID(divide_boreholes_scene["section_id"])

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    geotech_model_id = sab_result.geotech_model_id
    await db_session.commit()

    a_bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id == cpt_a_id,
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    b_bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id == cpt_b_id,
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    assert len(a_bands) == 2 and len(b_bands) == 2

    # Clear every machine tie, then state the seam ONLY as base↔base on the
    # MATIG bands (band 0 each side).
    await db_session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
        )
    )
    lo, hi = (a_bands[0], b_bands[0]) if a_bands[0].id < b_bands[0].id else (b_bands[0], a_bands[0])
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=geotech_model_id,
            section_id=section_id,
            layer_a_id=lo.id,
            layer_b_id=hi.id,
            layer_a_side="base",
            layer_b_side="base",
            source="manual",
            user_approved=True,
        )
    )
    await db_session.commit()

    plan = await DivideBoreholes(db_session).plan(
        project_id=project.id, litho_model_id=litho_model_id
    )
    matig_pair = {str(a_bands[0].id), str(b_bands[0].id)}
    consumed = [pair for pair in plan.replaced_tie_layer_pairs if set(pair) == matig_pair]
    assert consumed, (
        "the base-base tie must be consumed by the placement (mode unit_ties), "
        f"got replaced pairs: {plan.replaced_tie_layer_pairs!r}"
    )
