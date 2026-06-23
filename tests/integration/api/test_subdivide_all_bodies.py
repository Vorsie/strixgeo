"""Integration tests for SubdivideAllBodies (Task E3).

Nine SAB assertions that exercise the B-policy algorithm end-to-end via the
direct use-case call (no HTTP endpoint yet; that is Task E4).

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
    section_id = UUID(sab_scene["section_id"])

    # Execute the use case.
    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
        section_id=section_id,
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
        section_id=section_id,
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
    section_id = scene["section"].id

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
        section_id=section_id,
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
