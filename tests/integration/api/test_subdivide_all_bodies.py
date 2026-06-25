"""Integration tests for SubdivideAllBodies (Task E3 + model-wide restructure).

Model-wide assertions: the use case runs once per litho model (not per section).
Geotech layers are written once per investigation; correlation edges are derived
per-section from the litho model's approved edges.

Scene summary
-------------
Three body groups in a shared litho model on a single section:

* **Body A** — two CPTs (CPT-A + CPT-B) + one borehole (BH-A).
  Both CPTs carry a consistent loose-shallow (qc ≈ 3 MPa) / dense-deep
  (qc ≈ 22 MPa) qc profile, so the aggregator returns
  ``consistent=True, band_classes=[<loose>, <dense>]``.
  BH-A is connected to CPT-A via a correlation edge on the shared layer.

* **Body B** — two CPTs (CPT-C + CPT-D) whose NAD sequences disagree:
  CPT-C reads loose throughout; CPT-D reads dense throughout.
  The aggregator returns ``consistent=False, band_classes=[<dominant>]``.
  (One-class body.)

* **Body C** — one borehole (BH-B) with no CPT neighbour in the same body.
  The aggregator returns ``consistent=True, band_classes=[None]``.
  (Borehole-only.)

CPT-A and CPT-B are correlated (a litho edge connects their accepted layers so
the resolver places them in the same body).  CPT-C and CPT-D are similarly
correlated.  BH-B stands alone.

Test assertions
---------------
SAB-1  ``geotech_model_id`` is present in the result.
SAB-2  ``layer_count >= 1``: at least one geotech ``litho_layer`` was inserted.
SAB-3  ``body_count >= 1``: the resolver created at least one geotech body.
SAB-4  ``split_body_count == 1``: exactly Body-A was consistently split.
SAB-5  ``one_class_body_count == 1``: exactly Body-B was one-class.
SAB-6  ``borehole_only_count == 1``: exactly Body-C was borehole-only.
SAB-7  (TRAP 1) same-position-only edges: loose-body geotech layers from CPT-A
       and CPT-B are correlated to EACH OTHER (same position), and dense-body
       layers from CPT-A and CPT-B are correlated to EACH OTHER — never a
       loose layer to a dense layer.
SAB-8  (TRAP 2) formation_contact rows are auto-derived — no FC was manually
       written.  After the call every accepted ``litho_layer`` in the geotech
       model has a matching ``formation_contact`` row with the SAME id.
SAB-9  Tiling invariant: for every in-corridor investigation in the geotech
       model, the accepted layers span the geo-bounded extent with no internal
       gaps (base of layer k == top of layer k+1 within 1 mm).
NC-1   NO-CLOBBER: two sections sharing an investigation; a model-wide run
       produces edges for BOTH sections simultaneously.
BH-E1  BOREHOLE EXTRAPOLATION: a borehole-only body adjacent to a same-
       lithology CPT is extrapolated to that CPT's NAD class.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _qc_series(n: int, qc_mpa: float) -> tuple[list[float], list[float]]:
    """Return (depths_m, qc_mpa) as uniform-interval lists of length *n*.

    Parameters
    ----------
    n : int
        Number of samples.
    qc_mpa : float
        Uniform cone resistance for all samples.

    Returns
    -------
    tuple[list[float], list[float]]
        ``(depths_m, qc_mpa)`` — depths run 0.02 m apart (standard CPT step).
    """
    depths = [round(i * 0.02, 3) for i in range(n)]
    qc = [qc_mpa] * n
    return depths, qc


def _two_layer_qc(
    n_top: int, n_bot: int, qc_top: float, qc_bot: float
) -> tuple[list[float], list[float]]:
    """Return (depths_m, qc_mpa) with a distinct top/bottom packing zone.

    Parameters
    ----------
    n_top : int
        Number of samples in the upper (loose) zone.
    n_bot : int
        Number of samples in the lower (dense) zone.
    qc_top : float
        Cone resistance for the top zone (MPa).
    qc_bot : float
        Cone resistance for the bottom zone (MPa).

    Returns
    -------
    tuple[list[float], list[float]]
        Concatenated depth+qc lists.
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
        Owning project id (string).
    litho_model_id : str
        Litho model id (string).
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
        The created formation-contact id (== litho_layer.id via the trigger).
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
        Owning project id (string).
    litho_model_id : str
        Litho model id (string).
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
        The created formation-contact id (== litho_layer.id via the trigger).
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
    assert len(contacts) >= 1, "Expected at least one contact id from borehole accept"
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
async def sab_project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for SAB tests."""
    proj = ProjectOrm(id=uuid7(), name="SAB test project", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def sab_scene(
    db_session: AsyncSession,
    sab_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Full multi-body scene for SubdivideAllBodies assertions.

    Builds the following scene:
    * Litho model (no geo parent — no geo surfaces, so geo-bounding is a no-op
      and each layer spans its full litho extent).
    * Section covering all investigations.
    * Body-A: CPT-A + CPT-B (both ZAND, two-layer qc: loose top / dense base)
              + BH-A (ZAND, same depth range).
              CPT-A and CPT-B are correlated; BH-A correlated to CPT-A.
    * Body-B: CPT-C (ZAND, uniform low qc — loose throughout)
              + CPT-D (ZAND, uniform high qc — dense throughout).
              CPT-C and CPT-D are correlated.
    * Body-C: BH-B (KLEI, depth 0–8 m) standalone — no cross-investigation edge.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_id``.
    """
    pid = str(sab_project.id)

    # --- geo model (required parent for lithostratigraphic model) ---
    # No surfaces are built so geo-bounding is a no-op — every litho pick
    # spans its full accepted depth range.
    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "SAB-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    # --- litho model (parented to the geo model) ---
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "SAB-Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # --- section covering all four CPTs and two boreholes ---
    # All investigations sit on y=200_000 between x=148_800 and x=150_800.
    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "SAB-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 150_900.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # -----------------------------------------------------------------------
    # Body-A investigations: CPT-A, CPT-B, BH-A
    # Two-layer qc: 0–4 m @ 3 MPa (loose) then 4–8 m @ 22 MPa (dense).
    # 400 samples total (200 top + 200 bottom @ 0.02 m step).
    # Both CPTs have identical profiles so the aggregator returns consistent=True.
    # -----------------------------------------------------------------------
    depths_a, qc_a = _two_layer_qc(n_top=200, n_bot=200, qc_top=3.0, qc_bot=22.0)

    cpt_a = CptOrm(
        id=uuid7(),
        name="CPT-A",
        cpt_type="CPTU",
        project_id="SAB",
        test_id="SAB/CPT-A",
        app_project_id=sab_project.id,
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
        project_id="SAB",
        test_id="SAB/CPT-B",
        app_project_id=sab_project.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_b.series = CptSeriesOrm(
        depths_m=depths_a,
        qc_mpa=qc_a,
        fs_mpa=[0.05] * len(depths_a),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-A",
        app_project_id=sab_project.id,
        project_id="SAB",
        test_id="SAB/BH-A",
        location_x=149_150.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )

    # -----------------------------------------------------------------------
    # Body-B investigations: CPT-C (low qc), CPT-D (high qc)
    # -----------------------------------------------------------------------
    depths_low, qc_low = _qc_series(n=400, qc_mpa=3.0)
    depths_high, qc_high = _qc_series(n=400, qc_mpa=22.0)

    cpt_c = CptOrm(
        id=uuid7(),
        name="CPT-C",
        cpt_type="CPTU",
        project_id="SAB",
        test_id="SAB/CPT-C",
        app_project_id=sab_project.id,
        location_x=149_700.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_c.series = CptSeriesOrm(
        depths_m=depths_low,
        qc_mpa=qc_low,
        fs_mpa=[0.05] * len(depths_low),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_d = CptOrm(
        id=uuid7(),
        name="CPT-D",
        cpt_type="CPTU",
        project_id="SAB",
        test_id="SAB/CPT-D",
        app_project_id=sab_project.id,
        location_x=150_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_d.series = CptSeriesOrm(
        depths_m=depths_high,
        qc_mpa=qc_high,
        fs_mpa=[0.05] * len(depths_high),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # -----------------------------------------------------------------------
    # Body-C investigation: BH-B (KLEI, borehole-only)
    # -----------------------------------------------------------------------
    bh_b = BoreholeOrm(
        id=uuid7(),
        name="BH-B",
        app_project_id=sab_project.id,
        project_id="SAB",
        test_id="SAB/BH-B",
        location_x=150_500.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )

    db_session.add_all([cpt_a, cpt_b, bh_a, cpt_c, cpt_d, bh_b])
    # Commit so the API uses them (separate DI session).
    await db_session.commit()

    # -----------------------------------------------------------------------
    # Accept litho contacts via the API
    # -----------------------------------------------------------------------
    # Body-A CPTs: ZAND 0–8 m
    ca_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_a.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    cb_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_b.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    # Body-A borehole
    bha_id = await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_a.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    # Body-B CPTs: ZAND 0–8 m (same depth, different qc profile doesn't matter for litho)
    cc_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_c.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    cd_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_d.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    # Body-C borehole: KLEI (distinct lithology so it stays a separate body)
    await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_b.id),
        top=0.0,
        base=8.0,
        soil="KLEI",
    )

    # -----------------------------------------------------------------------
    # Correlate contacts (same lithology only → same body after resolver)
    # -----------------------------------------------------------------------
    # Body-A: CPT-A ↔ CPT-B, CPT-A ↔ BH-A
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=ca_id,
        contact_b=cb_id,
        section_id=section_id,
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=ca_id,
        contact_b=bha_id,
        section_id=section_id,
    )
    # Body-B: CPT-C ↔ CPT-D
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=cc_id,
        contact_b=cd_id,
        section_id=section_id,
    )
    # Body-C: BH-B is standalone (no correlations)

    return {
        "project": sab_project,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_a_id": str(cpt_a.id),
        "cpt_b_id": str(cpt_b.id),
        "bh_a_id": str(bh_a.id),
        "cpt_c_id": str(cpt_c.id),
        "cpt_d_id": str(cpt_d.id),
        "bh_b_id": str(bh_b.id),
    }


# ---------------------------------------------------------------------------
# SAB-1 through SAB-9 — all in one test (shared SubdivideAllBodies result)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sab_all(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """SAB-1 through SAB-9: SubdivideAllBodies materialises geotech bodies correctly.

    SAB-1  geotech_model_id is present.
    SAB-2  layer_count >= 1 (at least one geotech litho_layer row inserted).
    SAB-3  body_count >= 1 (resolver created at least one geotech body).
    SAB-4  split_body_count == 1 (Body-A consistently split into two bands).
    SAB-5  one_class_body_count == 1 (Body-B assigned one representative class).
    SAB-6  borehole_only_count == 1 (Body-C is a borehole-only group).
    SAB-7  (TRAP 1) same-position-only edges: no edge connects a loose-band
           layer to a dense-band layer.
    SAB-8  (TRAP 2) every accepted geotech litho_layer has a matching
           formation_contact with the same id (auto-derived, none written directly).
    SAB-9  tiling invariant: for every investigation in the geotech model,
           the accepted layers span continuously (no gap > 1 mm).
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])

    # Execute the use case — model-wide, no section_id.
    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # SAB-1: geotech_model_id is present.
    assert result.geotech_model_id is not None, "SAB-1: geotech_model_id must be set"

    # SAB-2: at least one geotech litho_layer was inserted.
    assert result.layer_count >= 1, f"SAB-2: expected layer_count >= 1, got {result.layer_count}"

    # SAB-3: resolver created at least one geotech body.
    assert result.body_count >= 1, f"SAB-3: expected body_count >= 1, got {result.body_count}"

    # SAB-4: exactly Body-A was consistently split.
    assert result.split_body_count == 1, (
        f"SAB-4: expected split_body_count == 1, got {result.split_body_count}"
    )

    # SAB-5: exactly Body-B was one-class.
    assert result.one_class_body_count == 1, (
        f"SAB-5: expected one_class_body_count == 1, got {result.one_class_body_count}"
    )

    # SAB-6: exactly Body-C was borehole-only.
    assert result.borehole_only_count == 1, (
        f"SAB-6: expected borehole_only_count == 1, got {result.borehole_only_count}"
    )

    geotech_model_id = result.geotech_model_id

    # ------------------------------------------------------------------
    # SAB-4 (idempotency): a second execute() on the same model+section
    # must produce identical DB row counts — no duplicates, no leaks.
    # Query the four mutable row families before the re-run, then assert
    # they match after it.
    # ------------------------------------------------------------------
    def _count(rows):  # noqa: ANN001 — local helper, type is irrelevant
        """Return the length of a scalar .all() result."""
        return len(rows)

    async def _geotech_layer_count() -> int:
        """Return the number of accepted geotech litho_layer rows."""
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.status == "accepted",
                    )
                )
            )
            .scalars()
            .all()
        )
        return _count(rows)

    async def _geotech_edge_count() -> int:
        """Return the number of geotech correlation edge rows."""
        rows = (
            (
                await db_session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return _count(rows)

    async def _geotech_body_count() -> int:
        """Return the number of BodyOrm rows for the geotech model."""
        rows = (
            (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == geotech_model_id)))
            .scalars()
            .all()
        )
        return _count(rows)

    async def _geotech_fc_count() -> int:
        """Return the number of formation_contact rows for the geotech model."""
        rows = (
            (
                await db_session.execute(
                    select(FormationContactOrm).where(
                        FormationContactOrm.model_id == geotech_model_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return _count(rows)

    layers_before = await _geotech_layer_count()
    edges_before = await _geotech_edge_count()
    bodies_before = await _geotech_body_count()
    fcs_before = await _geotech_fc_count()

    # Second execute — must be idempotent.
    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    layers_after = await _geotech_layer_count()
    edges_after = await _geotech_edge_count()
    bodies_after = await _geotech_body_count()
    fcs_after = await _geotech_fc_count()

    assert layers_after == layers_before, (
        f"SAB-4 (idempotency): litho_layer count changed on re-run "
        f"({layers_before} → {layers_after}); re-run must not duplicate rows"
    )
    assert edges_after == edges_before, (
        f"SAB-4 (idempotency): correlation edge count changed on re-run "
        f"({edges_before} → {edges_after}); re-run must not duplicate edges"
    )
    assert bodies_after == bodies_before, (
        f"SAB-4 (idempotency): BodyOrm count changed on re-run "
        f"({bodies_before} → {bodies_after}); re-run must not duplicate bodies"
    )
    assert fcs_after == fcs_before, (
        f"SAB-4 (idempotency): formation_contact count changed on re-run "
        f"({fcs_before} → {fcs_after}); re-run must not duplicate formation_contacts"
    )

    # ------------------------------------------------------------------
    # SAB-7: TRAP 1 — same-position-only correlation edges.
    # The geotech litho_layer rows for CPT-A and CPT-B each split into
    # two bands (loose + dense).  An edge must connect loose-A ↔ loose-B
    # and dense-A ↔ dense-B — but NEVER loose-A ↔ dense-B.
    # We verify by loading all geotech edges and checking that both
    # endpoint layers share the same formation_id (same NAD class = same
    # packing position when the B-policy is consistent).
    # ------------------------------------------------------------------
    geotech_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    layer_formation: dict[UUID, UUID] = {layer.id: layer.formation_id for layer in geotech_layers}

    geotech_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )

    # SAB-7 positive guard: edges must actually exist so the negative
    # assertion below cannot pass vacuously on zero edges.
    assert len(geotech_edges) > 0, (
        "SAB-7 (TRAP 1): no geotech correlation edges were created — "
        "CPT-A ↔ CPT-B same-position edges must exist after a consistent split"
    )

    cross_position_edges = [
        edge
        for edge in geotech_edges
        if layer_formation.get(edge.contact_a_id) != layer_formation.get(edge.contact_b_id)
    ]
    assert len(cross_position_edges) == 0, (
        f"SAB-7 (TRAP 1): {len(cross_position_edges)} cross-position edge(s) found — "
        f"each edge must connect same-NAD-class layers only. "
        f"Offending edges: {[str(e.id) for e in cross_position_edges]}"
    )

    # SAB-7 over-merge guard: the consistent-split body (Body-A, CPT-A
    # and CPT-B) must resolve into ≥2 distinct body_id values across its
    # geotech litho_layer rows (loose band → body X, dense band → body Y).
    # A single shared body_id would mean the loose and dense sub-units were
    # merged by the resolver — the over-merge that same-position-only edges
    # must prevent.
    cpt_a_uuid = UUID(sab_scene["cpt_a_id"])
    cpt_b_uuid = UUID(sab_scene["cpt_b_id"])
    body_a_layers = [layer for layer in geotech_layers if layer.cpt_id in (cpt_a_uuid, cpt_b_uuid)]
    body_a_body_ids = [layer.body_id for layer in body_a_layers if layer.body_id is not None]
    assert len(set(body_a_body_ids)) >= 2, (
        f"SAB-7 (over-merge guard): Body-A geotech layers for CPT-A and CPT-B "
        f"resolve to only {len(set(body_a_body_ids))} distinct body_id(s) "
        f"(expected ≥ 2 — one per packing band). "
        f"body_ids={[str(b) for b in body_a_body_ids]}"
    )

    # ------------------------------------------------------------------
    # SAB-8: TRAP 2 — every accepted geotech litho_layer has a matching
    # formation_contact with the same id (auto-derived by LL→FC trigger;
    # none written directly by the use case).
    # ------------------------------------------------------------------
    fc_ids: set[UUID] = {
        row.id
        for row in (
            (
                await db_session.execute(
                    select(FormationContactOrm).where(
                        FormationContactOrm.model_id == geotech_model_id,
                    )
                )
            )
            .scalars()
            .all()
        )
    }

    missing_fc = [layer.id for layer in geotech_layers if layer.id not in fc_ids]
    assert len(missing_fc) == 0, (
        f"SAB-8 (TRAP 2): {len(missing_fc)} geotech litho_layer row(s) have no matching "
        f"formation_contact (LL→FC trigger failed or FC was manually written and then not "
        f"matched). Missing layer ids: {[str(lid) for lid in missing_fc]}"
    )

    # ------------------------------------------------------------------
    # SAB-9: tiling invariant — for every investigation's accepted geotech
    # layers, the intervals span continuously (base[k] == top[k+1] ± 1 mm).
    # ------------------------------------------------------------------
    # Group layers by investigation.

    layers_by_inv: dict[UUID, list[LithoLayerOrm]] = defaultdict(list)
    for layer in geotech_layers:
        inv_id = layer.borehole_id if layer.borehole_id is not None else layer.cpt_id
        if inv_id is not None:
            layers_by_inv[inv_id].append(layer)

    tolerance = 0.001  # 1 mm — matches the contiguity trigger threshold
    gaps_found: list[str] = []
    for inv_id, inv_layers in layers_by_inv.items():
        sorted_layers = sorted(inv_layers, key=lambda ll: ll.depth_top_m)
        for i in range(1, len(sorted_layers)):
            prev_base = sorted_layers[i - 1].depth_base_m
            curr_top = sorted_layers[i].depth_top_m
            if abs(prev_base - curr_top) > tolerance:
                gaps_found.append(
                    f"inv={inv_id}: "
                    f"layer[{i - 1}].base={prev_base:.4f} "
                    f"!= layer[{i}].top={curr_top:.4f} "
                    f"(gap={abs(prev_base - curr_top):.4f} m)"
                )
    assert len(gaps_found) == 0, f"SAB-9: {len(gaps_found)} tiling gap(s) found:\n" + "\n".join(
        gaps_found
    )


# ---------------------------------------------------------------------------
# C1 regression — geo-band group-local layer map
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def geo_band_scene(db_session: AsyncSession) -> dict:
    """Scene for the C1 geo-band group-isolation regression test.

    Geometry
    --------
    One flat geological surface at absolute elevation 0.0 m (the top of
    formation ``Q_DEEP``).  Both CPTs sit at surface elevation 5.0 m, so the
    geo boundary falls at depth 5.0 m below surface.

    * **CPT-X** at x=149 000 m: one ZAND litho layer 0–10 m spanning BOTH
      geo bands (0–5 m above-boundary band and 5–10 m Q_DEEP band).
      ``divide_picks_by_geology`` splits it into two geo-band segments, which
      become two distinct body groups in the use case.
    * **CPT-Y** at x=149 300 m: identical profile.  Correlated to CPT-X so
      both belong to the same litho body before the split, but after
      ``divide_picks_by_geology`` they each contribute one segment to each of
      the two geo-band groups.

    Without the C1 fix, the global ``layer_id_by_inv_pos`` accumulator would
    let the second geo-band group (Q_DEEP) overwrite the first group's
    position-k entries for CPT-X and CPT-Y, causing ``_insert_geotech_edges``
    to look up the Q_DEEP layers when wiring the above-boundary group's edges.

    With the fix, each group carries only its own layers and the edges in each
    group reference only that group's layers.

    Returns
    -------
    dict
        Keys: ``project``, ``geo_model``, ``litho_model``, ``section``,
        ``cpt_x_id``, ``cpt_y_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="C1 geo-band regression", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Geo-GBR",
        kind="geological",
        is_active=True,
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho-GBR",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
        is_active=True,
    )
    db_session.add_all([geo_model, litho_model])
    await db_session.flush()

    # Geological formation whose top surface cuts at absolute elevation 0.0 m
    # → depth 5.0 m below the 5.0 m surface elevation on both CPTs.
    geo_deep = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Q_DEEP_GBR",
        color="#999999",
        display_order=1,
    )
    # Litho formation: ZAND (in BASE_LITHOLOGIES → CPT segmenter runs).
    f_zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND_GBR",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
    )
    db_session.add_all([geo_deep, f_zand])
    await db_session.flush()

    # Flat geo surface at absolute elevation 0.0 m covering the corridor.
    surface_verts = [
        [148000.0, 199000.0, 0.0],
        [150500.0, 199000.0, 0.0],
        [150500.0, 201000.0, 0.0],
        [148000.0, 201000.0, 0.0],
    ]
    geo_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=geo_deep.id,
        method="tin",
        vertices=surface_verts,
        triangles=[[0, 1, 2], [0, 2, 3]],
        source_contact_count=2,
        source_contact_checksum=b"\x00" * 16,
        is_stale=False,
    )
    db_session.add(geo_surface)

    # Two CPTs on the section line with a two-layer qc profile spanning 0–10 m.
    depths_gbr, qc_gbr = _two_layer_qc(n_top=250, n_bot=250, qc_top=3.0, qc_bot=22.0)

    cpt_x = CptOrm(
        id=uuid7(),
        name="CPT-X",
        cpt_type="CPTU",
        project_id="GBR",
        test_id="GBR/CPT-X",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt_x.series = CptSeriesOrm(
        depths_m=depths_gbr,
        qc_mpa=qc_gbr,
        fs_mpa=[0.05] * len(depths_gbr),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_y = CptOrm(
        id=uuid7(),
        name="CPT-Y",
        cpt_type="CPTU",
        project_id="GBR",
        test_id="GBR/CPT-Y",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt_y.series = CptSeriesOrm(
        depths_m=depths_gbr,
        qc_mpa=qc_gbr,
        fs_mpa=[0.05] * len(depths_gbr),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    db_session.add_all([cpt_x, cpt_y])
    await db_session.flush()

    # Accepted litho layers: each CPT has one ZAND layer 0–10 m that straddles
    # the 5.0 m geo boundary.
    layer_x = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_x.id,
        depth_top_m=0.0,
        depth_base_m=10.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer_y = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_y.id,
        depth_top_m=0.0,
        depth_base_m=10.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add_all([layer_x, layer_y])
    await db_session.flush()

    # Section covering both CPTs.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S-GBR",
        start_x=148_700.0,
        start_y=200_000.0,
        end_x=149_600.0,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=200.0,
    )
    db_session.add(section)
    await db_session.flush()

    # Correlation edge: CPT-X ↔ CPT-Y on the ZAND layer so the resolver places
    # them in the same litho body before divide_picks_by_geology splits it.
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        section_id=section.id,
        contact_a_id=min(layer_x.id, layer_y.id),
        contact_b_id=max(layer_x.id, layer_y.id),
        contact_a_side="top",
        contact_b_side="top",
        source="manual",
        user_approved=True,
    )
    db_session.add(edge)
    await db_session.commit()

    return {
        "project": proj,
        "geo_model": geo_model,
        "litho_model": litho_model,
        "section": section,
        "cpt_x_id": cpt_x.id,
        "cpt_y_id": cpt_y.id,
        "layer_x_id": layer_x.id,
        "layer_y_id": layer_y.id,
    }


@pytest.mark.asyncio
async def test_sab_c1_geo_band_group_isolation(
    geo_band_scene: dict,
    db_session: AsyncSession,
) -> None:
    """C1 regression: geo-band groups use group-local layer maps for edge wiring.

    When one investigation's litho layer straddles a geological boundary,
    ``divide_picks_by_geology`` splits it into two geo-band segments → two
    distinct body groups in the use case loop.  The C1 bug caused the second
    group to overwrite the first group's position-k layer ids for the same
    investigation in the global accumulator, so ``_insert_geotech_edges``
    wired the wrong (second-group) layers when processing the first group's
    edges.

    This test asserts:
    1. ``layer_count >= 2``: at least the two geo-band geotech layers per CPT
       were created (one above the geo boundary, one below).
    2. No geotech edge connects layers from DIFFERENT geo-band groups, i.e.
       every edge's two endpoint layers share the same ``depth_top_m`` band
       (both from the above-boundary segment OR both from the Q_DEEP segment).
       Concretely: for each edge, the top depth of layer A and the top depth of
       layer B must agree within 0.1 m (they are in the same position k in the
       same group-local plan).
    """
    scene = geo_band_scene
    project = scene["project"]
    litho_model_id = scene["litho_model"].id

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    geotech_model_id = result.geotech_model_id

    # Assertion 1: at least 2 geotech layers created (geo boundary split each CPT).
    assert result.layer_count >= 2, (
        f"C1-regression: expected layer_count >= 2 (geo boundary must split each CPT), "
        f"got {result.layer_count}"
    )

    # Load all geotech layers keyed by id → depth_top_m.
    geotech_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    layer_top: dict[UUID, float] = {ll.id: ll.depth_top_m for ll in geotech_layers}

    # Load all geotech edges.
    geotech_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )

    # Assertion 2: no edge crosses geo-band groups.
    # Layers in the same geo-band group share the same depth_top_m (they are
    # the k-th sub-interval of a geo-bounded segment whose top is either
    # 0.0 m [above-boundary group] or 5.0 m [Q_DEEP group]).  A cross-group
    # edge would connect a layer at ~0.0 m top to one at ~5.0 m top —
    # a difference well above 0.5 m tolerance.
    cross_group_edges = []
    for edge in geotech_edges:
        top_a = layer_top.get(edge.contact_a_id)
        top_b = layer_top.get(edge.contact_b_id)
        if top_a is None or top_b is None:
            continue
        if abs(top_a - top_b) > 0.5:
            cross_group_edges.append(
                f"edge {edge.id}: "
                f"contact_a top={top_a:.3f} m  contact_b top={top_b:.3f} m "
                f"(diff={abs(top_a - top_b):.3f} m — cross-geo-band-group wiring)"
            )

    assert len(cross_group_edges) == 0, (
        f"C1-regression: {len(cross_group_edges)} edge(s) cross geo-band group(s) — "
        f"the group-local layer map fix is not effective:\n" + "\n".join(cross_group_edges)
    )


# ---------------------------------------------------------------------------
# Bug-1 regression — duplicate-investigation-id in a body group
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def multi_layer_body_scene(db_session: AsyncSession) -> dict:
    """Scene for Bug-1 regression: one investigation with TWO accepted litho layers
    in the SAME body group (no geo surface, so no boundary split).

    Geometry
    --------
    No geological surface is added, so ``divide_picks_by_geology`` is a no-op
    and every litho segment maps to a single group (``source_geo_formation_id=None``).

    * **CPT-P** at x=149 000 m: TWO ZAND litho layers, 0–4 m and 4–8 m.
    * **CPT-Q** at x=149 300 m: ONE ZAND litho layer, 0–8 m.

    CPT-P's two layers are correlated to CPT-Q's single layer (two separate
    correlation edges on the same section), so all three layers share the same
    ``body_id`` after resolution.

    Before the fix, ``group_segs`` for this body group contained TWO entries
    for CPT-P (one per accepted layer).  The investigation-pair loop in
    ``_insert_geotech_edges`` produced ``(CPT-P, CPT-Q)`` twice — once from
    the first CPT-P layer's pairing and once from the second — causing the
    same canonical geotech layer-pair edge to be ``session.add``-ed twice in
    one flush → ``uq_litho_contact_corr_triple`` IntegrityError.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model``, ``section``,
        ``cpt_p_id``, ``cpt_q_id``, ``layer_p1_id``, ``layer_p2_id``,
        ``layer_q_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Bug1 regression", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Geo-B1",
        kind="geological",
        is_active=True,
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho-B1",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
        is_active=True,
    )
    db_session.add_all([geo_model, litho_model])
    await db_session.flush()

    # ZAND formation (in BASE_LITHOLOGIES → CPT segmenter will run).
    f_zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND_B1",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
    )
    db_session.add(f_zand)
    await db_session.flush()

    # CPT-P: two layers (0–4 m and 4–8 m), two-layer qc.
    depths_p, qc_p = _two_layer_qc(n_top=200, n_bot=200, qc_top=3.0, qc_bot=22.0)
    cpt_p = CptOrm(
        id=uuid7(),
        name="CPT-P",
        cpt_type="CPTU",
        project_id="B1",
        test_id="B1/CPT-P",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_p.series = CptSeriesOrm(
        depths_m=depths_p,
        qc_mpa=qc_p,
        fs_mpa=[0.05] * len(depths_p),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-Q: single layer (0–8 m), uniform qc.
    depths_q, qc_q = _qc_series(n=400, qc_mpa=12.0)
    cpt_q = CptOrm(
        id=uuid7(),
        name="CPT-Q",
        cpt_type="CPTU",
        project_id="B1",
        test_id="B1/CPT-Q",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_q.series = CptSeriesOrm(
        depths_m=depths_q,
        qc_mpa=qc_q,
        fs_mpa=[0.05] * len(depths_q),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    db_session.add_all([cpt_p, cpt_q])
    await db_session.flush()

    # Two litho layers on CPT-P, one on CPT-Q — all ZAND.
    layer_p1 = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_p.id,
        depth_top_m=0.0,
        depth_base_m=4.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer_p2 = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_p.id,
        depth_top_m=4.0,
        depth_base_m=8.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer_q = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_q.id,
        depth_top_m=0.0,
        depth_base_m=8.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add_all([layer_p1, layer_p2, layer_q])
    await db_session.flush()

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S-B1",
        start_x=148_700.0,
        start_y=200_000.0,
        end_x=149_600.0,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=200.0,
    )
    db_session.add(section)
    await db_session.flush()

    # Correlate: CPT-P layer_p1 ↔ CPT-Q layer_q, and CPT-P layer_p2 ↔ CPT-Q
    # layer_q.  Two edges, same CPT-Q layer — all three layers end up in the
    # same body after resolution.  This is the condition that produces two
    # ``group_segs`` entries for CPT-P in the same body group.
    edge_p1_q = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        section_id=section.id,
        contact_a_id=min(layer_p1.id, layer_q.id),
        contact_b_id=max(layer_p1.id, layer_q.id),
        contact_a_side="top",
        contact_b_side="top",
        source="manual",
        user_approved=True,
    )
    edge_p2_q = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        section_id=section.id,
        contact_a_id=min(layer_p2.id, layer_q.id),
        contact_b_id=max(layer_p2.id, layer_q.id),
        contact_a_side="top",
        contact_b_side="top",
        source="manual",
        user_approved=True,
    )
    db_session.add_all([edge_p1_q, edge_p2_q])
    await db_session.commit()

    return {
        "project": proj,
        "litho_model": litho_model,
        "section": section,
        "cpt_p_id": cpt_p.id,
        "cpt_q_id": cpt_q.id,
        "layer_p1_id": layer_p1.id,
        "layer_p2_id": layer_p2.id,
        "layer_q_id": layer_q.id,
    }


@pytest.mark.asyncio
async def test_sab_bug1_duplicate_investigation_id_regression(
    multi_layer_body_scene: dict,
    db_session: AsyncSession,
) -> None:
    """Bug-1 regression: duplicate investigation id in a body group must not raise.

    When CPT-P has TWO accepted litho layers in the SAME body (both correlated
    to CPT-Q), ``group_segs`` for that body group contains two entries for CPT-P
    (one per litho layer).  Before the fix, the ``_insert_geotech_edges``
    investigation-pair loop generated the canonical ``(CPT-P, CPT-Q)`` pair
    twice, attempted to add the same edge row twice in one flush, and raised a
    ``uq_litho_contact_corr_triple`` IntegrityError.

    This test asserts:
    B1-1  The use case completes without raising (IntegrityError was the failure
          mode before the fix).
    B1-2  The geotech ``litho_contact_correlation_edge`` table has NO duplicate
          rows — the count of edges equals the count of DISTINCT
          ``(model_id, contact_a_id, contact_b_id)`` triples.
    B1-3  At least one geotech edge was created (the positive guard — the
          no-duplicate assertion cannot pass vacuously on zero edges).
    """
    scene = multi_layer_body_scene
    project = scene["project"]
    litho_model_id = scene["litho_model"].id

    # B1-1: must not raise.
    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    geotech_model_id = result.geotech_model_id

    # B1-3 (positive guard): at least one edge must exist so B1-2 is meaningful.
    geotech_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(geotech_edges) > 0, (
        "B1-3: no geotech edges created — the positive guard failed; "
        "the correlation edge between CPT-P and CPT-Q must produce at least one edge"
    )

    # B1-2: no duplicate edges — all (contact_a_id, contact_b_id) pairs are distinct.
    canonical_pairs = [(e.contact_a_id, e.contact_b_id) for e in geotech_edges]
    distinct_pairs = set(canonical_pairs)
    assert len(canonical_pairs) == len(distinct_pairs), (
        f"B1-2: found {len(canonical_pairs) - len(distinct_pairs)} duplicate geotech edge(s) — "
        f"the duplicate-investigation-id guard is not effective. "
        f"Pairs: {canonical_pairs}"
    )


# ---------------------------------------------------------------------------
# Bug-2 regression — C1 direct FormationContact rows conflict with SAB re-run
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def c1_then_sab_scene(db_session: AsyncSession) -> dict:
    """Scene for Bug-2 regression: C1 runs first (direct FC writes), then SAB re-runs.

    ``BuildGeotechModelFromLitho`` (C1) writes ``FormationContact`` rows DIRECTLY
    (not via the LL→FC trigger).  Before the Bug-2 fix, ``_delete_prior_geotech_data``
    only deleted geotech ``litho_layer`` rows (whose FC mirrors were cleaned by the
    trigger), leaving C1's direct FC rows in the table.  On the SECOND SAB run the
    LL→FC trigger tried to INSERT those same FC keys again →
    ``uq_formation_contact_model_formation_borehole_depth`` IntegrityError.

    This scene re-uses the ``geo_band_scene`` geometry (two CPTs straddling a geo
    surface at depth 5 m), but calls ``BuildGeotechModelFromLitho.execute()``
    explicitly before ``SubdivideAllBodies``.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model``, ``section``, ``cpt_x_id``, ``cpt_y_id``.
    """
    from groundmodel.application.build_geotech_model_from_litho import (
        BuildGeotechModelFromLitho,
    )

    proj = ProjectOrm(id=uuid7(), name="Bug2 regression", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Geo-B2",
        kind="geological",
        is_active=True,
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho-B2",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
        is_active=True,
    )
    db_session.add_all([geo_model, litho_model])
    await db_session.flush()

    geo_deep = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Q_DEEP_B2",
        color="#999999",
        display_order=1,
    )
    f_zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND_B2",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
    )
    db_session.add_all([geo_deep, f_zand])
    await db_session.flush()

    # Flat geo surface at absolute elevation 0.0 m (depth 5.0 m below surface).
    geo_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=geo_deep.id,
        method="tin",
        vertices=[
            [148000.0, 199000.0, 0.0],
            [150500.0, 199000.0, 0.0],
            [150500.0, 201000.0, 0.0],
            [148000.0, 201000.0, 0.0],
        ],
        triangles=[[0, 1, 2], [0, 2, 3]],
        source_contact_count=2,
        source_contact_checksum=b"\x00" * 16,
        is_stale=False,
    )
    db_session.add(geo_surface)

    depths_b2, qc_b2 = _two_layer_qc(n_top=250, n_bot=250, qc_top=3.0, qc_bot=22.0)

    cpt_x = CptOrm(
        id=uuid7(),
        name="CPT-X-B2",
        cpt_type="CPTU",
        project_id="B2",
        test_id="B2/CPT-X",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt_x.series = CptSeriesOrm(
        depths_m=depths_b2,
        qc_mpa=qc_b2,
        fs_mpa=[0.05] * len(depths_b2),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_y = CptOrm(
        id=uuid7(),
        name="CPT-Y-B2",
        cpt_type="CPTU",
        project_id="B2",
        test_id="B2/CPT-Y",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt_y.series = CptSeriesOrm(
        depths_m=depths_b2,
        qc_mpa=qc_b2,
        fs_mpa=[0.05] * len(depths_b2),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    db_session.add_all([cpt_x, cpt_y])
    await db_session.flush()

    layer_x = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_x.id,
        depth_top_m=0.0,
        depth_base_m=10.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer_y = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=f_zand.id,
        cpt_id=cpt_y.id,
        depth_top_m=0.0,
        depth_base_m=10.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add_all([layer_x, layer_y])
    await db_session.flush()

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S-B2",
        start_x=148_700.0,
        start_y=200_000.0,
        end_x=149_600.0,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=200.0,
    )
    db_session.add(section)
    await db_session.flush()

    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        section_id=section.id,
        contact_a_id=min(layer_x.id, layer_y.id),
        contact_b_id=max(layer_x.id, layer_y.id),
        contact_a_side="top",
        contact_b_side="top",
        source="manual",
        user_approved=True,
    )
    db_session.add(edge)
    await db_session.commit()

    # Run C1 explicitly so its direct FormationContact writes are in the DB
    # before SAB is called.  This is the production sequence that triggered Bug 2.
    await BuildGeotechModelFromLitho(db_session).execute(
        project_id=proj.id,
        litho_model_id=litho_model.id,
        section_id=section.id,
    )

    return {
        "project": proj,
        "litho_model": litho_model,
        "section": section,
        "cpt_x_id": cpt_x.id,
        "cpt_y_id": cpt_y.id,
    }


@pytest.mark.asyncio
async def test_sab_bug2_c1_fc_conflict_on_rerun(
    c1_then_sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """Bug-2 regression: C1 direct FC rows must not conflict with a SAB re-run.

    ``BuildGeotechModelFromLitho`` (C1) writes ``FormationContact`` rows directly
    (not via the LL→FC trigger).  Before the fix, ``_delete_prior_geotech_data``
    step 2 deleted only the geotech ``litho_layer`` rows (whose FC mirrors were
    cleaned by the LL→FC trigger), but NOT C1's direct FC rows.  On the SECOND
    SAB run the LL→FC trigger tried to INSERT those same FC keys again →
    ``uq_formation_contact_model_formation_borehole_depth`` IntegrityError.

    The geo-band scene is used (two CPTs each straddling a geological surface at
    5.0 m depth) because that is the configuration that produces direct C1 FC
    rows at the geo-division cut depths — the exact condition that triggered the
    real-data crash.

    This test asserts:
    B2-1  The FIRST SAB call (after C1 has run) completes without raising.
    B2-2  The SECOND SAB call (the re-run that triggered the bug) completes
          without raising.
    B2-3  The geotech ``formation_contact`` count is STABLE across the two runs —
          no duplicate FC rows accumulate.
    B2-4  Every accepted geotech ``litho_layer`` row has a matching
          ``formation_contact`` row (LL→FC trigger correctly derived all FCs
          after step-2b cleared the stale C1 FCs).
    """
    scene = c1_then_sab_scene
    project = scene["project"]
    litho_model_id = scene["litho_model"].id

    # B2-1: first SAB call — C1's direct FC rows are already in the DB.
    result1 = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = result1.geotech_model_id

    # Capture FC count after the first run.
    fc_after_first = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )
    fc_count_first = len(fc_after_first)

    # B2-2: second SAB call — must not raise the FC unique-constraint violation.
    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    fc_after_second = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )
    fc_count_second = len(fc_after_second)

    # B2-3: FC count must be stable (no duplicates from the re-run).
    assert fc_count_second == fc_count_first, (
        f"B2-3: formation_contact count changed across SAB re-runs "
        f"({fc_count_first} → {fc_count_second}); "
        f"step-2b delete is not clearing C1 FCs before re-insertion"
    )

    # B2-4: every accepted geotech litho_layer must have a matching FC.
    geotech_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    fc_ids_second = {fc.id for fc in fc_after_second}
    missing_fc = [ll.id for ll in geotech_layers if ll.id not in fc_ids_second]
    assert len(missing_fc) == 0, (
        f"B2-4: {len(missing_fc)} geotech litho_layer row(s) have no matching "
        f"formation_contact after the re-run — step-2b delete may have cleared "
        f"C1 FCs but the LL→FC trigger did not re-derive them. "
        f"Missing: {[str(lid) for lid in missing_fc]}"
    )


# ---------------------------------------------------------------------------
# SAB-10 — geotech edge count is proportional to litho connectivity
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def connectivity_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene asserting that a correlated litho body produces sufficient geotech edges.

    Geometry
    --------
    * **CPT-E** and **CPT-F** at x=149 000 m and x=149 300 m.
    * Each has ONE accepted ZAND litho layer (0–8 m) correlated via a single
      approved litho edge.
    * The ZAND profile is uniform (qc ≈ 12 MPa) so the B-policy returns
      ``consistent=True, band_classes=[<one_class>]`` — one geotech sub-layer
      per CPT, one geotech edge expected.

    SAB-10a  The geotech edge count for the one-class correlated body is >= 1
             (the litho edge is faithfully inherited as a geotech edge).
    SAB-10b  The geotech edge count is NOT near-zero relative to the litho edge
             count (connectivity ratio ≥ 0.5 — at least half the litho edges
             map to geotech edges after dedup).

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_id``,
        ``cpt_e_id``, ``cpt_f_id``, ``litho_edge_count``.
    """
    proj = ProjectOrm(id=uuid7(), name="Connectivity scene", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "Conn-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "Conn-Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "Conn-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_600.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # Uniform qc — one NAD class, no split.
    depths, qc = _qc_series(n=400, qc_mpa=12.0)

    cpt_e = CptOrm(
        id=uuid7(),
        name="CPT-E",
        cpt_type="CPTU",
        project_id="CONN",
        test_id="CONN/CPT-E",
        app_project_id=proj.id,
        location_x=149_000.0,
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
    cpt_f = CptOrm(
        id=uuid7(),
        name="CPT-F",
        cpt_type="CPTU",
        project_id="CONN",
        test_id="CONN/CPT-F",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_f.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    db_session.add_all([cpt_e, cpt_f])
    await db_session.commit()

    # Accept one ZAND layer per CPT and correlate them.
    ce_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_e.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    cf_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_f.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=ce_id,
        contact_b=cf_id,
        section_id=section_id,
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_e_id": str(cpt_e.id),
        "cpt_f_id": str(cpt_f.id),
        "litho_edge_count": 1,  # exactly one approved litho edge was created
    }


@pytest.mark.asyncio
async def test_sab_connectivity_edge_count(
    connectivity_scene: dict,
    db_session: AsyncSession,
) -> None:
    """SAB-10: a correlated litho body produces geotech edges, not near-zero.

    SAB-10a  After subdivide, the geotech model has ≥ 1 correlation edge for a
             body whose litho model has 1 approved edge.  A correlated litho body
             with matching packing stacks must produce geotech connectivity, not
             near-zero (172 litho → 15 geotech on the real model).
    SAB-10b  The connectivity ratio (geotech_edges / litho_edges) is ≥ 0.5.
             A healthy derivation should produce close to 1:1 (dedup reduces the
             count only when many litho layers collapse to the same geotech
             sub-layer pair).
    SAB-10c  The SAB-7 over-merge guard still holds: no cross-NAD-class edge was
             created (the full-sequence derivation connects two stacks only when
             their NAD-class sequences are identical, so paired sub-layers always
             share a class).
    """
    project = connectivity_scene["project"]
    litho_model_id = UUID(connectivity_scene["litho_model_id"])
    litho_edge_count = connectivity_scene["litho_edge_count"]

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = result.geotech_model_id

    geotech_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )
    geotech_edge_count = len(geotech_edges)

    # SAB-10a: at least one geotech edge was produced.
    assert geotech_edge_count >= 1, (
        f"SAB-10a: 0 geotech edges for a body with {litho_edge_count} litho edge(s) — "
        f"the full-sequence derivation produced no geotech connectivity; "
        f"a correlated litho body must produce ≥ 1 geotech edge so it bands "
        f"(not lenses) in the geotech section view"
    )

    # SAB-10b: connectivity ratio >= 0.5 (not near-zero collapse).
    ratio = geotech_edge_count / max(litho_edge_count, 1)
    assert ratio >= 0.5, (
        f"SAB-10b: geotech connectivity ratio too low: "
        f"{geotech_edge_count}/{litho_edge_count} = {ratio:.2f} < 0.5 — "
        f"the full-sequence derivation is dropping too many litho edges; "
        f"a 1-edge litho body should produce exactly 1 geotech edge"
    )

    # SAB-10c: SAB-7 over-merge guard — no cross-formation edge.
    geotech_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    layer_formation: dict[UUID, UUID] = {ll.id: ll.formation_id for ll in geotech_layers}
    cross_class_edges = [
        edge
        for edge in geotech_edges
        if layer_formation.get(edge.contact_a_id) != layer_formation.get(edge.contact_b_id)
    ]
    assert len(cross_class_edges) == 0, (
        f"SAB-10c: {len(cross_class_edges)} cross-NAD-class edge(s) found — "
        f"the full-sequence derivation violated the over-merge guard; the "
        f"same-class guarantee comes from NAD-class SEQUENCE EQUALITY, so geotech "
        f"edges must only connect same-formation (same-NAD-class) sub-layers. "
        f"Offending: {[str(e.id) for e in cross_class_edges]}"
    )


# ---------------------------------------------------------------------------
# NC-1 — NO-CLOBBER: two sections sharing an investigation
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def no_clobber_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene for the NO-CLOBBER regression test.

    Two cross-sections (S1 and S2) share a single investigation (CPT-SHARED)
    in addition to their own private CPTs.  Each section has one approved litho
    correlation edge.

    Before the model-wide restructure, running SubdivideAllBodies for S1 deleted
    all geotech layers for *every* investigation (including CPT-SHARED), then
    re-created only S1's corridor layers.  A subsequent run for S2 found the
    correct geotech layers for CPT-SHARED — but between the two runs, S2's
    geotech edges (which referenced CPT-SHARED's layer ids) were cascade-deleted.

    The model-wide restructure writes layers once per investigation (not per
    section) and then loops over all sections to derive edges.  A single
    model-wide call must therefore produce edges for BOTH S1 and S2.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_s1_id``,
        ``section_s2_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="No-clobber scene", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "NC-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "NC-Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # Section S1: CPT-SHARED + CPT-S1-ONLY (both at y=200_000).
    sec1_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "NC-S1",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_600.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 200.0,
        },
    )
    assert sec1_resp.status_code == 201, sec1_resp.text
    section_s1_id = sec1_resp.json()["id"]

    # Section S2: CPT-SHARED + CPT-S2-ONLY (at y=200_100 so S1 won't capture it).
    sec2_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "NC-S2",
            "start_x": 148_700.0,
            "start_y": 200_100.0,
            "end_x": 149_600.0,
            "end_y": 200_100.0,
            "epsg": 31370,
            "projection_buffer_m": 200.0,
        },
    )
    assert sec2_resp.status_code == 201, sec2_resp.text
    section_s2_id = sec2_resp.json()["id"]

    depths, qc = _qc_series(n=400, qc_mpa=12.0)

    # CPT-SHARED: on y=200_050 — within the ±200 m buffer of BOTH sections.
    cpt_shared = CptOrm(
        id=uuid7(),
        name="CPT-SHARED",
        cpt_type="CPTU",
        project_id="NC",
        test_id="NC/CPT-SHARED",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_050.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_shared.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-S1-ONLY: on y=200_000, only within S1's buffer.
    cpt_s1 = CptOrm(
        id=uuid7(),
        name="CPT-S1-ONLY",
        cpt_type="CPTU",
        project_id="NC",
        test_id="NC/CPT-S1",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_s1.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-S2-ONLY: on y=200_100, only within S2's buffer.
    cpt_s2 = CptOrm(
        id=uuid7(),
        name="CPT-S2-ONLY",
        cpt_type="CPTU",
        project_id="NC",
        test_id="NC/CPT-S2",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_100.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_s2.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    db_session.add_all([cpt_shared, cpt_s1, cpt_s2])
    await db_session.commit()

    # Accept one ZAND layer per CPT.
    shared_contact_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_shared.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    s1_contact_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_s1.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    s2_contact_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_s2.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )

    # Correlate CPT-SHARED ↔ CPT-S1-ONLY on section S1.
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=shared_contact_id,
        contact_b=s1_contact_id,
        section_id=section_s1_id,
    )
    # Correlate CPT-SHARED ↔ CPT-S2-ONLY on section S2.
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=shared_contact_id,
        contact_b=s2_contact_id,
        section_id=section_s2_id,
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_s1_id": section_s1_id,
        "section_s2_id": section_s2_id,
    }


@pytest.mark.asyncio
async def test_sab_no_clobber_two_sections(
    no_clobber_scene: dict,
    db_session: AsyncSession,
) -> None:
    """NC-1: a model-wide run produces edges for both sections simultaneously.

    Two sections (S1, S2) each have one approved litho edge.  CPT-SHARED
    participates in both sections.  A single model-wide SubdivideAllBodies call
    must produce geotech correlation edges for BOTH sections — not just the last
    one processed.

    NC-1a  ``section_count == 2``: both sections were processed.
    NC-1b  Geotech edges exist for section S1 (CPT-SHARED ↔ CPT-S1-ONLY pair).
    NC-1c  Geotech edges exist for section S2 (CPT-SHARED ↔ CPT-S2-ONLY pair).
    NC-1d  The per-section edge sets are DISJOINT (each section's edges reference
           only that section's CPTs in the layer pair — no cross-section wiring).
    """
    project = no_clobber_scene["project"]
    litho_model_id = UUID(no_clobber_scene["litho_model_id"])
    section_s1_id = UUID(no_clobber_scene["section_s1_id"])
    section_s2_id = UUID(no_clobber_scene["section_s2_id"])

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    geotech_model_id = result.geotech_model_id

    # NC-1a: section_count must be 2.
    assert result.section_count == 2, (
        f"NC-1a: expected section_count=2, got {result.section_count}; "
        f"both sections must be processed in a model-wide run"
    )

    # Load all geotech edges for the model.
    all_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    )

    edges_s1 = [e for e in all_edges if e.section_id == section_s1_id]
    edges_s2 = [e for e in all_edges if e.section_id == section_s2_id]

    # NC-1b: at least one edge for S1.
    assert len(edges_s1) >= 1, (
        "NC-1b: 0 geotech edges for section S1 — the model-wide run clobbered "
        "S1's edges when it processed S2 (the original per-section clobber bug)"
    )

    # NC-1c: at least one edge for S2.
    assert len(edges_s2) >= 1, (
        "NC-1c: 0 geotech edges for section S2 — the model-wide run did not "
        "derive edges for S2 (expected 1 edge for the CPT-SHARED ↔ CPT-S2 pair)"
    )

    # NC-1d: the two edge sets are disjoint (no edge appears in both sections).
    s1_ids = {e.id for e in edges_s1}
    s2_ids = {e.id for e in edges_s2}
    shared_ids = s1_ids & s2_ids
    assert len(shared_ids) == 0, (
        f"NC-1d: {len(shared_ids)} edge id(s) appear in BOTH sections — "
        f"edges must be section-scoped (one edge per section pair, not shared): "
        f"{[str(i) for i in shared_ids]}"
    )


# ---------------------------------------------------------------------------
# BH-E1 — BOREHOLE EXTRAPOLATION: borehole gets NAD class from nearest CPT
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def borehole_extrapolation_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene for the borehole-extrapolation test.

    One CPT (CPT-REF) and one borehole (BH-ALONE) with the SAME lithology
    (ZAND) and overlapping depth ranges.  BH-ALONE has no CPT in its body
    group (borehole-only body).  CPT-REF is in a separate body.

    The expectation is that after the model-wide SubdivideAllBodies run,
    BH-ALONE's geotech sub-body is extrapolated from CPT-REF (nearest same-
    lithology CPT) and carries a non-None ``nad_class``.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_id``,
        ``bh_alone_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="BH extrapolation scene", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "BHE-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "BHE-Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "BHE-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_600.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 200.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # CPT-REF: dense ZAND throughout (uniform high qc → one NAD class assigned).
    depths, qc = _qc_series(n=400, qc_mpa=22.0)

    cpt_ref = CptOrm(
        id=uuid7(),
        name="CPT-REF",
        cpt_type="CPTU",
        project_id="BHE",
        test_id="BHE/CPT-REF",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_ref.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # BH-ALONE: ZAND, same depth range, no CPT in its body group.
    bh_alone = BoreholeOrm(
        id=uuid7(),
        name="BH-ALONE",
        app_project_id=proj.id,
        project_id="BHE",
        test_id="BHE/BH-ALONE",
        location_x=149_200.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )

    db_session.add_all([cpt_ref, bh_alone])
    await db_session.commit()

    # Accept one ZAND litho layer per investigation (same lithology → extrapolation
    # candidate).  Do NOT correlate them — BH-ALONE must be in its own body group.
    await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_ref.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_alone.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "bh_alone_id": bh_alone.id,
    }


@pytest.mark.asyncio
async def test_sab_borehole_extrapolation(
    borehole_extrapolation_scene: dict,
    db_session: AsyncSession,
) -> None:
    """BH-E1: a borehole-only body gets its NAD class from the nearest same-lithology CPT.

    BH-ALONE is a standalone ZAND borehole (no CPT in its body group).  CPT-REF
    is a nearby ZAND CPT with a uniform high-qc profile (dense → a non-None
    NAD class).  After SubdivideAllBodies runs model-wide, BH-ALONE's geotech
    sub-body must have been extrapolated to CPT-REF's NAD class.

    BH-E1a  ``borehole_only_count >= 1``: BH-ALONE was identified as a borehole-
             only group.
    BH-E1b  ``extrapolated_borehole_count >= 1``: at least one borehole sub-body
             was successfully extrapolated.
    BH-E1c  BH-ALONE's geotech ``litho_layer`` row has a non-None ``formation_id``
             whose formation carries a non-None ``nad_class`` — the grey "No qc"
             skeleton was replaced by a classified formation.
    """
    project = borehole_extrapolation_scene["project"]
    litho_model_id = UUID(borehole_extrapolation_scene["litho_model_id"])
    bh_alone_id = borehole_extrapolation_scene["bh_alone_id"]

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    geotech_model_id = result.geotech_model_id

    # BH-E1a: BH-ALONE was identified as borehole-only.
    assert result.borehole_only_count >= 1, (
        f"BH-E1a: expected borehole_only_count >= 1, got {result.borehole_only_count}; "
        f"BH-ALONE (no CPT in body group) must be classified as borehole-only"
    )

    # BH-E1b: at least one borehole was successfully extrapolated.
    assert result.extrapolated_borehole_count >= 1, (
        f"BH-E1b: expected extrapolated_borehole_count >= 1, "
        f"got {result.extrapolated_borehole_count}; "
        f"BH-ALONE's ZAND sub-body must be extrapolated from the adjacent CPT-REF"
    )

    # BH-E1c: BH-ALONE's geotech layer formation carries a non-None nad_class.
    bh_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_alone_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(bh_layers) >= 1, (
        f"BH-E1c: no accepted geotech litho_layer rows for BH-ALONE "
        f"(borehole_id={bh_alone_id}) in model {geotech_model_id}"
    )

    # Load the formation for each bh layer and check nad_class.
    null_class_layers = []
    for layer in bh_layers:
        formation = await db_session.get(GeologicalFormationOrm, layer.formation_id)
        if formation is None or formation.nad_class is None:
            null_class_layers.append(layer.id)

    assert len(null_class_layers) == 0, (
        f"BH-E1c: {len(null_class_layers)} of BH-ALONE's geotech layer(s) have "
        f"nad_class=None — extrapolation from CPT-REF did not propagate: "
        f"{[str(lid) for lid in null_class_layers]}"
    )
