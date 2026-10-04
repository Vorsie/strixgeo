"""Integration tests for geotech voxel build watertightness (Task 6 — GVW gate).

Scenario
--------
Three CPTs form a non-collinear triangle; a borehole sits inside it::

    CPT-A  (0, 0) :  ZAND dense 0–8 m
    CPT-B  (20, 0):  ZAND dense 0–4 m  /  KLEI soft 4–8 m
    CPT-C  (10, 20): ZAND dense 0–8 m
    BH-1   (10, 4):  ZAND 0–4 m  /  KLEI 4–8 m   ← inside the CPT triangle

All investigations sit at surface elevation 1.0 m (depth → elevation: d m →
(1 − d) m).

Litho correlations::

    CPT-A ZAND ↔ CPT-B ZAND ↔ CPT-C ZAND ↔ BH-1 ZAND  →  one ZAND body
    CPT-B KLEI ↔ BH-1 KLEI                              →  one KLEI body

After ``SubdivideAllBodies`` the CPT-B KLEI geotech layer has ``body_id=K``.
The geotech edge derived from the litho KLEI edge (CPT-B↔BH-1) connects BH-1's
KLEI skeleton layer into the same body.  ``DivideBoreholes`` then replaces the
skeleton with a real conservative-KLEI band; ``assign_borehole_band_body`` finds
CPT-B's KLEI band with ``body_id=K`` and stamps it on BH-1's new layer.

Voxel build partition
~~~~~~~~~~~~~~~~~~~~~
Two-section ZAND-only partition (section A→B, section B→C) — no KLEI regions
at all.  At BH-1's ``(x=10, y=5)`` column the honour-borehole mechanism
overrides the ZAND label with KLEI for the 4–8 m depth range, because BH-1's
KLEI layer now carries ``body_id=K`` and ``load_body_picks`` returns it.

Cases
-----
GVW-1  Happy path — every ``LithoBodySolidOrm`` in the geotech model is
       ``is_flagged=False`` / ``method='voxel'``; no two bodies overlap over
       a footprint sample grid.
GVW-2  Honour-borehole wins over the ZAND partition — at BH-1's ``(10, 4)``
       within the KLEI depth range (elevation −5 m, mid of 4–8 m) the built
       solid carries a KLEI-family formation (``litho_main_soil_code='KLEI'``),
       never a ZAND-family one.
GVW-3  Away from BH-1 and CPT-B the partition drives the label — at an
       interior sample not collocated with any investigation the solid
       formation is ZAND-family.
GVW-4  The KLEI body materialises as a persisted solid — the geotech model's
       ``LithoBodySolidOrm`` table contains at least one row whose formation
       has ``litho_main_soil_code='KLEI'``.

Run via::

    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_geotech_voxel_watertight.py
"""

from __future__ import annotations

