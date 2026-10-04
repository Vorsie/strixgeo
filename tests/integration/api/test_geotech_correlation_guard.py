"""Integration tests — geotech packing correlation litho-body guard.

Verifies that ``CorrelateLithoContacts`` (routed via
``POST .../contact-correlations``) blocks a geotech packing
correlation whose two bands belong to different lithostratigraphic
bodies, while allowing same-body correlations.

Invariant: a NAD packing class is always a subdivision of ONE
lithostratigraphic body; two geotech bands from different litho
bodies must not be joined by a manual correlate gesture.

Scene
-----
* CPT-A and CPT-B are correlated in the litho model → they land in
  the same litho body (Body-AB) after the resolver runs.
* CPT-C is standalone → its own singleton litho body (Body-C).
* ``SubdivideAllBodies`` materialises one geotech band per CPT
  (uniform qc = 10 MPa → a single consistent NAD class per column).

Test assertions
---------------
GC-1  Correlate geotech-band(CPT-A) ↔ geotech-band(CPT-B)
      → 200 or 201 (same litho body — allowed).
GC-2  Correlate geotech-band(CPT-A) ↔ geotech-band(CPT-C)
      → 422 (Body-AB ≠ Body-C — blocked).
GC-3  No edge row exists for the rejected pair after GC-2.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_geotech_correlation_guard.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import paint_accepted_ties

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uniform_qc_series(n: int, qc_mpa: float) -> tuple[list[float], list[float]]:
    """Return (depths_m, qc_mpa) as uniform-interval lists of length ``n``.

    Parameters
    ----------
    n : int
        Number of samples.
    qc_mpa : float
        Uniform cone resistance for all samples (MPa).

    Returns
    -------
    tuple[list[float], list[float]]
        ``(depths_m, qc_mpa)``; depths run at the standard 0.02 m CPT step.
    """
    depths = [round(i * 0.02, 3) for i in range(n)]
    qc = [qc_mpa] * n
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
    """Accept one litho suggestion for a CPT and return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id (string).
    litho_model_id : str
        Lithostratigraphic model id (string).
    cpt_id : str
        CPT id.
    top : float
        Layer top depth (m).
    base : float
        Layer base depth (m).
    soil : str, optional
        Main soil code; defaults to ``"ZAND"``.

    Returns
    -------
    str
        Created formation-contact id (== litho_layer.id via the SAB-8 trigger).
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
    assert len(contacts) >= 1, "Expected at least one contact id from accept"
    return contacts[0]


