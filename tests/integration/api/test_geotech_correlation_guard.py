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
            "contact_a_id": contact_a,
            "contact_b_id": contact_b,
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
            "contact_a_id": ga_id,
            "contact_b_id": gb_id,
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
                            LithoContactCorrelationEdgeOrm.contact_a_id == layer_a.id,
                            LithoContactCorrelationEdgeOrm.contact_b_id == layer_b.id,
                        ),
                        and_(
                            LithoContactCorrelationEdgeOrm.contact_a_id == layer_b.id,
                            LithoContactCorrelationEdgeOrm.contact_b_id == layer_a.id,
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
            "contact_a_id": ga_id,
            "contact_b_id": gc_id,
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
                LithoContactCorrelationEdgeOrm.contact_a_id == layer_a.id,
                LithoContactCorrelationEdgeOrm.contact_b_id == layer_c.id,
            ),
            and_(
                LithoContactCorrelationEdgeOrm.contact_a_id == layer_c.id,
                LithoContactCorrelationEdgeOrm.contact_b_id == layer_a.id,
            ),
        ),
    )
    cross_edge = (await db_session.execute(stmt_cross_edge)).scalars().first()
    assert cross_edge is None, (
        f"GC-3 FAIL: an edge row was committed for the rejected cross-body pair "
        f"(CPT-A geotech {layer_a.id} ↔ CPT-C geotech {layer_c.id})"
    )