import math
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
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import paint_accepted_ties
from tests.unit.domain.services.voxel_litho.strat_invariants import (
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# ---------------------------------------------------------------------------
# Coordinates (small Cartesian; EPSG tag is stored but not range-validated)
# ---------------------------------------------------------------------------

_ELEV_M = 1.0  # surface elevation for all investigations
_CPT_A_X, _CPT_A_Y = 0.0, 0.0
_CPT_B_X, _CPT_B_Y = 20.0, 0.0
_CPT_C_X, _CPT_C_Y = 10.0, 20.0
_BH_X, _BH_Y = 10.0, 4.0  # on a 2 m grid node, inside the A-B-C triangle

# Section A→B length and B→C length (along-values for the partition payload)
_AB_M = 20.0
_BC_M = math.sqrt((_CPT_C_X - _CPT_B_X) ** 2 + (_CPT_C_Y - _CPT_B_Y) ** 2)


# ---------------------------------------------------------------------------
# Scene helpers (adapted from test_divide_boreholes_litho_confined.py)
# ---------------------------------------------------------------------------


def _dense_qc(n: int, qc_mpa: float = 22.0) -> tuple[list[float], list[float]]:
    """Uniform dense qc series at 2 cm spacing.

    Parameters
    ----------
    n : int
        Number of depth samples.
    qc_mpa : float
        Cone resistance value (MPa) for every sample.

    Returns
    -------
    tuple[list[float], list[float]]
        ``(depths_m, qc_mpa_list)`` at 0.02 m spacing.
    """
    depths = [round(i * 0.02, 3) for i in range(n)]
    return depths, [qc_mpa] * n


def _two_layer_qc(
    n_top: int, n_bot: int, qc_top: float, qc_bot: float
) -> tuple[list[float], list[float]]:
    """Two-zone qc series (top zone / bottom zone) at 2 cm spacing.

    Parameters
    ----------
    n_top : int
        Samples in the top zone.
    n_bot : int
        Samples in the bottom zone.
    qc_top : float
        Cone resistance (MPa) in the top zone.
    qc_bot : float
        Cone resistance (MPa) in the bottom zone.

    Returns
    -------
    tuple[list[float], list[float]]
        ``(depths_m, qc_mpa_list)`` with samples at 0.02 m spacing.
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
    soil: str,
) -> str:
    """POST one CPT litho suggestion acceptance; return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    cpt_id : str
        CPT investigation id.
    top : float
        Layer top depth (m).
    base : float
        Layer base depth (m).
    soil : str
        Main soil code (e.g. ``'ZAND'``, ``'KLEI'``).

    Returns
    -------
    str
        Created formation-contact id.
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
    soil: str,
) -> str:
    """POST one borehole litho suggestion acceptance; return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    borehole_id : str
        Borehole investigation id.
    top : float
        Layer top depth (m).
    base : float
        Layer base depth (m).
    soil : str
        Main soil code.

    Returns
    -------
    str
        Created formation-contact id.
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
    """POST a litho correlation edge between two accepted contacts.

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
        Section on which the edge is authored.
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
async def gvw_project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for the GVW geotech-voxel-watertight tests."""
    proj = ProjectOrm(id=uuid7(), name="GVW geotech voxel test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def gvw_scene(
    db_session: AsyncSession,
    gvw_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """CS1-geotech scene: ZAND CPTs flanking a ZAND/KLEI CPT and borehole.

    Layout::

        CPT-A (0, 0)    CPT-B (20, 0)    CPT-C (10, 20)
        ZAND 0–8 m      ZAND 0–4 m       ZAND 0–8 m
        dense qc=22     dense top / soft  dense qc=22
                        KLEI 4–8 m

        BH-1 (10, 4) inside the triangle:
        ZAND 0–4 m / KLEI 4–8 m

    Litho correlations build two bodies::

        ZAND body: CPT-A ↔ CPT-B(ZAND) ↔ CPT-C ↔ BH-1(ZAND)
        KLEI body: CPT-B(KLEI) ↔ BH-1(KLEI)

    Having CPT-B in the KLEI body means ``DivideBoreholes`` can assign
    ``body_id`` to BH-1's KLEI layers, making them eligible for the
    honour-borehole override in the voxel build.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_id``,
        ``cpt_a_id``, ``cpt_b_id``, ``cpt_c_id``, ``bh_1_id``.
    """
    pid = str(gvw_project.id)

    # Geo model (no surfaces — geo-bounding is a no-op in this test).
    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GVW-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    # Litho model parented to the geo model.
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GVW-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # One section large enough to cover all four investigations (buffer=25 m
    # brings CPT-C at y=20 inside the projection window).
    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "GVW-Section",
            "start_x": -2.0,
            "start_y": 0.0,
            "end_x": 22.0,
            "end_y": 0.0,
            "epsg": 31370,
            "projection_buffer_m": 25.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # CPT-A: ZAND dense 0–8 m (400 samples at 2 cm).
    depths_8m, qc_dense = _dense_qc(400, qc_mpa=22.0)
    cpt_a = CptOrm(
        id=uuid7(),
        name="GVW-CPT-A",
        cpt_type="CPTU",
        project_id="GVW",
        test_id="GVW/CPT-A",
        app_project_id=gvw_project.id,
        location_x=_CPT_A_X,
        location_y=_CPT_A_Y,
        elevation_m=_ELEV_M,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_a.series = CptSeriesOrm(
        depths_m=depths_8m,
        qc_mpa=qc_dense,
        fs_mpa=[0.05] * 400,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-B: dense ZAND 0–4 m / soft KLEI 4–8 m (200 + 200 samples).
    depths_b, qc_b = _two_layer_qc(n_top=200, n_bot=200, qc_top=20.0, qc_bot=0.5)
    cpt_b = CptOrm(
        id=uuid7(),
        name="GVW-CPT-B",
        cpt_type="CPTU",
        project_id="GVW",
        test_id="GVW/CPT-B",
        app_project_id=gvw_project.id,
        location_x=_CPT_B_X,
        location_y=_CPT_B_Y,
        elevation_m=_ELEV_M,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_b.series = CptSeriesOrm(
        depths_m=depths_b,
        qc_mpa=qc_b,
        fs_mpa=[0.05] * 400,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-C: ZAND dense 0–8 m, off the A-B axis → non-collinear triangle.
    cpt_c = CptOrm(
        id=uuid7(),
        name="GVW-CPT-C",
        cpt_type="CPTU",
        project_id="GVW",
        test_id="GVW/CPT-C",
        app_project_id=gvw_project.id,
        location_x=_CPT_C_X,
        location_y=_CPT_C_Y,
        elevation_m=_ELEV_M,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_c.series = CptSeriesOrm(
        depths_m=depths_8m,
        qc_mpa=qc_dense,
        fs_mpa=[0.05] * 400,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # BH-1: ZAND 0–4 m / KLEI 4–8 m — inside the CPT triangle.
    bh_1 = BoreholeOrm(
        id=uuid7(),
        name="GVW-BH-1",
        app_project_id=gvw_project.id,
        project_id="GVW",
        test_id="GVW/BH-1",
        location_x=_BH_X,
        location_y=_BH_Y,
        elevation_m=_ELEV_M,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )

    db_session.add_all([cpt_a, cpt_b, cpt_c, bh_1])
    await db_session.commit()

    # Accept litho contacts ------------------------------------------------

    # CPT-A: ZAND 0–8 m (one layer)
    c_a_zand = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_a.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )

    # CPT-B: ZAND 0–4 m + KLEI 4–8 m
    c_b_zand = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_b.id),
        top=0.0,
        base=4.0,
        soil="ZAND",
    )
    c_b_klei = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_b.id),
        top=4.0,
        base=8.0,
        soil="KLEI",
    )

    # CPT-C: ZAND 0–8 m
    c_c_zand = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_c.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )

    # BH-1: ZAND 0–4 m + KLEI 4–8 m
    c_bh_zand = await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_1.id),
        top=0.0,
        base=4.0,
        soil="ZAND",
    )
    c_bh_klei = await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_1.id),
        top=4.0,
        base=8.0,
        soil="KLEI",
    )

    # Correlations ---------------------------------------------------------
    # ZAND body: CPT-A ↔ CPT-B(ZAND) ↔ CPT-C ↔ BH-1(ZAND)
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=c_a_zand,
        contact_b=c_b_zand,
        section_id=section_id,
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=c_a_zand,
        contact_b=c_c_zand,
        section_id=section_id,
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=c_a_zand,
        contact_b=c_bh_zand,
        section_id=section_id,
    )
    # KLEI body: CPT-B KLEI ↔ BH-1 KLEI (gives BH-1 a reachable body_id)
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=c_b_klei,
        contact_b=c_bh_klei,
        section_id=section_id,
    )

    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied chain ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project": gvw_project,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_a_id": str(cpt_a.id),
        "cpt_b_id": str(cpt_b.id),
        "cpt_c_id": str(cpt_c.id),
        "bh_1_id": str(bh_1.id),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _full_gap_region(
    formation_id: str, body_id: str, top: float, base: float, gap_index: int = 0
) -> dict:
    """Full-width rectangular region spanning the gap at [base, top] elevation.

    Parameters
    ----------
    formation_id : str
        Geotech formation UUID (string).
    body_id : str
        Resolver body UUID (string).
    top : float
        Top elevation (m, higher value).
    base : float
        Base elevation (m, lower value).
    gap_index : int
        Gap index within the section (0 for the only gap in a 2-column section).

    Returns
    -------
    dict
        Region dict in the voxel-build snake_case API shape.
    """
    return {
        "formation_id": formation_id,
        "body_id": body_id,
        "polygon": [[0.0, top], [1.0, top], [1.0, base], [0.0, base]],
        "gap_index": gap_index,
    }


class _MeshView:
    """Minimal duck-type mesh view for geometry invariant helpers.

    The strat-invariant helpers (``assert_no_overlap_sampled``,
    ``vertical_ray_intervals``) read ``body_id``, ``formation_id``,
    ``vertices``, and ``triangles`` via attribute access.

    Parameters
    ----------
    body_id : str
        Resolver body UUID.
    formation_id : str
        Geotech formation UUID.
    vertices : list[tuple[float, float, float]]
        Mesh vertex list ``(x, y, z)``.
    triangles : list[tuple[int, int, int]]
        Triangle index triples.
    """

    def __init__(
        self,
        body_id: str,
        formation_id: str,
        vertices: list[tuple[float, float, float]],
        triangles: list[tuple[int, int, int]],
    ) -> None:
        self.body_id = body_id
        self.formation_id = formation_id
        self.vertices = vertices
        self.triangles = triangles


def _formation_covering(meshes: list[_MeshView], x: float, y: float, elev: float) -> str | None:
    """Ray-cast the meshes at ``(x, y)``; return the formation covering ``elev``.

    Parameters
    ----------
    meshes : list[_MeshView]
        Built solid meshes.
    x : float
        World x-coordinate (m).
    y : float
        World y-coordinate (m).
    elev : float
        Elevation to test (m).

    Returns
    -------
    str | None
        ``formation_id`` of the first covering body, or ``None`` if the
        query point falls outside every mesh's footprint.
    """
    for m in meshes:
        for base, top in vertical_ray_intervals(m.vertices, m.triangles, x, y):
            if base - 1e-6 <= elev <= top + 1e-6:
                return m.formation_id
    return None


def _voxel_url(project_id: UUID, model_id: UUID) -> str:
    """Build-voxel endpoint URL for a (project, model) pair."""
    return f"/projects/{project_id}/geology/models/{model_id}/litho-solids/build-voxel"


# ---------------------------------------------------------------------------
# GVW-1 through GVW-4 — all assertions in one test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_geotech_voxel_watertight(
    gvw_scene: dict,
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """GVW-1 through GVW-4: geotech voxel build honours borehole clay against ZAND partition.

    GVW-1  Watertight — no flagged solids, no inter-body overlap.
    GVW-2  Honour-borehole wins — KLEI family at BH-1 KLEI depth (elevation −5 m).
    GVW-3  Partition drives label elsewhere — ZAND family away from investigations.
    GVW-4  KLEI solid persists — at least one KLEI-family row in the geotech
           model's ``LithoBodySolidOrm`` table.
    """
    project = gvw_scene["project"]
    litho_model_id = UUID(gvw_scene["litho_model_id"])
    cpt_a_id = UUID(gvw_scene["cpt_a_id"])

    # -------------------------------------------------------------------
    # Phase 1: SubdivideAllBodies → geotech model + CPT geotech layers
    # -------------------------------------------------------------------
    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = sab_result.geotech_model_id

    # -------------------------------------------------------------------
    # Phase 2: DivideBoreholes → BH-1 KLEI bands get body_id from CPT-B
    # -------------------------------------------------------------------
    db_result = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    assert db_result.layer_count >= 1, (
        f"DivideBoreholes must write ≥1 borehole layer; got {db_result.layer_count}"
    )

    # -------------------------------------------------------------------
    # Phase 3: query the geotech model for a ZAND formation + body to
    # use in the hand-authored partition payload.
    # CPT-A has dense ZAND 0–8 m → its geotech layer is ZAND-family.
    # -------------------------------------------------------------------
    cpt_a_layer = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id == cpt_a_id,
                    LithoLayerOrm.status == "accepted",
                    LithoLayerOrm.body_id.is_not(None),
                )
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    assert cpt_a_layer is not None, (
        "CPT-A must have an accepted, body-resolved geotech layer after SAB"
    )

    zand_fid = str(cpt_a_layer.formation_id)
    zand_body_id = str(cpt_a_layer.body_id)

    # -------------------------------------------------------------------
    # Phase 4: hand-author a ZAND-only 2-D section partition.
    #
    # Two sections form the triangle domain hull:
    #   Section 0: CPT-A (0, 0) → CPT-B (20, 0)
    #   Section 1: CPT-B (20, 0) → CPT-C (10, 20)
    #
    # BH-1 (10, 4) is NOT a section column.  The honour-borehole mechanism
    # overrides the ZAND label at (10, 4) in the KLEI depth range because
    # BH-1's KLEI layer now carries body_id (via DivideBoreholes).
    #
    # Elevation arithmetic (surface = 1.0 m):
    #   depth 0–8 m  →  elevation 1.0 to −7.0 m
    # -------------------------------------------------------------------
    top_elev = _ELEV_M  # 1.0 m
    base_elev = _ELEV_M - 8.0  # −7.0 m

    col_a = {
        "investigation_id": gvw_scene["cpt_a_id"],
        "along_m": 0.0,
        "world_x": _CPT_A_X,
        "world_y": _CPT_A_Y,
    }
    col_b = {
        "investigation_id": gvw_scene["cpt_b_id"],
        "along_m": _AB_M,
        "world_x": _CPT_B_X,
        "world_y": _CPT_B_Y,
    }
    col_c = {
        "investigation_id": gvw_scene["cpt_c_id"],
        "along_m": _BC_M,
        "world_x": _CPT_C_X,
        "world_y": _CPT_C_Y,
    }

    section_0 = {
        "start_x": _CPT_A_X,
        "start_y": _CPT_A_Y,
        "end_x": _CPT_B_X,
        "end_y": _CPT_B_Y,
        "columns": [col_a, col_b],
        "regions": [
            _full_gap_region(zand_fid, zand_body_id, top_elev, base_elev, gap_index=0),
        ],
    }
    section_1 = {
        "start_x": _CPT_B_X,
        "start_y": _CPT_B_Y,
        "end_x": _CPT_C_X,
        "end_y": _CPT_C_Y,
        "columns": [col_b, col_c],
        "regions": [
            _full_gap_region(zand_fid, zand_body_id, top_elev, base_elev, gap_index=0),
        ],
    }
    payload = {
        "sections": [section_0, section_1],
        # Coarse grid: 2 m horizontal, 0.5 m vertical → fast build on CI.
        "grid_spacing_m": 2.0,
        "horizontal_spacing_m": 2.0,
        "vertical_spacing_m": 0.5,
    }

    # -------------------------------------------------------------------
    # Phase 5: POST the build-voxel endpoint on the GEOTECH model id.
    # -------------------------------------------------------------------
    resp = await async_client.post(_voxel_url(project.id, geotech_model_id), json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # GVW-1a: no flagged bodies in the response.
    assert body["bodies_flagged"] == 0, (
        f"GVW-1: bodies_flagged must be 0; got {body['bodies_flagged']}"
    )
    assert body["bodies_built"] >= 1, (
        f"GVW-1: at least 1 body must be built; got {body['bodies_built']}"
    )

    # -------------------------------------------------------------------
    # Load persisted rows from the DB (source of truth for geometry checks)
    # -------------------------------------------------------------------
    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == geotech_model_id)
            )
        )
        .scalars()
        .all()
    )

    # GVW-1c: the aggregated ZAND body is ONE connected solid across both
    # gaps (A→B and B→C share the same zand_body_id), not two fragments.
    zand_solid_rows = [r for r in rows if str(r.body_id) == zand_body_id]
    assert len(zand_solid_rows) == 1, (
        f"GVW-1: the ZAND body must produce exactly one connected solid across "
        f"both sections; got {len(zand_solid_rows)} rows for body_id={zand_body_id}"
    )

    # GVW-1b: every persisted row is a real, non-flagged voxel solid.
    for row in rows:
        assert row.is_flagged is False, f"GVW-1: solid {row.id} must not be flagged"
        assert row.method == "voxel", (
            f"GVW-1: solid {row.id} must use method='voxel'; got {row.method!r}"
        )
        assert len(row.vertices) > 0 and len(row.triangles) > 0, (
            f"GVW-1: solid {row.id} must have non-empty geometry"
        )

    meshes = [
        _MeshView(
            body_id=str(r.body_id),
            formation_id=str(r.formation_id),
            vertices=[tuple(v) for v in r.vertices],
            triangles=[tuple(t) for t in r.triangles],
        )
        for r in rows
    ]

    # GVW-1c: no inter-body overlap over a footprint sample grid.
    # Sample inside the domain away from investigation columns and seam lines.
    # Stay on 2 m grid nodes inside the domain, away from investigation cells
    # (CPT-A (0,0), CPT-B (20,0), CPT-C (10,20), BH-1 (10,4)).
    overlap_samples = [(float(x), float(y)) for x in (4.0, 10.0, 16.0) for y in (2.0, 10.0)]
    assert_no_overlap_sampled(meshes, overlap_samples)

    # -------------------------------------------------------------------
    # Load formation rows to check litho_main_soil_code per solid.
    # -------------------------------------------------------------------
    formation_ids_in_model = {r.formation_id for r in rows}
    formations_by_id: dict[UUID, GeologicalFormationOrm] = {
        f.id: f
        for f in (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.id.in_(formation_ids_in_model)
                )
            )
        )
        .scalars()
        .all()
    }

    def _soil_code_at(x: float, y: float, elev: float) -> str | None:
        """Return litho_main_soil_code of the solid covering (x, y, elev)."""
        fid_str = _formation_covering(meshes, x, y, elev)
        if fid_str is None:
            return None
        fid = UUID(fid_str)
        formation = formations_by_id.get(fid)
        return formation.litho_main_soil_code if formation else None

    # GVW-2: honour-borehole wins at BH-1's KLEI depth.
    # BH-1 KLEI 4–8 m → elevation (1 − 4) = −3 m to (1 − 8) = −7 m.
    # Sample mid-band at elevation −5 m.
    klei_check_elev = _ELEV_M - 6.0  # −5.0 m
    soil_at_bh_klei = _soil_code_at(_BH_X, _BH_Y, klei_check_elev)
    assert soil_at_bh_klei == "KLEI", (
        f"GVW-2: at BH-1 ({_BH_X}, {_BH_Y}) elev={klei_check_elev} m "
        f"expected KLEI-family solid; got litho_main_soil_code={soil_at_bh_klei!r}. "
        f"The honour-borehole mechanism must override the ZAND partition."
    )

    # GVW-3: away from all investigations the partition drives the label.
    # Grid cell (4, 2) is strictly inside the domain triangle and not the
    # nearest grid node for any investigation — should be ZAND.
    soil_away = _soil_code_at(4.0, 2.0, klei_check_elev)
    assert soil_away == "ZAND", (
        f"GVW-3: at (4.0, 2.0) elev={klei_check_elev} m expected ZAND-family solid "
        f"(partition-driven); got litho_main_soil_code={soil_away!r}"
    )

    # GVW-4: at least one KLEI-family row persists in the geotech model.
    klei_formation_ids = {
        fid for fid, f in formations_by_id.items() if f.litho_main_soil_code == "KLEI"
    }
    klei_solid_rows = [r for r in rows if r.formation_id in klei_formation_ids]
    assert len(klei_solid_rows) >= 1, (
        f"GVW-4: at least 1 KLEI-family solid must persist in the geotech model; "
        f"found 0 (formations in model: "
        f"{[f.litho_main_soil_code for f in formations_by_id.values()]})"
    )