async def _correlate_litho(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    contact_a: str,
    contact_b: str,
    section_id: str,
) -> None:
    """Correlate two litho contacts; assert success.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Lithostratigraphic model id.
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
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def gc_project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for geotech-correlation-guard (GC) tests."""
    proj = ProjectOrm(id=uuid7(), name="GC test project", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def gc_scene(
    db_session: AsyncSession,
    gc_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Two-body guard scene for geotech-correlation-guard tests.

    Builds three CPTs with a uniform qc = 10 MPa profile so each
    produces exactly ONE geotech band after ``SubdivideAllBodies``:

    * CPT-A and CPT-B are litho-correlated → same litho body (Body-AB).
    * CPT-C is standalone → own litho body (Body-C).

    ``SubdivideAllBodies`` runs inside the fixture so the caller
    receives the geotech model id.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``geotech_model_id``,
        ``section_id``, ``cpt_a_id``, ``cpt_b_id``, ``cpt_c_id``.
    """
    pid = str(gc_project.id)

    # Geo model (required parent for the litho model)
    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GC-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    # Litho model parented to the geo model
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GC-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # Section covering all three CPTs
    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "GC-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 151_200.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # Three CPTs — uniform qc = 10 MPa → one NAD band each after subdivide
    depths, qc = _uniform_qc_series(n=400, qc_mpa=10.0)

    cpt_a = CptOrm(
        id=uuid7(),
        name="CPT-A",
        cpt_type="CPTU",
        project_id="GC",
        test_id="GC/CPT-A",
        app_project_id=gc_project.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_a.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    cpt_b = CptOrm(
        id=uuid7(),
        name="CPT-B",
        cpt_type="CPTU",
        project_id="GC",
        test_id="GC/CPT-B",
        app_project_id=gc_project.id,
        location_x=149_500.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_b.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-C will NOT be correlated → separate litho body (Body-C)
    cpt_c = CptOrm(
        id=uuid7(),
        name="CPT-C",
        cpt_type="CPTU",
        project_id="GC",
        test_id="GC/CPT-C",
        app_project_id=gc_project.id,
        location_x=150_600.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_c.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    db_session.add_all([cpt_a, cpt_b, cpt_c])
    await db_session.commit()

    # Accept one ZAND layer per CPT (0–8 m)
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
    # CPT-C: accepted but intentionally NOT correlated → stays in Body-C
    await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_c.id),
        top=0.0,
        base=8.0,
    )

    # Correlate CPT-A ↔ CPT-B in litho so the resolver merges them into Body-AB
    await _correlate_litho(
        async_client,
        pid,
        litho_model_id,
        contact_a=ca_id,
        contact_b=cb_id,
        section_id=section_id,
    )

    # Materialise geotech layers (one band per CPT due to uniform qc)
    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied pair ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)
    result = await SubdivideAllBodies(db_session).execute(
        project_id=gc_project.id,
        litho_model_id=UUID(litho_model_id),
    )
    assert result.geotech_model_id is not None, (
        "gc_scene: SubdivideAllBodies must yield a geotech model"
    )

    return {
        "project": gc_project,
        "litho_model_id": litho_model_id,
        "geotech_model_id": str(result.geotech_model_id),
        "section_id": section_id,
        "cpt_a_id": str(cpt_a.id),
        "cpt_b_id": str(cpt_b.id),
        "cpt_c_id": str(cpt_c.id),
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gc_all(
    gc_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """GC-1, GC-2, GC-3: cross-litho-body guard on geotech correlations.

    GC-1  Correlate geotech-band(CPT-A) ↔ geotech-band(CPT-B) — same
          litho body (Body-AB) → 200 or 201 (allowed).
    GC-2  Correlate geotech-band(CPT-A) ↔ geotech-band(CPT-C) — different
          litho bodies (Body-AB vs Body-C) → 422 (blocked); detail
          must mention the litho body constraint.
    GC-3  No edge row was inserted for the rejected CPT-A / CPT-C pair.
    """
    pid = gc_scene["project"].id
    geotech_model_id = gc_scene["geotech_model_id"]
    section_id = gc_scene["section_id"]

    # Resolve geotech layer ids for each CPT (one accepted band each)
    def _layer_for_cpt(cpt_id: UUID) -> select:
        return select(LithoLayerOrm).where(
            LithoLayerOrm.model_id == UUID(geotech_model_id),
            LithoLayerOrm.cpt_id == cpt_id,
            LithoLayerOrm.status == "accepted",
        )

    cpt_a_id = UUID(gc_scene["cpt_a_id"])
    cpt_b_id = UUID(gc_scene["cpt_b_id"])
    cpt_c_id = UUID(gc_scene["cpt_c_id"])

    layer_a = (await db_session.execute(_layer_for_cpt(cpt_a_id))).scalars().first()
    layer_b = (await db_session.execute(_layer_for_cpt(cpt_b_id))).scalars().first()
    layer_c = (await db_session.execute(_layer_for_cpt(cpt_c_id))).scalars().first()

    assert layer_a is not None, "GC-prereq: no accepted geotech layer for CPT-A"
    assert layer_b is not None, "GC-prereq: no accepted geotech layer for CPT-B"
    assert layer_c is not None, "GC-prereq: no accepted geotech layer for CPT-C"

    ga_id = str(layer_a.id)
    gb_id = str(layer_b.id)
    gc_id = str(layer_c.id)

    # ------------------------------------------------------------------ #
    # GC-1: same litho body → correlation allowed (200 or 201)            #
    # ------------------------------------------------------------------ #
    resp_same = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": ga_id,
            "layer_b_id": gb_id,
            "request_section_id": section_id,
        },
    )
    assert resp_same.status_code in (200, 201), (
        f"GC-1 FAIL: expected 200/201 for same-body geotech correlation, "
        f"got {resp_same.status_code}: {resp_same.text}"
    )
    # GC-1 DB symmetry with GC-3: the same-body edge row must actually be
    # committed (a 2xx that silently rolled back would otherwise pass).
    same_edge = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id),
                    or_(
                        and_(
                            LithoContactCorrelationEdgeOrm.layer_a_id == layer_a.id,
                            LithoContactCorrelationEdgeOrm.layer_b_id == layer_b.id,
                        ),
                        and_(
                            LithoContactCorrelationEdgeOrm.layer_a_id == layer_b.id,
                            LithoContactCorrelationEdgeOrm.layer_b_id == layer_a.id,
                        ),
                    ),
                )
            )
        )
        .scalars()
        .first()
    )
    assert same_edge is not None, (
        "GC-1 FAIL: no edge row committed for the same-body CPT-A ↔ CPT-B pair"
    )

    # ------------------------------------------------------------------ #
    # GC-2: cross litho body → correlation blocked (422)                  #
    # ------------------------------------------------------------------ #
    resp_cross = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": ga_id,
            "layer_b_id": gc_id,
            "request_section_id": section_id,
        },
    )
    assert resp_cross.status_code == 422, (
        f"GC-2 FAIL: expected 422 for cross-body geotech correlation, "
        f"got {resp_cross.status_code}: {resp_cross.text}"
    )
    detail = resp_cross.json().get("detail", "")
    assert "litho" in detail.lower(), (
        f"GC-2 FAIL: 422 detail should mention litho body; got: {detail!r}"
    )

    # ------------------------------------------------------------------ #
    # GC-3: no edge row was committed for the rejected pair               #
    # ------------------------------------------------------------------ #
    stmt_cross_edge = select(LithoContactCorrelationEdgeOrm).where(
        LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id),
        or_(
            and_(
                LithoContactCorrelationEdgeOrm.layer_a_id == layer_a.id,
                LithoContactCorrelationEdgeOrm.layer_b_id == layer_c.id,
            ),
            and_(
                LithoContactCorrelationEdgeOrm.layer_a_id == layer_c.id,
                LithoContactCorrelationEdgeOrm.layer_b_id == layer_a.id,
            ),
        ),
    )
    cross_edge = (await db_session.execute(stmt_cross_edge)).scalars().first()
    assert cross_edge is None, (
        f"GC-3 FAIL: an edge row was committed for the rejected cross-body pair "
        f"(CPT-A geotech {layer_a.id} ↔ CPT-C geotech {layer_c.id})"
    )


@pytest.mark.asyncio
async def test_gc4_surface_tie_with_one_shared_adjacent_body_is_allowed(
    gc_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """GC-4: a contact is a surface — one shared adjacent body legitimises the tie.

    Owner ruling (2026-08-04): a contact touches the band above and the band
    below, so it touches up to two litho bodies; "if one matches it matches".
    Scene: CPT-D carries KLEI over ZAND, CPT-E carries KLEI over SILT, the two
    KLEI layers are litho-correlated into one body, the deep layers are not.
    Tying the two contacts at 4 m is the clay-BASE surface tie: the bands
    below the contacts live in different bodies, the bands above share one.
    The pre-ruling guard (below-band only) refused exactly this gesture.
    """
    pid = gc_scene["project"].id
    litho_model_id = gc_scene["litho_model_id"]
    section_id = gc_scene["section_id"]

    depths = [round(0.1 * i, 1) for i in range(1, 81)]
    qc = [5.0] * len(depths)
    cpt_d = CptOrm(
        id=uuid7(),
        name="GC/CPT-D",
        cpt_type="CPTU",
        project_id="GC",
        test_id="GC/CPT-D",
        app_project_id=pid,
        location_x=150_800.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_d.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_e = CptOrm(
        id=uuid7(),
        name="GC/CPT-E",
        cpt_type="CPTU",
        project_id="GC",
        test_id="GC/CPT-E",
        app_project_id=pid,
        location_x=151_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_e.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    db_session.add_all([cpt_d, cpt_e])
    await db_session.commit()

    d_klei = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_d.id), top=0.0, base=4.0, soil="KLEI"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_d.id), top=4.0, base=8.0, soil="ZAND"
    )
    e_klei = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_e.id), top=0.0, base=4.0, soil="KLEI"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_e.id), top=4.0, base=8.0, soil="SILT"
    )
    # One shared body for the two KLEI layers; the deep ZAND/SILT stay apart.
    await _correlate_litho(
        async_client,
        pid,
        litho_model_id,
        contact_a=d_klei,
        contact_b=e_klei,
        section_id=section_id,
    )

    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied pair ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)
    result = await SubdivideAllBodies(db_session).execute(
        project_id=pid,
        litho_model_id=UUID(litho_model_id),
    )
    geotech_model_id = str(result.geotech_model_id)

    async def _deep_band(cpt_id: UUID) -> LithoLayerOrm:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == UUID(geotech_model_id),
                        LithoLayerOrm.cpt_id == cpt_id,
                        LithoLayerOrm.status == "accepted",
                        LithoLayerOrm.depth_top_m > 3.9,
                        LithoLayerOrm.depth_top_m < 4.1,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows, f"GC-4 prereq: no geotech band with top at 4 m on CPT {cpt_id}"
        return rows[0]

    band_d = await _deep_band(cpt_d.id)
    band_e = await _deep_band(cpt_e.id)

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": str(band_d.id),
            "layer_b_id": str(band_e.id),
            "request_section_id": section_id,
        },
    )
    assert resp.status_code in (200, 201), (
        f"GC-4 FAIL: the clay-base surface tie (one shared adjacent body) must be "
        f"allowed, got {resp.status_code}: {resp.text}"
    )


@pytest_asyncio.fixture
async def gc_lens_scene(
    db_session: AsyncSession,
    gc_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Enclosed-lens guard scene (owner ruling 2026-08-12 late evening).

    CPT-L: KLEI 0-3 / SILT 3-5 / KLEI 5-8 — BOTH clays litho-tied to CPT-R's
    single KLEI 0-2, so the resolver wraps one clay body around L's silt: the
    silt is an enclosed lens. CPT-R: KLEI 0-2 / SILT 2-4 / ZAND 4-8; R's silt
    is NOT enclosed (sand below) and NOT tied to L's silt — different bodies.

    The live failure this pins (GEO-10/170-S9 vs GEO-23/125-S10): the shared
    wrapping clay licensed a silt↔silt packing tie via the one-adjacent-match
    rule, and accepting it would have split the clay body in two at the tie.
    """
    pid = str(gc_project.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GC5-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GC5-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_resp.json()["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "GC5-Section",
            "start_x": 148_700.0,
            "start_y": 201_000.0,
            "end_x": 151_200.0,
            "end_y": 201_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    depths, qc = _uniform_qc_series(n=400, qc_mpa=10.0)
    cpts = []
    for name, x in (("CPT-L", 149_000.0), ("CPT-R", 149_500.0)):
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="GC5",
            test_id=f"GC5/{name}",
            app_project_id=gc_project.id,
            location_x=x,
            location_y=201_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=8.0,
        )
        cpt.series = CptSeriesOrm(
            depths_m=depths,
            qc_mpa=qc,
            fs_mpa=[0.05] * len(depths),
            u2_mpa=None,
            rf_pct=None,
            q_total_mpa=None,
        )
        cpts.append(cpt)
    cpt_l, cpt_r = cpts
    db_session.add_all(cpts)
    await db_session.commit()

    l_klei_top = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_l.id), top=0.0, base=3.0, soil="KLEI"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_l.id), top=3.0, base=5.0, soil="SILT"
    )
    l_klei_low = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_l.id), top=5.0, base=8.0, soil="KLEI"
    )
    r_klei = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_r.id), top=0.0, base=2.0, soil="KLEI"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_r.id), top=2.0, base=4.0, soil="SILT"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_r.id), top=4.0, base=8.0, soil="ZAND"
    )

    # Both of L's clays tie to R's single clay: ONE clay body wraps L's silt.
    await _correlate_litho(
        async_client,
        pid,
        litho_model_id,
        contact_a=l_klei_top,
        contact_b=r_klei,
        section_id=section_id,
    )
    await _correlate_litho(
        async_client,
        pid,
        litho_model_id,
        contact_a=l_klei_low,
        contact_b=r_klei,
        section_id=section_id,
    )

    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied pair ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)
    result = await SubdivideAllBodies(db_session).execute(
        project_id=gc_project.id,
        litho_model_id=UUID(litho_model_id),
    )
    assert result.geotech_model_id is not None

    return {
        "project": gc_project,
        "litho_model_id": litho_model_id,
        "geotech_model_id": str(result.geotech_model_id),
        "section_id": section_id,
        "cpt_l_id": str(cpt_l.id),
        "cpt_r_id": str(cpt_r.id),
    }


@pytest.mark.asyncio
async def test_gc5_an_enclosed_lens_cannot_borrow_its_wrapper_as_licence(
    gc_lens_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """GC-5 — a silt lens enclosed in one clay body refuses the silt↔silt tie.

    Owner ruling 2026-08-12 (verbatim): *"the silt in between lenses and is in
    no way connected to the silt on S10, adding this correlation would mean we
    would split the clay body in 2 at this location which is wrong."* The
    wrapping body sits on BOTH sides of the tied horizon, so tying "its"
    surface at a lens boundary would bisect it — an enclosed band's enclosing
    body is dropped from the licensor set. GC-4's surface tie stays allowed:
    there the shared clay does not wrap below the tied sands.
    """
    pid = gc_lens_scene["project"].id
    geotech_model_id = gc_lens_scene["geotech_model_id"]

    async def _silt_band(cpt_id: str) -> LithoLayerOrm:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == UUID(geotech_model_id),
                        LithoLayerOrm.cpt_id == UUID(cpt_id),
                        LithoLayerOrm.status == "accepted",
                    )
                )
            )
            .scalars()
            .all()
        )
        # The silt band is the one whose extent sits inside the silt unit.
        for r in rows:
            if r.depth_top_m >= 1.9 and r.depth_base_m <= 5.1:
                return r
        raise AssertionError(
            f"no silt band found on {cpt_id}: {[(r.depth_top_m, r.depth_base_m) for r in rows]}"
        )

    band_l = await _silt_band(gc_lens_scene["cpt_l_id"])
    band_r = await _silt_band(gc_lens_scene["cpt_r_id"])

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": str(band_l.id),
            "layer_b_id": str(band_r.id),
            "request_section_id": gc_lens_scene["section_id"],
        },
    )
    assert resp.status_code == 422, (
        f"GC-5 FAIL: the wrapping clay licensed a tie that would bisect it — "
        f"got {resp.status_code}: {resp.text}"
    )

    edge = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id),
                    or_(
                        and_(
                            LithoContactCorrelationEdgeOrm.layer_a_id == band_l.id,
                            LithoContactCorrelationEdgeOrm.layer_b_id == band_r.id,
                        ),
                        and_(
                            LithoContactCorrelationEdgeOrm.layer_a_id == band_r.id,
                            LithoContactCorrelationEdgeOrm.layer_b_id == band_l.id,
                        ),
                    ),
                )
            )
        )
        .scalars()
        .first()
    )
    assert edge is None, "GC-5 FAIL: an edge row was committed for the refused lens tie"


@pytest_asyncio.fixture
async def gc_sand_lens_scene(
    db_session: AsyncSession,
    gc_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Big-sand-body-with-a-lens scene (owner dogfeed 2026-08-15).

    CPT-SL: ZAND 0-3 / KLEI 3-5 / ZAND 5-8 — BOTH sands litho-tied to CPT-SR's
    ZAND 0-2, so one sand body wraps SL's clay: the clay is an enclosed lens in
    the sand. CPT-SR: ZAND 0-2 / KLEI 2-4 / SILT 4-8.

    This is the mirror of ``gc_lens_scene``: there the tied band IS the enclosed
    lens, here the tied band is the big body that DOES the enclosing. The live
    failure this pins (ZAND NAD 8 on GEO-10/170-S10 ↔ ZAND NAD 8 on
    GEO-23/125-S6): *"it is one big geometrically connected body only with a
    clay and silt lens in it"* — both sands sit in litho body
    ``019ea3e1-9bde-73ae-9263-60ae571bcdfd`` and the tie was refused anyway.
    """
    pid = str(gc_project.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GC6-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GC6-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_resp.json()["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "GC6-Section",
            "start_x": 148_700.0,
            "start_y": 202_000.0,
            "end_x": 151_200.0,
            "end_y": 202_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    depths, qc = _uniform_qc_series(n=400, qc_mpa=10.0)
    cpts = []
    for name, x in (("CPT-SL", 149_000.0), ("CPT-SR", 149_500.0)):
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="GC6",
            test_id=f"GC6/{name}",
            app_project_id=gc_project.id,
            location_x=x,
            location_y=202_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=8.0,
        )
        cpt.series = CptSeriesOrm(
            depths_m=depths,
            qc_mpa=qc,
            fs_mpa=[0.05] * len(depths),
            u2_mpa=None,
            rf_pct=None,
            q_total_mpa=None,
        )
        cpts.append(cpt)
    cpt_sl, cpt_sr = cpts
    db_session.add_all(cpts)
    await db_session.commit()

    sl_zand_top = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_sl.id), top=0.0, base=3.0, soil="ZAND"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_sl.id), top=3.0, base=5.0, soil="KLEI"
    )
    sl_zand_low = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_sl.id), top=5.0, base=8.0, soil="ZAND"
    )
    sr_zand = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_sr.id), top=0.0, base=2.0, soil="ZAND"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_sr.id), top=2.0, base=4.0, soil="KLEI"
    )
    await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_sr.id), top=4.0, base=8.0, soil="SILT"
    )

    # Both of SL's sands tie to SR's single sand: ONE sand body wraps SL's clay.
    await _correlate_litho(
        async_client,
        pid,
        litho_model_id,
        contact_a=sl_zand_top,
        contact_b=sr_zand,
        section_id=section_id,
    )
    await _correlate_litho(
        async_client,
        pid,
        litho_model_id,
        contact_a=sl_zand_low,
        contact_b=sr_zand,
        section_id=section_id,
    )

    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied pair ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)
    result = await SubdivideAllBodies(db_session).execute(
        project_id=gc_project.id,
        litho_model_id=UUID(litho_model_id),
    )
    assert result.geotech_model_id is not None

    return {
        "project": gc_project,
        "litho_model_id": litho_model_id,
        "geotech_model_id": str(result.geotech_model_id),
        "section_id": section_id,
        "cpt_sl_id": str(cpt_sl.id),
        "cpt_sr_id": str(cpt_sr.id),
    }


@pytest.mark.asyncio
async def test_gc6_a_band_keeps_the_body_its_own_unit_sits_in(
    gc_sand_lens_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """GC-6 — a sand↔sand tie under an enclosed lens must be allowed.

    Owner dogfeed (verbatim): *"still can't correlate properly (ZAND (NAD 8) on
    GEO-10/170-S10 and ZAND (NAD 8) on GEO-23/125-S6 are in different litho
    bodies) ... even though it is one big geometrically connected body only
    with a clay and silt lens in it."*

    The tied band's own unit sits in the big sand body. The clay lens directly
    above it is enclosed BY that same sand body, so the enclosed-lens rule
    (GC-5) withdrew the sand as licence — cancelling the very body the tied
    band belongs to in its own right, and refusing a tie inside one body.
    """
    pid = gc_sand_lens_scene["project"].id
    geotech_model_id = gc_sand_lens_scene["geotech_model_id"]

    async def _band_with_top(cpt_id: str, top_min: float, top_max: float) -> LithoLayerOrm:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == UUID(geotech_model_id),
                        LithoLayerOrm.cpt_id == UUID(cpt_id),
                        LithoLayerOrm.status == "accepted",
                        LithoLayerOrm.depth_top_m >= top_min,
                        LithoLayerOrm.depth_top_m <= top_max,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows, (
            f"GC-6 prereq: no geotech band with top in [{top_min}, {top_max}] on CPT {cpt_id}"
        )
        return rows[0]

    # SL's LOWER sand band — the lens sits directly above it.
    band_sl = await _band_with_top(gc_sand_lens_scene["cpt_sl_id"], 4.9, 5.1)
    # SR's sand band — same sand body, no lens involved.
    band_sr = await _band_with_top(gc_sand_lens_scene["cpt_sr_id"], -0.1, 0.5)

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": str(band_sl.id),
            "layer_b_id": str(band_sr.id),
            "request_section_id": gc_sand_lens_scene["section_id"],
        },
    )
    assert resp.status_code in (200, 201), (
        f"GC-6 FAIL: a sand↔sand tie inside ONE sand body was refused because a "
        f"clay lens enclosed by that same sand sits above the tied band — "
        f"got {resp.status_code}: {resp.text}"
    )
