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
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.accept_contact_correlations import AcceptContactCorrelations
from groundmodel.application.confirm_correlation_edge_review import (
    ConfirmCorrelationEdgeReview,
)
from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.application.geotech_tie_reanchor import depth_to_mm
from groundmodel.application.reconcile_bodies_after_restore import (
    reconcile_bodies_after_restore,
)
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
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)

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
            "parent_model_id": geo_model_id,
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

    # SAB-10 (parent-band FK, Parameters body-tree A3): every accepted geotech
    # band minted from a CPT names the covering litho band it subdivides — the
    # accepted litho band on the SAME cpt whose interval contains the band's
    # midpoint. The Parameters tree derives the band's litho body live through it.
    sab10_geotech_bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.status == "accepted",
                    LithoLayerOrm.cpt_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    sab10_litho_by_id = {
        ly.id: ly
        for ly in (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == litho_model_id,
                        LithoLayerOrm.status == "accepted",
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    assert sab10_geotech_bands, "SAB-10: expected at least one CPT geotech band"
    for band in sab10_geotech_bands:
        assert band.parent_litho_layer_id is not None, (
            f"SAB-10: geotech band {band.id} carries no covering litho band"
        )
        parent = sab10_litho_by_id.get(band.parent_litho_layer_id)
        assert parent is not None, (
            f"SAB-10: band {band.id} parent {band.parent_litho_layer_id} is not "
            "an accepted litho band in the parent litho model"
        )
        assert parent.cpt_id == band.cpt_id, (
            "SAB-10: the covering litho band must sit on the same CPT as the band"
        )
        mid = 0.5 * (band.depth_top_m + band.depth_base_m)
        assert parent.depth_top_m - 1e-6 <= mid <= parent.depth_base_m + 1e-6, (
            f"SAB-10: band midpoint {mid} is outside its parent litho band "
            f"[{parent.depth_top_m}, {parent.depth_base_m}]"
        )

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

    # RE-PINNED (owner ruling 2026-08-13, "start from the exact litho
    # geometries"): a direct litho tie's topmost pair restates REGARDLESS of
    # class and is born accepted, so cross-class edges are legal — but ONLY as
    # accepted restatements. A PENDING machine proposal must still join
    # same-class bands: nothing licenses a cross-class guess.
    cross_class_pending = [
        edge
        for edge in geotech_edges
        if not edge.user_approved
        and layer_formation.get(edge.layer_a_id) != layer_formation.get(edge.layer_b_id)
    ]
    assert len(cross_class_pending) == 0, (
        f"SAB-7 (TRAP 1): {len(cross_class_pending)} cross-class PENDING edge(s) — "
        f"only an accepted restatement of a direct litho tie may join different "
        f"NAD classes. Offending edges: {[str(e.id) for e in cross_class_pending]}"
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
# ADB — borehole-mediated geotech edge derivation (DivideBoreholes)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_divide_boreholes_derives_borehole_mediated_edges(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """ADB-1..4: a borehole-mediated litho edge yields geotech edges ONLY after
    DivideBoreholes — and the resolver then connects the borehole chain.

    The scene correlates BH-A to CPT-A (a borehole-mediated litho edge).
    ``SubdivideAllBodies`` derives geotech edges BEFORE the borehole geotech
    bands exist, so that edge is skipped (empty geotech stack) — the CS1
    S13↔B4↔B6↔S6 bug in miniature.  ``DivideBoreholes`` materialises BH-A's
    bands and re-runs the SAME shared derivation, adding the borehole-involving
    edges and re-resolving body_id.

    ADB-1  After SAB alone, NO geotech edge references a BH-A geotech layer
           (BH-A has no geotech layers yet — the derivation could not connect it).
    ADB-2  After DivideBoreholes, BH-A has ≥1 accepted geotech layer.
    ADB-3  After DivideBoreholes, ≥1 geotech edge references a BH-A geotech
           layer — the borehole-mediated edge that SAB could not derive.
    ADB-3b The derived edges arrive UNACCEPTED (clean/dirty rule, 2026-08-01):
           the program worked them out, the engineer has not looked at them yet,
           so they are proposals and connect nothing.
    ADB-4  Once the engineer accepts them, BH-A's classified bands connect: a
           BH-A geotech layer shares a body_id with a CPT-A geotech layer (the
           resolver joined the chain), and no edge-connected BH-A band is left
           with a NULL body_id orphan.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])
    bh_a_id = UUID(sab_scene["bh_a_id"])
    cpt_a_id = UUID(sab_scene["cpt_a_id"])

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = sab_result.geotech_model_id

    async def _bh_a_layer_ids() -> set[UUID]:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm.id).where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.borehole_id == bh_a_id,
                        LithoLayerOrm.status == "accepted",
                    )
                )
            )
            .scalars()
            .all()
        )
        return set(rows)

    async def _edges_touching(layer_ids: set[UUID]) -> list[LithoContactCorrelationEdgeOrm]:
        if not layer_ids:
            return []
        rows = (
            (
                await db_session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                        LithoContactCorrelationEdgeOrm.layer_a_id.in_(layer_ids)
                        | LithoContactCorrelationEdgeOrm.layer_b_id.in_(layer_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        return list(rows)

    # ADB-1: SAB leaves BH-A unconnected (no geotech layers → no edges).
    assert await _bh_a_layer_ids() == set(), (
        "ADB-1 precondition: SAB must defer borehole geotech layers to DivideBoreholes"
    )

    # Run DivideBoreholes — materialises BH-A bands + derives the edges SAB skipped.
    await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    bh_a_layers_after = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_a_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    bh_a_layer_ids = {ll.id for ll in bh_a_layers_after}

    # ADB-2: BH-A now has geotech bands.
    assert len(bh_a_layers_after) >= 1, (
        "ADB-2: DivideBoreholes must materialise ≥1 geotech layer for BH-A"
    )

    # ADB-3: at least one geotech edge now references a BH-A geotech layer.
    bh_edges = await _edges_touching(bh_a_layer_ids)
    assert len(bh_edges) >= 1, (
        "ADB-3: DivideBoreholes must derive ≥1 borehole-mediated geotech edge "
        "for BH-A (the edge SubdivideAllBodies skipped with an empty stack). "
        f"Found {len(bh_edges)}."
    )

    # ADB-3b (re-pinned, owner refinement 2026-08-06): the tie that RESTATES
    # the direct CPT↔BH litho tie (the top sub-band pair — same contact
    # surfaces the engineer tied) is born accepted. In THIS scene that is the
    # only derivable pair: CPT-A is [loose, dense] and BH-A's divided bands
    # are both loose, so the LCS aligns the tops (earliest-match rule) and
    # nothing interior remains to propose. The pending arrival of interior
    # packing pairs is pinned by LCS-1c and the derivation unit tests.
    accepted_bh = [e for e in bh_edges if e.user_approved]
    assert accepted_bh, (
        "ADB-3b: the restated top pair of the direct litho tie must arrive "
        "accepted — the litho approval already vouches for that connection"
    )
    assert all(e.source == "auto" for e in bh_edges), (
        "ADB-3b: derived ties must carry the program's provenance, not 'manual' "
        f"— sources={sorted({e.source for e in bh_edges})}"
    )

    # The engineer reviews the proposals and accepts them. This is the step that
    # turns a proposal into something the machine may never delete — and the step
    # that makes the bands join, because the resolver unions approved edges only.
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )
    # Re-read BH-A's bands: the accept committed, so the body_id stamps the
    # resolver just wrote are only visible on a fresh query.
    bh_a_layers_after = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_a_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )

    # ADB-4: the resolver connected BH-A to CPT-A — a BH-A band shares a body_id
    # with a CPT-A band, and no edge-connected BH-A band is a NULL orphan.
    cpt_a_body_ids = {
        ll.body_id
        for ll in (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.cpt_id == cpt_a_id,
                        LithoLayerOrm.status == "accepted",
                    )
                )
            )
            .scalars()
            .all()
        )
        if ll.body_id is not None
    }
    bh_a_body_ids = {ll.body_id for ll in bh_a_layers_after if ll.body_id is not None}
    assert bh_a_body_ids & cpt_a_body_ids, (
        "ADB-4: after edge derivation + re-resolve, a BH-A geotech band must share "
        f"a body_id with a CPT-A band. BH-A body_ids={bh_a_body_ids}, "
        f"CPT-A body_ids={cpt_a_body_ids}"
    )
    # No edge-connected BH-A layer may be a NULL-body orphan (the B6-top-KLEI bug).
    connected_bh_layer_ids = (
        {e.layer_a_id for e in bh_edges} | {e.layer_b_id for e in bh_edges}
    ) & bh_a_layer_ids
    # Guard against a vacuous pass: on the OLD code (0 borehole edges) this set is
    # empty and the loop below never runs → ADB-4 would pass for the wrong reason.
    assert len(connected_bh_layer_ids) >= 1, (
        "ADB-4 precondition: no BH-A geotech layer is edge-connected — the "
        "NULL-orphan assertion would be vacuous"
    )
    for ll in bh_a_layers_after:
        if ll.id in connected_bh_layer_ids:
            assert ll.body_id is not None, (
                f"ADB-4: BH-A geotech layer {ll.id} is edge-connected but has a NULL "
                "body_id — the resolver must have stamped it (no orphan)"
            )


# ---------------------------------------------------------------------------
# RE-ANCHOR — an accepted tie survives a re-subdivide (owner ruling 2026-08-01)
#
# A tie names two band ids, and the rebuild gives every band a new id, so the
# FK cascade used to take every accepted tie with the layer wipe.  The ruling:
# a rebuilt band IS the old band when the investigation, the depth interval and
# the NAD class all match — exactly, no tolerance.  These tests speak that rule.
# ---------------------------------------------------------------------------


async def _tie_fingerprints(
    db_session: AsyncSession,
    geotech_model_id: UUID,
    *,
    approved_only: bool,
    flagged_only: bool = False,
) -> set[tuple]:
    """Describe a model's geotech ties by what they CONNECT, not by row id.

    A tie's fingerprint is its section, its provenance, and both endpoints'
    three-part band identity (investigation, depth interval in millimetres, NAD
    class) — everything except the ids the rebuild is free to change.

    Parameters
    ----------
    db_session : AsyncSession
        Active session.
    geotech_model_id : UUID
        The geotech model whose ties are described.
    approved_only : bool
        Restrict to accepted ties.
    flagged_only : bool
        Restrict to ties carrying a ``review_reason`` — the ones the re-anchor
        could not place with confidence and is asking the engineer about.

    Returns
    -------
    set[tuple]
        ``(section_id, source, frozenset{endpoint fingerprint, ...})`` per tie.
    """
    stmt = select(LithoContactCorrelationEdgeOrm).where(
        LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
    )
    if approved_only:
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.user_approved.is_(True))
    if flagged_only:
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.review_reason.is_not(None))
    edges = list((await db_session.execute(stmt)).scalars().all())

    endpoint_ids = {e.layer_a_id for e in edges} | {e.layer_b_id for e in edges}
    identity: dict[UUID, tuple] = {}
    if endpoint_ids:
        rows = (
            await db_session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.nad_class,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(LithoLayerOrm.id.in_(endpoint_ids))
            )
        ).all()
        for r in rows:
            identity[r.id] = (
                str(r.borehole_id if r.borehole_id is not None else r.cpt_id),
                depth_to_mm(r.depth_top_m),
                depth_to_mm(r.depth_base_m),
                r.nad_class,
            )

    return {
        (
            e.section_id,
            e.source,
            frozenset({identity[e.layer_a_id], identity[e.layer_b_id]}),
        )
        for e in edges
    }


@pytest.mark.asyncio
async def test_an_accepted_geotech_tie_survives_a_re_subdivide(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """The band comes back identical, so the tie comes back — accepted.

    Nothing about the scene changes between the two builds, so every rebuilt
    band lands on the same investigation, over the same depth interval, with
    the same NAD class.  Under the owner's rule each is the same band, and the
    tie the engineer accepted must still connect them — still accepted, still
    carrying the provenance it had.

    (This test replaces the one that PINNED the loss.  The pin existed so that
    nobody read the reset's spare-approved predicate and concluded accepted ties
    survived; now they do, and the assertion says so.)
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = sab_result.geotech_model_id

    # The engineer reviews this run's proposals and accepts them all.
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )
    accepted_before = list(
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
    assert accepted_before, "precondition: SAB must derive at least one geotech tie to accept"
    fingerprints_before = await _tie_fingerprints(db_session, geotech_model_id, approved_only=True)
    sources_before = {e.source for e in accepted_before}

    # He re-subdivides.
    second = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    accepted_after = list(
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
    fingerprints_after = await _tie_fingerprints(db_session, geotech_model_id, approved_only=True)

    assert fingerprints_after == fingerprints_before, (
        "every accepted tie must still connect the same two bands after the "
        f"rebuild. before={len(fingerprints_before)} after={len(fingerprints_after)} "
        f"missing={fingerprints_before - fingerprints_after} "
        f"unexpected={fingerprints_after - fingerprints_before}"
    )
    assert len(accepted_after) == len(accepted_before)
    assert all(e.user_approved for e in accepted_after), (
        "a tie the engineer accepted must come back ACCEPTED, not as a fresh proposal"
    )
    assert {e.source for e in accepted_after} == sources_before, (
        "a re-anchored tie must keep its original provenance — a hand-made tie "
        "must still read 'manual' after the rebuild"
    )
    assert second.reanchored_tie_count == len(accepted_before)
    assert second.lost_tie_count == 0
    assert second.lost_tie_reasons == {}


@pytest.mark.asyncio
async def test_an_unaccepted_geotech_tie_does_not_survive_the_rebuild(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """A tie the engineer never accepted is dirty — the rebuild regenerates it.

    Only acceptance protects a tie.  The derived proposals from the first build
    are the machine's own work; the second build throws them away and derives
    them again, so none of the original rows survive.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])

    first = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = first.geotech_model_id

    proposals = list(
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
    assert proposals, "precondition: SAB must derive at least one geotech tie"
    # Ruling A (2026-08-05): derivation now emits accepted rows, so the
    # unaccepted state this test is ABOUT is staged by explicit demotion —
    # the same rows a non-litho-backed source would leave pending.
    proposal_ids = {e.id for e in proposals}
    for e in proposals:
        e.user_approved = False
    await db_session.commit()

    second = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    surviving_ids = {
        e.id
        for e in (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                )
            )
        )
        .scalars()
        .all()
    }
    assert not (proposal_ids & surviving_ids), (
        "an unaccepted tie must NOT be carried across the rebuild — it is dirty, "
        "and regenerating it is the whole point of pressing Subdivide again"
    )
    assert second.reanchored_tie_count == 0, (
        "nothing was accepted, so nothing should have been re-anchored"
    )


@pytest.mark.asyncio
async def test_a_tie_whose_band_changed_class_is_not_silently_re_pointed(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """The qc re-derives a different packing class → that tie is FLAGGED, not moved silently.

    CPT-B's deep qc is edited from 22 MPa (ZAND zeer-dicht, class 8) to 12 MPa
    (ZAND dicht, class 7) between the two builds.  The band comes back over the
    same depths on the same investigation, but it is a different packing class,
    so it is not obviously the band the engineer tied.

    The owner's rule (2026-08-02) is that an accepted tie never disappears
    without them deleting it, so the tie is carried onto that band and stamped
    with a ``review_reason``.  What must never happen is the silent version: a
    tie that quietly connects two different bands than it did before, with
    nothing on it to say so.  That is what this test pins — every tie whose
    endpoints changed carries a flag.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])
    cpt_b_id = UUID(sab_scene["cpt_b_id"])

    first = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = first.geotech_model_id
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )
    fingerprints_before = await _tie_fingerprints(db_session, geotech_model_id, approved_only=True)
    assert fingerprints_before, "precondition: at least one accepted tie"

    # The deep half of CPT-B re-reads as 'dicht' instead of 'zeer dicht'.
    series = (
        await db_session.execute(select(CptSeriesOrm).where(CptSeriesOrm.cpt_id == cpt_b_id))
    ).scalar_one()
    series.qc_mpa = [3.0 if q < 10.0 else 12.0 for q in series.qc_mpa]
    await db_session.commit()

    second = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    fingerprints_after = await _tie_fingerprints(db_session, geotech_model_id, approved_only=True)

    assert second.lost_tie_count == 0, (
        "an accepted tie must not disappear on its own — the reclassified band "
        "is still there to carry it"
    )
    assert len(fingerprints_after) == len(fingerprints_before), (
        "every accepted tie must survive the rebuild"
    )
    assert second.review_tie_reasons.get("class_changed", 0) >= 1, (
        "CPT-B's deep band changed NAD class, so the tie into it must be flagged "
        "for the engineer rather than carried as though nothing happened"
    )

    # The guarantee that makes the flag meaningful: no tie changed what it
    # connects without saying so.  Ties whose fingerprint is unchanged need no
    # flag; every one that moved must carry one.
    moved = fingerprints_after - fingerprints_before
    flagged = await _tie_fingerprints(
        db_session, geotech_model_id, approved_only=True, flagged_only=True
    )
    assert moved <= flagged, (
        "a tie that connects different bands than before must carry a "
        f"review_reason; silently re-pointed = {moved - flagged}"
    )


@pytest.mark.asyncio
async def test_re_anchoring_never_leaves_two_edges_on_the_same_band_pair(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """The auto pass must not propose a tie the re-anchor just restored.

    Both halves of the rebuild produce ties for the same band pairs: the
    re-anchor restores what the engineer accepted, and the derivation proposes
    what the LCS match finds.  They must agree on one edge per pair, not stack
    an unapproved proposal beside the accepted tie.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])

    first = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = first.geotech_model_id
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )
    accepted_pairs_before = {
        (e.section_id, e.layer_a_id, e.layer_b_id)
        for e in (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
            )
        )
        .scalars()
        .all()
    }
    assert accepted_pairs_before, "precondition: at least one accepted tie"

    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    edges_after = list(
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
    seen: dict[tuple, int] = defaultdict(int)
    for e in edges_after:
        seen[(e.section_id, e.layer_a_id, e.layer_b_id)] += 1
    doubled = {k: n for k, n in seen.items() if n > 1}
    assert not doubled, (
        f"a band pair carries more than one geotech edge after the rebuild: {doubled}"
    )


# ---------------------------------------------------------------------------
# The 2026-08-26 ruling — a geological surface never cuts a packing band
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def geo_band_scene(db_session: AsyncSession) -> dict:
    """Scene for the "a geological surface never cuts a packing band" pin.

    Geometry
    --------
    One flat geological surface at absolute elevation 2.0 m (the top of
    formation ``Q_DEEP``).  Both CPTs sit at surface elevation 5.0 m, so the
    geological boundary falls at **depth 3.0 m** below surface.

    * **CPT-X** at x=149 000 m: one ZAND litho layer 0–10 m, straddling the
      geological boundary — 3.0 m above it, 7.0 m below it.
    * **CPT-Y** at x=149 300 m: identical profile, correlated to CPT-X so both
      belong to one litho body.

    The qc profile changes ONCE, at depth 5.0 m (3 MPa over 22 MPa).  The
    geological boundary at 3.0 m therefore sits where the CPT says nothing
    changes — which is the whole point: any packing boundary appearing at
    3.0 m could only have come from the geology, so its ABSENCE is a real
    measurement of the 2026-08-26 ruling rather than a coincidence.  (Before
    that ruling the surface sat at elevation 0.0 m, i.e. exactly on the qc
    transition, where a cut and a class change were indistinguishable.)

    History: this scene was built for the C1 regression (a global
    ``layer_id_by_inv_pos`` accumulator overwritten across body groups), using
    the geological cut as the cheapest way to give ONE investigation TWO body
    groups.  Geology can no longer do that, so the C1 bug class is now covered
    wherever a column carries two litho units in different bodies — the common
    case, exercised by every multi-unit scene with edges in this file.

    Returns
    -------
    dict
        Keys: ``project``, ``geo_model``, ``litho_model``, ``section``,
        ``cpt_x_id``, ``cpt_y_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geo-line-never-cuts regression", status="active")
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
        parent_model_id=geo_model.id,
        is_active=True,
    )
    db_session.add_all([geo_model, litho_model])
    await db_session.flush()

    # Geological formation whose top surface sits at absolute elevation 2.0 m
    # → depth 3.0 m below the 5.0 m surface elevation on both CPTs, where the
    # qc profile is flat (the transition is at 5.0 m).
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

    # Flat geo surface at absolute elevation 2.0 m covering the corridor.
    surface_verts = [
        [148000.0, 199000.0, 2.0],
        [150500.0, 199000.0, 2.0],
        [150500.0, 201000.0, 2.0],
        [148000.0, 201000.0, 2.0],
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
    # them in one litho body — which nothing downstream now divides.
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        section_id=section.id,
        layer_a_id=min(layer_x.id, layer_y.id),
        layer_b_id=max(layer_x.id, layer_y.id),
        layer_a_side="top",
        layer_b_side="top",
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
        "geo_deep_id": geo_deep.id,
    }


@pytest.mark.asyncio
async def test_sab_a_geological_surface_never_cuts_a_packing_band(
    geo_band_scene: dict,
    db_session: AsyncSession,
) -> None:
    """A geological surface through a litho unit divides NOTHING (owner, 2026-08-26).

    *"just drop the wall everywhere, user wil have to manually do it"*. This
    test replaces ``test_sab_c1_geo_band_group_isolation``, which asserted the
    opposite — that the straddling layer was split into two geo-band groups —
    and would now pass vacuously on this scene (a boundary still appears at the
    qc transition, whatever geology does).

    The scene puts the geological boundary at 3.0 m, where the CPT reads a flat
    3 MPa either side, and the only real packing change at 5.0 m. So:

    1. NO packing boundary lands at 3.0 m — the ruling itself. Before the ruling
       there was one on every column here.
    2. The straddling layer yields ONE body group per body, not two.
    3. That group's geological label is the MIDPOINT unit — ``Q_DEEP``, since
       the pick's midpoint (5.0 m depth, 0.0 m elevation) is below the surface
       at 2.0 m elevation, and 7 of its 10 m lie in that unit. The label is
       derived and informational; it decides nothing about geometry.
    """
    scene = geo_band_scene
    project = scene["project"]
    litho_model_id = scene["litho_model"].id
    geo_deep_id = scene["geo_deep_id"]

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    geotech_model_id = result.geotech_model_id

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
    assert geotech_layers, "the subdivision produced no packing bands at all"

    # 1. The ruling: nothing was cut at the geological line.
    #    Every band edge (top AND base) is checked, on every column.
    GEO_BOUNDARY_M = 3.0
    cut_at_geology = [
        f"layer {ll.id} on {ll.cpt_id or ll.borehole_id}: "
        f"{ll.depth_top_m:.3f}-{ll.depth_base_m:.3f} m"
        for ll in geotech_layers
        if abs(ll.depth_top_m - GEO_BOUNDARY_M) < 0.1 or abs(ll.depth_base_m - GEO_BOUNDARY_M) < 0.1
    ]
    assert not cut_at_geology, (
        f"a packing boundary landed on the geological surface at {GEO_BOUNDARY_M} m, "
        f"where the qc does not change — the machine cut at a geological line:\n"
        + "\n".join(cut_at_geology)
    )

    # 2 + 3. One group per body, labelled by the midpoint unit.
    formation_ids = {ll.formation_id for ll in geotech_layers}
    formations = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(formation_ids))
            )
        )
        .scalars()
        .all()
    )
    geo_parents = {f.source_geo_formation_id for f in formations}
    assert geo_parents == {geo_deep_id}, (
        "the straddling layer must resolve to ONE geological parent — the unit "
        "holding the majority of its thickness (Q_DEEP, 7 m of 10) — not one "
        f"per geological band; got {geo_parents}"
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
    No geological surface is added, so every litho segment carries no geological
    label and maps to a single group (``source_geo_formation_id=None``).  Since
    2026-08-26 a geological surface would not split them either — it only labels.

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
        parent_model_id=geo_model.id,
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

    # CPT-Q: single layer (0–8 m), uniform high qc matching CPT-P's bottom zone.
    # Same qc as CPT-P's 4–8 m zone (22.0 MPa = zeer dicht) so the
    # (layer_p2 ↔ layer_q) litho edge maps to same-NAD-class geotech layers
    # and produces at least one geotech edge — making B1-3 non-vacuous.
    depths_q, qc_q = _qc_series(n=400, qc_mpa=22.0)
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
        layer_a_id=min(layer_p1.id, layer_q.id),
        layer_b_id=max(layer_p1.id, layer_q.id),
        layer_a_side="top",
        layer_b_side="top",
        source="manual",
        user_approved=True,
    )
    edge_p2_q = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        section_id=section.id,
        layer_a_id=min(layer_p2.id, layer_q.id),
        layer_b_id=max(layer_p2.id, layer_q.id),
        layer_a_side="top",
        layer_b_side="top",
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
          ``(model_id, layer_a_id, layer_b_id)`` triples.
    B1-3  At least one geotech edge was created (the positive guard — the
          no-duplicate assertion cannot pass vacuously on zero edges).
          CPT-Q is set to qc=22 MPa (zeer dicht) matching CPT-P's 4–8 m
          zone, so the (layer_p2 ↔ layer_q) litho correlation produces a
          same-class geotech edge, giving a genuine duplicate-prevention
          target.
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

    # B1-2: no duplicate edges — all (layer_a_id, layer_b_id) pairs are distinct.
    canonical_pairs = [(e.layer_a_id, e.layer_b_id) for e in geotech_edges]
    distinct_pairs = set(canonical_pairs)
    assert len(canonical_pairs) == len(distinct_pairs), (
        f"B1-2: found {len(canonical_pairs) - len(distinct_pairs)} duplicate geotech edge(s) — "
        f"the duplicate-investigation-id guard is not effective. "
        f"Pairs: {canonical_pairs}"
    )


@pytest.mark.asyncio
async def test_sab_void_qc_does_not_crash_and_flags_needs_review(
    multi_layer_body_scene: dict,
    db_session: AsyncSession,
) -> None:
    """Void qc must not crash the model-wide Subdivide; a unit missing qc over a
    material span becomes 'needs review', while a well-covered unit still classifies.

    Regression for P0-1 (2026-07-25): a GEF COLUMNVOID reading arrives as ``None``
    in the qc series and, before the fix, raised ``TypeError`` inside
    ``suggest_geotech_subdivision`` (``None >= threshold`` / ``median([…, None, …])``),
    failing the whole ``SubdivideAllBodies`` run on ordinary real data.

    This test punches a ~1 m contiguous void into CPT-P's TOP litho layer
    (0–4 m ZAND). That span trips the ≥5 cm continuous-gap review rule, so the
    0–4 m unit must become a needs-review (``nad_class`` None) geotech unit, while
    CPT-P's untouched 4–8 m dense zone (qc 22 MPa) must still classify to a real
    NAD class.

    Asserts:
    VOID-1  The use case COMPLETES without raising (TypeError was the failure mode).
    VOID-2  CPT-P's 0–4 m unit is needs-review (``nad_class`` None) — never a guess.
    VOID-3  CPT-P's 4–8 m unit still classifies to a real NAD class (good data used).

    Run via the integration wrapper:
        .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py
    """
    scene = multi_layer_body_scene
    project = scene["project"]
    litho_model_id = scene["litho_model"].id
    cpt_p_id = scene["cpt_p_id"]

    # Inject void (None) qc over ~1 m inside CPT-P's 0–4 m ZAND layer. CPT-P's top
    # zone is 200 samples at 0.02 m (0.00–3.98 m); indices 60–110 span ≈1.2–2.2 m.
    series = (
        await db_session.execute(select(CptSeriesOrm).where(CptSeriesOrm.cpt_id == cpt_p_id))
    ).scalar_one()
    qc = list(series.qc_mpa)
    for i in range(60, 111):
        qc[i] = None  # a contiguous void run — real COLUMNVOID data
    series.qc_mpa = qc
    await db_session.commit()

    # VOID-1: the run must COMPLETE — a void qc used to raise TypeError here.
    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = result.geotech_model_id

    # Collect CPT-P's geotech units and the NAD class of each unit's formation.
    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id == cpt_p_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert layers, "expected CPT-P to have geotech units after subdivide"

    formation_ids = {lyr.formation_id for lyr in layers}
    forms = {
        f.id: f
        for f in (
            await db_session.execute(
                select(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(formation_ids))
            )
        )
        .scalars()
        .all()
    }
    top_classes = {
        forms[lyr.formation_id].nad_class for lyr in layers if lyr.depth_base_m <= 4.0 + 1e-6
    }
    bottom_classes = {
        forms[lyr.formation_id].nad_class for lyr in layers if lyr.depth_top_m >= 4.0 - 1e-6
    }

    # VOID-2: the void 0–4 m unit is flagged needs-review (None), not a guessed class.
    assert None in top_classes, (
        f"VOID-2: the void 0–4 m unit should be needs-review (nad_class None); got {top_classes}"
    )
    # VOID-3: the untouched dense 4–8 m unit still classifies to a real NAD class.
    assert bottom_classes and all(c is not None for c in bottom_classes), (
        f"VOID-3: the untouched 4–8 m unit should classify to a real NAD class; got {bottom_classes}"
    )


@pytest.mark.asyncio
async def test_geotech_body_id_survives_project_reopen(
    multi_layer_body_scene: dict,
    db_session: AsyncSession,
) -> None:
    """A saved geotech project reopens with its geotech body grouping intact.

    Regression for the geotech-reopen defect (2026-07-25): on restore, every litho
    layer's ``body_id`` is popped (``bundle_restore_litho.py``) and the restore
    endpoint re-stamps it by re-running ``ResolveLithoInstances`` via
    ``reconcile_bodies_after_restore``. That reconcile originally covered only
    lithostratigraphic models, so geotech layers reopened with ``body_id = NULL``,
    silently breaking the geotech body grouping (and dangling
    ``sample.geotech_body_id``) until the next subdivide.

    Exercises the real save/reopen pipeline at the DB level: build_project_bundle →
    restore_project_bundle (replace) → reconcile_bodies_after_restore (the endpoint's
    post-restore step), and asserts every geotech ``litho_layer.body_id`` survives.
    """
    scene = multi_layer_body_scene
    project = scene["project"]
    litho_model_id = scene["litho_model"].id

    # Build the geotech model — SubdivideAllBodies stamps geotech body_id via the
    # resolver (ResolveLithoInstances on the geotech model). Commits internally.
    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = result.geotech_model_id

    async def _geotech_body_ids() -> list:
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

    # Save the project (build bundle) then reopen it (wipe + restore + reconcile),
    # mirroring the POST /restore endpoint's post-restore reconcile step.
    bundle = await build_project_bundle(db_session, project)

    # The real reopen runs in a FRESH request session that has never seen the
    # subdivide's ORM objects. Reuse of this test session means SubdivideAllBodies'
    # edge/layer objects linger in the identity map; a replace-restore then wipes
    # their rows and re-inserts new ones, so autoflush would try to re-insert the
    # stale edges (FK-violating on the deleted layers). Expunge to match the
    # fresh-session reality before restoring.
    db_session.expunge_all()
    project = await db_session.get(ProjectOrm, project.id)
    assert project is not None

    await restore_project_bundle(
        db_session,
        project.id,
        bundle["project"],
        bundle.get("cpts", []),
        bundle.get("boreholes", []),
        bundle.get("geological_formations", []),
        bundle.get("geological_models", []),
        bundle.get("cross_sections", []),
        bundle.get("investigation_reviews", []),
        bodies_payload=bundle.get("bodies", []),
        formation_absences_payload=bundle.get("formation_absences", []),
        litho_contact_correlation_edges_payload=bundle.get("litho_contact_correlation_edges", []),
        body_boundary_shapes_payload=bundle.get("body_boundary_shapes", []),
        body_boundary_nodes_payload=bundle.get("body_boundary_nodes", []),
        replace=True,
    )
    await reconcile_bodies_after_restore(db_session, project.id)
    await db_session.commit()

    after = await _geotech_body_ids()
    assert after, "geotech layers must exist after reopen"
    assert all(b is not None for b in after), (
        "geotech litho_layer.body_id must survive project reopen — the post-restore "
        "reconcile must re-stamp geotech bodies, not only litho models"
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
            "parent_model_id": geo_model_id,
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
        if layer_formation.get(edge.layer_a_id) != layer_formation.get(edge.layer_b_id)
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
            "parent_model_id": geo_model_id,
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
# DB-EDGE-SEC — DivideBoreholes edge dedup must be PER SECTION
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def borehole_two_section_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """One CPT + one borehole correlated on TWO sections, for the per-section
    edge-dedup test.

    CPT-A (two-band loose/dense qc profile) and BH-S (ZAND log, no qc) both sit
    within the ±200 m buffer of two parallel sections S1 (y=200_000) and S2
    (y=200_100).  BH-S is correlated to CPT-A on BOTH sections, so the SAME
    borehole-mediated litho edge (CPT-A layer ↔ BH-S layer) is approved on each
    section.

    After ``DivideBoreholes`` materialises BH-S's geotech bands and derives the
    borehole-mediated geotech edges, the SAME geotech layer pair (BH-S band ↔
    CPT-A band) must be emitted on EACH section — a per-section dedup contract.
    A model-global dedup set would emit it only on the first section processed.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_s1_id``,
        ``section_s2_id``, ``cpt_a_id``, ``bh_s_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="BH two-section edge scene", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "BTS-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "BTS-Litho", "kind": "lithostratigraphic", "parent_model_id": geo_model_id},
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec1_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "BTS-S1",
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

    sec2_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "BTS-S2",
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

    # CPT-A at y=200_050 — within both ±200 m section buffers.  Two-band profile
    # (loose 0–4 m, dense 4–8 m) so DivideBoreholes TIN-splits BH-S into matching
    # bands, giving a same-class pair to correlate.
    depths_a, qc_a = _two_layer_qc(n_top=200, n_bot=200, qc_top=8.0, qc_bot=18.0)
    cpt_a = CptOrm(
        id=uuid7(),
        name="BTS-CPT-A",
        cpt_type="CPTU",
        project_id="BTS",
        test_id="BTS/CPT-A",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_050.0,
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
    bh_s = BoreholeOrm(
        id=uuid7(),
        name="BTS-BH-S",
        app_project_id=proj.id,
        project_id="BTS",
        test_id="BTS/BH-S",
        location_x=149_300.0,
        location_y=200_050.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )
    db_session.add_all([cpt_a, bh_s])
    await db_session.commit()

    cpt_a_contact = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_a.id), top=0.0, base=8.0, soil="ZAND"
    )
    bh_s_contact = await _accept_borehole_litho(
        async_client, pid, litho_model_id, borehole_id=str(bh_s.id), top=0.0, base=8.0, soil="ZAND"
    )

    # Correlate CPT-A ↔ BH-S on BOTH sections — same litho layer pair, twice.
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=cpt_a_contact,
        contact_b=bh_s_contact,
        section_id=section_s1_id,
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=cpt_a_contact,
        contact_b=bh_s_contact,
        section_id=section_s2_id,
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_s1_id": section_s1_id,
        "section_s2_id": section_s2_id,
        "cpt_a_id": cpt_a.id,
        "bh_s_id": bh_s.id,
    }


@pytest.mark.asyncio
async def test_divide_boreholes_edge_dedup_is_per_section(
    borehole_two_section_scene: dict,
    db_session: AsyncSession,
) -> None:
    """A borehole-mediated geotech layer pair on two sections must yield an edge
    on EACH section.

    Geotech edges are section-scoped (per-section uniqueness on the layer pair),
    so the SAME pair ``(BH-S band, CPT-A band)`` correlated on S1 and S2 must
    produce one edge per section.  DivideBoreholes derived the borehole edges
    with a single MODEL-GLOBAL dedup set, so the pair emitted on the first
    section suppressed the legitimate edge on the second → a missing band render
    there (external review finding).  The fix keys the dedup per section.

    DBS-1  ≥1 borehole-mediated geotech edge on section S1.
    DBS-2  ≥1 borehole-mediated geotech edge on section S2 (the bug dropped this).
    """
    project = borehole_two_section_scene["project"]
    litho_model_id = UUID(borehole_two_section_scene["litho_model_id"])
    section_s1_id = UUID(borehole_two_section_scene["section_s1_id"])
    section_s2_id = UUID(borehole_two_section_scene["section_s2_id"])
    bh_s_id = borehole_two_section_scene["bh_s_id"]

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = sab_result.geotech_model_id

    # Materialise BH-S bands + derive the borehole-mediated edges (per section).
    await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # BH-S's geotech layer ids (the borehole endpoint of each edge).
    bh_layer_ids = set(
        (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == bh_s_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    assert bh_layer_ids, "precondition: DivideBoreholes must materialise BH-S geotech bands"

    # All geotech edges that reference a BH-S band, grouped by section.
    bh_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id.in_(bh_layer_ids)
                    | LithoContactCorrelationEdgeOrm.layer_b_id.in_(bh_layer_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    edges_s1 = [e for e in bh_edges if e.section_id == section_s1_id]
    edges_s2 = [e for e in bh_edges if e.section_id == section_s2_id]

    # DBS-1: S1 gets its borehole-mediated edge.
    assert len(edges_s1) >= 1, (
        f"DBS-1: no borehole-mediated geotech edge on section S1 (BH-S bands={len(bh_layer_ids)})"
    )
    # DBS-2: S2 gets its OWN edge for the same pair — this is what the
    # model-global dedup set suppressed.
    assert len(edges_s2) >= 1, (
        "DBS-2: no borehole-mediated geotech edge on section S2 — the same "
        "layer pair emitted on S1 suppressed it (model-global dedup bug). "
        "Edges must be deduped per section."
    )


# ---------------------------------------------------------------------------
# BH-E1 — BOREHOLE EXTRAPOLATION: borehole gets NAD class from nearest CPT
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def borehole_extrapolation_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene for the borehole skeleton test (formerly "borehole extrapolation").

    One CPT (CPT-REF) and one borehole (BH-ALONE) with the SAME lithology
    (ZAND) and overlapping depth ranges.  BH-ALONE has no CPT in its body
    group (borehole-only body).  CPT-REF is in a separate body.

    Under the Task-2 TIN-division design, a borehole in a CPT-free body
    receives ONE skeleton band (nad_class=None) because there are no CPT
    split surfaces to interpolate.  The old nearest-CPT extrapolation path
    is retired.

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
            "parent_model_id": geo_model_id,
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
    """BH-E1: SAB leaves boreholes without geotech layers (deferred to DivideBoreholes).

    BH-ALONE is a standalone ZAND borehole in its own litho body — no CPT is
    correlated to it.  CPT-REF is a separate ZAND body.  After
    SubdivideAllBodies, BH-ALONE's geotech materialisation uses the new
    TIN-division path (Phase 8c).  Because the body has NO CPT split surfaces,
    Phase 8c materialises ONE skeleton band spanning the full geo-bounded extent
    and keeps ``nad_class = None``.

    The old nearest-CPT extrapolation path (Phase 8b) is retired.  A borehole
    in a CPT-free body stays skeleton; cross-body class assignment belongs to
    the user's manual correlate gesture.

    BH-E1a  ``borehole_only_count >= 1``: BH-ALONE's body group was counted as
             borehole-only (no CPT segs in the group).
    BH-E1b  ``divided_borehole_count == 0``: BH-ALONE was NOT TIN-divided
             (no CPT transition surfaces in its body → stays as one band).
    BH-E1c  BH-ALONE has exactly ONE accepted geotech ``litho_layer`` row
             whose formation carries ``nad_class = None`` (skeleton).
    """
    project = borehole_extrapolation_scene["project"]
    litho_model_id = UUID(borehole_extrapolation_scene["litho_model_id"])
    bh_alone_id = borehole_extrapolation_scene["bh_alone_id"]

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    geotech_model_id = result.geotech_model_id

    # BH-E1a: BH-ALONE's body was identified as borehole-only.
    assert result.borehole_only_count >= 1, (
        f"BH-E1a: expected borehole_only_count >= 1, got {result.borehole_only_count}; "
        f"BH-ALONE (no CPT in body group) must be classified as borehole-only"
    )

    # BH-E1c: SAB writes NO borehole geotech layers — borehole division is deferred.
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
    assert len(bh_layers) == 0, (
        f"BH-E1c: expected 0 geotech layers for BH-ALONE after SAB alone, "
        f"got {len(bh_layers)} — borehole bands must only appear after DivideBoreholes"
    )


# ---------------------------------------------------------------------------
# SAB-BH1 — TIN-based geometric division of borehole by connected-body split
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def borehole_tin_division_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene for the TIN-based borehole geometric-division test.

    Two CPTs in the same litho body (CPT-S1 and CPT-S2) carry a ZAND profile
    that splits from matig (moderate) to dicht (dense) at DIFFERENT depths:
    CPT-S1 transitions at 4.0 m, CPT-S2 transitions at 5.0 m.  A borehole
    (BH-S) between them logs only that ZAND unit (no qc) and is correlated to
    CPT-S1 on the section.

    After ``SubdivideAllBodies``, the borehole must be divided into TWO geotech
    layers whose split depth is the TIN-interpolation of the two CPTs'
    packing-transition surface at the borehole's XY.  The borehole sits at
    x=149 300 m (between CPT-S1 at 149 000 m and CPT-S2 at 149 600 m), so
    the interpolated split is 4.0 + (5.0 - 4.0) * (300 / 600) = 4.5 m ± 0.5 m
    (linear in x since both CPTs share y=200 000 m and the surface is a flat
    TIN across two control points — flat-mean fallback since <3 non-collinear
    points).

    CPT-S1 qc profile:
        depths  0 – 4 m  : 8 MPa   (matig, NAD ≈ class 8–12)
        depths  4 – 8 m  : 18 MPa  (dicht, NAD ≈ class 13–22)
    CPT-S2 qc profile:
        depths  0 – 5 m  : 8 MPa   (matig)
        depths  5 – 8 m  : 18 MPa  (dicht)

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_id``,
        ``bh_s_id``, ``cpt_s1_id``, ``cpt_s2_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="BH TIN division scene", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "BHT-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "BHT-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "BHT-Section",
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

    # CPT-S1: matig 0–4 m then dicht 4–8 m (200 + 200 samples at 0.02 m step).
    depths_s1, qc_s1 = _two_layer_qc(n_top=200, n_bot=200, qc_top=8.0, qc_bot=18.0)
    # CPT-S2: matig 0–5 m then dicht 5–8 m (250 + 150 samples at 0.02 m step).
    depths_s2, qc_s2 = _two_layer_qc(n_top=250, n_bot=150, qc_top=8.0, qc_bot=18.0)

    cpt_s1 = CptOrm(
        id=uuid7(),
        name="CPT-S1",
        cpt_type="CPTU",
        project_id="BHT",
        test_id="BHT/CPT-S1",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_s1.series = CptSeriesOrm(
        depths_m=depths_s1,
        qc_mpa=qc_s1,
        fs_mpa=[0.05] * len(depths_s1),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_s2 = CptOrm(
        id=uuid7(),
        name="CPT-S2",
        cpt_type="CPTU",
        project_id="BHT",
        test_id="BHT/CPT-S2",
        app_project_id=proj.id,
        location_x=149_600.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_s2.series = CptSeriesOrm(
        depths_m=depths_s2,
        qc_mpa=qc_s2,
        fs_mpa=[0.05] * len(depths_s2),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    bh_s = BoreholeOrm(
        id=uuid7(),
        name="BH-S",
        app_project_id=proj.id,
        project_id="BHT",
        test_id="BHT/BH-S",
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )
    db_session.add_all([cpt_s1, cpt_s2, bh_s])
    await db_session.commit()

    # Accept one ZAND litho layer per investigation (0–8 m).
    cs1_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_s1.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    cs2_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_s2.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    bhs_id = await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_s.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )

    # Correlate all three into the SAME litho body.
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=cs1_id,
        contact_b=cs2_id,
        section_id=section_id,
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=cs1_id,
        contact_b=bhs_id,
        section_id=section_id,
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "bh_s_id": bh_s.id,
        "cpt_s1_id": cpt_s1.id,
        "cpt_s2_id": cpt_s2.id,
    }


@pytest.mark.asyncio
async def test_sab_bh1_tin_geometric_division(
    borehole_tin_division_scene: dict,
    db_session: AsyncSession,
) -> None:
    """SAB-BH1: SAB alone writes no borehole layers; DivideBoreholes TIN-divides them.

    CPT-S1 (matig 0-4 m / dicht 4-8 m) and CPT-S2 (matig 0-5 m / dicht 5-8 m)
    are in the same litho body as BH-S.  SubdivideAllBodies must NOT write any
    geotech layers for BH-S; DivideBoreholes must produce TWO geotech layers
    (matig over dicht) whose split depth is interpolated from the two CPTs'
    packing-transition elevation at the borehole's XY coordinate.

    BH1-0  After SAB alone, BH-S has 0 geotech layers.
    BH1-1  After DivideBoreholes, BH-S has exactly 2 accepted geotech layers.
    BH1-2  Borehole layers inherit the nearest same-class CPT's geotech body_id
           (Task B); a no-same-class-CPT fallback band stays None.
    BH1-3  The split depth on BH-S lies between 3.5 m and 5.5 m — within ±1 m
           of the expected TIN interpolation (~4.5 m, mean of CPT splits).
    BH1-4  Tiling invariant: BH-S's two layers tile 0–8 m continuously (no gap
           or overlap > 1 mm).
    """
    project = borehole_tin_division_scene["project"]
    litho_model_id = UUID(borehole_tin_division_scene["litho_model_id"])
    bh_s_id = borehole_tin_division_scene["bh_s_id"]

    sab_result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = sab_result.geotech_model_id

    # BH1-0: SAB must NOT write borehole geotech layers.
    bh_layers_after_sab = (
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
    assert len(bh_layers_after_sab) == 0, (
        f"BH1-0: expected 0 geotech layers for BH-S after SAB alone, "
        f"got {len(bh_layers_after_sab)} — borehole division belongs in DivideBoreholes"
    )

    # Run DivideBoreholes and assert the TIN division is now materialised.
    await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # The engineer accepts the packing ties both passes proposed. Since
    # 2026-08-01 a derived tie is a proposal, and the resolver unions approved
    # edges only — so without this step DivideBoreholes' closing resolver run
    # gives the borehole band a body of its own instead of joining it to the
    # CPT band it copied its body_id from (BH1-2 below).
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )

    # Load all accepted geotech layers for BH-S post-DivideBoreholes.
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
    bh_layers_sorted = sorted(bh_layers, key=lambda ll: ll.depth_top_m)

    # BH1-1: exactly 2 geotech layers after DivideBoreholes.
    assert len(bh_layers_sorted) == 2, (
        f"BH1-1: expected 2 geotech layers for BH-S after DivideBoreholes, "
        f"got {len(bh_layers_sorted)}: "
        f"{[(ll.depth_top_m, ll.depth_base_m) for ll in bh_layers_sorted]}"
    )

    # Owner refinement 2026-08-06: the derived borehole ties that join these
    # bands into the CPT bodies now arrive PENDING (only litho-tie
    # restatements are born accepted, and this scene's connecting pairs are
    # not all restatements), and the resolver rightly ignores pending ties.
    # The inheritance invariant BH1-2 pins therefore holds AFTER the engineer
    # accepts — which is the step this mirrors here.
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )
    for ll in bh_layers_sorted:
        await db_session.refresh(ll)

    # BH1-2: borehole geotech layers inherit the nearest same-class CPT's
    # geotech body_id (Task B — DivideBoreholes stamps body_id via
    # assign_borehole_band_body, so a sample in the band resolves to the TRUE
    # geotech packing body, not the litho stand-in). A band with no same-class
    # CPT (a body_min / absolute_min fallback) keeps body_id=None.
    cpt_body_ids = {
        ll.body_id
        for ll in (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id.isnot(None),
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
        if ll.body_id is not None
    }
    assert any(ll.body_id is not None for ll in bh_layers_sorted), (
        "BH1-2: at least one BH-S geotech layer must inherit a CPT geotech "
        "body_id (Task B); all were None"
    )
    # BH1-2 (scoped 2026-08-06): the inheritance claim applies to the bands an
    # accepted tie CONNECTS — those must resolve into the CPT's packing body.
    # An untied fallback band (body_min / absolute_min) legitimately ends up
    # in its own singleton body after the model-wide resolve that acceptance
    # triggers; forcing it into a CPT body would fabricate a connection no
    # tie supports.
    bh_layer_id_set = {ll.id for ll in bh_layers_sorted}
    tied_bh_layer_ids: set[UUID] = set()
    for e in (
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
    ):
        if e.layer_a_id in bh_layer_id_set:
            tied_bh_layer_ids.add(e.layer_a_id)
        if e.layer_b_id in bh_layer_id_set:
            tied_bh_layer_ids.add(e.layer_b_id)
    assert tied_bh_layer_ids, "BH1-2: expected at least one accepted tie to touch BH-S"
    for ll in bh_layers_sorted:
        if ll.id in tied_bh_layer_ids:
            assert ll.body_id in cpt_body_ids, (
                f"BH1-2: TIED BH-S geotech layer at [{ll.depth_top_m:.2f}, {ll.depth_base_m:.2f}] "
                f"has body_id={ll.body_id} not matching any CPT geotech body — an "
                "accepted tie must resolve the band into the CPT's packing body"
            )

    # BH1-3: split depth lies between 3.5 m and 5.5 m.
    # CPT-S1 splits at 4.0 m (elev 1.0 m), CPT-S2 at 5.0 m (elev 0.0 m).
    # Mean elevation 0.5 m → BH-S split depth = 5.0 - 0.5 = 4.5 m.
    split_depth = bh_layers_sorted[0].depth_base_m  # base of top (matig) layer
    assert 3.5 <= split_depth <= 5.5, (
        f"BH1-3: BH-S split depth {split_depth:.3f} m is outside [3.5, 5.5] m — "
        f"TIN interpolation of CPT-S1 (split=4.0 m) and CPT-S2 (split=5.0 m) "
        f"must place the borehole split near 4.5 m"
    )

    # BH1-4: tiling invariant (no gap > 1 mm between the two layers).
    tolerance = 0.001
    assert abs(bh_layers_sorted[0].depth_base_m - bh_layers_sorted[1].depth_top_m) <= tolerance, (
        f"BH1-4: BH-S layers are not contiguous: "
        f"layer[0].base={bh_layers_sorted[0].depth_base_m:.4f} m "
        f"!= layer[1].top={bh_layers_sorted[1].depth_top_m:.4f} m"
    )


# ---------------------------------------------------------------------------
# Bug-3 — CPT with two segments in the same body group (profiles_by_inv overwrite)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def cpt_multi_segment_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene that reproduces the ``profiles_by_inv`` dict-overwrite bug (Bug-3).

    CPT-P logs a uniform dense-sand profile over 0–10 m but has TWO accepted
    litho layers: ZAND [0–4 m] and ZAND [6–10 m] (a 2 m gap at 4–6 m).
    CPT-Q has one large ZAND layer over 0–10 m.

    The two layers are correlated so that:
        P-layer-1 (0–4 m)  ↔  Q-layer (0–10 m)
        P-layer-2 (6–10 m) ↔  Q-layer (0–10 m)

    The resolver places all three layers in the SAME connected component (same
    ``body_id``).  With no geo surfaces every pick is labelled ``None``, so
    CPT-P contributes TWO ``BodyLayerPick`` segments to one body group:

    * seg1: top=0.0 m, base=4.0 m  — from P-layer-1
    * seg2: top=6.0 m, base=10.0 m — from P-layer-2

    The profile-building loop appends two ``BandProfile`` entries for CPT-P
    (same ``investigation_id``).  Before the fix, ``_build_column_plans``
    constructs::

        profiles_by_inv = {p.investigation_id: p for p in profiles}

    — a plain dict keyed only on ``investigation_id``.  The second profile
    (for 6–10 m) silently overwrites the first (for 0–4 m).  When the first
    segment (0–4 m) looks up its profile, it receives splits centred on
    6–10 m; every split clamps entirely outside [0, 4] so ``sub_intervals``
    is empty and the skeleton fallback fires: ``nad_class = None``.

    After the fix, each segment must be matched to its OWN profile and both
    must receive a non-None NAD class.
    """
    proj = ProjectOrm(id=uuid7(), name="Bug3 multi-seg", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "B3-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "B3-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # Section wide enough to cover both CPTs; both sit on y=200_000.
    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "B3-Section",
            "start_x": 148_800.0,
            "start_y": 200_000.0,
            "end_x": 150_000.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # CPT-P: 500 samples at 0.02 m step covering 0–9.98 m, uniform qc = 15 MPa.
    # Two ZAND layers will be accepted: [0–4 m] and [6–10 m].
    n_pts = 500
    depths_p = [round(i * 0.02, 3) for i in range(n_pts)]
    qc_p = [15.0] * n_pts  # dense sand throughout

    cpt_p = CptOrm(
        id=uuid7(),
        name="CPT-P-multi",
        cpt_type="CPTU",
        project_id="B3",
        test_id="B3/CPT-P",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt_p.series = CptSeriesOrm(
        depths_m=depths_p,
        qc_mpa=qc_p,
        fs_mpa=[0.05] * n_pts,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-Q: same depth range and qc — serves as the shared hub that ties
    # both of CPT-P's layers into one body via correlation edges.
    cpt_q = CptOrm(
        id=uuid7(),
        name="CPT-Q-anchor",
        cpt_type="CPTU",
        project_id="B3",
        test_id="B3/CPT-Q",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    cpt_q.series = CptSeriesOrm(
        depths_m=depths_p,
        qc_mpa=qc_p,
        fs_mpa=[0.05] * n_pts,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    db_session.add_all([cpt_p, cpt_q])
    await db_session.commit()

    # Accept CPT-P layer 1: ZAND [0–4 m]
    p1 = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_p.id),
        top=0.0,
        base=4.0,
        soil="ZAND",
    )
    # Accept CPT-P layer 2: ZAND [6–10 m]
    p2 = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_p.id),
        top=6.0,
        base=10.0,
        soil="ZAND",
    )
    # Accept CPT-Q: one big ZAND [0–10 m]
    q1 = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_q.id),
        top=0.0,
        base=10.0,
        soil="ZAND",
    )

    # Correlate p1 ↔ q1 and p2 ↔ q1.  The resolver places all three layers
    # in the same connected component → same body_id → CPT-P has TWO segments
    # in the same body group (geology labels the picks; it never splits them).
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=p1,
        contact_b=q1,
        section_id=section_id,
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=p2,
        contact_b=q1,
        section_id=section_id,
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_p_id": cpt_p.id,
        "cpt_q_id": cpt_q.id,
    }


@pytest.mark.asyncio
async def test_sab_bug3_cpt_multi_segment_profile_overwrite(
    cpt_multi_segment_scene: dict,
    db_session: AsyncSession,
) -> None:
    """Bug-3 regression: a CPT with two segments in the same body group gets classified.

    Without the fix, ``_build_column_plans`` builds::

        profiles_by_inv = {p.investigation_id: p for p in profiles}

    For CPT-P — which produces TWO ``BandProfile`` entries (one per segment) —
    this keeps only the LAST profile.  The FIRST segment receives the wrong
    profile; every split clamps outside the first segment's depth range →
    ``sub_intervals`` is empty → skeleton fallback → ``nad_class = None``.

    With the fix, each segment is looked up by ``(investigation_id, top_depth_m)``
    so it always receives its own profile.  Both CPT-P segments must be classified.

    B3-1  CPT-P's geotech layer closest to 0 m has a non-None nad_class.
    B3-2  CPT-P's geotech layer closest to 6 m has a non-None nad_class.
    """
    project = cpt_multi_segment_scene["project"]
    litho_model_id = UUID(cpt_multi_segment_scene["litho_model_id"])
    cpt_p_id: UUID = cpt_multi_segment_scene["cpt_p_id"]

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = result.geotech_model_id

    # Load all accepted geotech layers for CPT-P, sorted shallowest-first.
    p_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id == cpt_p_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    p_layers_sorted = sorted(p_layers, key=lambda ll: ll.depth_top_m)

    assert len(p_layers_sorted) >= 2, (
        f"Bug-3: expected at least two geotech layers for CPT-P (one for 0–4 m, "
        f"one for 6–10 m), got {len(p_layers_sorted)} — both accepted segments "
        "must be materialised"
    )

    # B3-1: the layer covering [0–4 m] must have a classified nad_class.
    # It is the shallowest accepted layer (depth_top_m closest to 0.0).
    first_layer = p_layers_sorted[0]
    assert first_layer.depth_top_m < 0.01, (
        f"B3-1: shallowest CPT-P geotech layer starts at "
        f"{first_layer.depth_top_m:.3f} m — expected ≈ 0.0 m"
    )
    first_formation = await db_session.get(GeologicalFormationOrm, first_layer.formation_id)
    assert first_formation is not None
    assert first_formation.nad_class is not None, (
        f"B3-1: CPT-P ZAND [0–4 m] has nad_class=None (skeleton fallback). "
        f"The profiles_by_inv dict-overwrite bug is not fixed: CPT-P's two-segment "
        f"body group caused the 6–10 m profile to overwrite the 0–4 m profile, "
        f"leaving the 0–4 m segment with splits that clamp outside its range → null. "
        f"Formation: {first_formation.name!r}"
    )

    # B3-2: the layer covering [6–10 m] must also be classified.
    # Without the fix whichever segment is overwritten in profiles_by_inv gets null;
    # depending on iteration order either B3-1 or B3-2 fails — we assert both.
    deep_layers = [ll for ll in p_layers_sorted if ll.depth_top_m >= 5.5]
    assert len(deep_layers) >= 1, (
        "B3-2: no CPT-P geotech layer starts at or below 5.5 m — "
        "the 6–10 m segment must materialise at least one geotech layer"
    )
    deep_layer = deep_layers[0]
    deep_formation = await db_session.get(GeologicalFormationOrm, deep_layer.formation_id)
    assert deep_formation is not None
    assert deep_formation.nad_class is not None, (
        f"B3-2: CPT-P ZAND [6–10 m] has nad_class=None (skeleton fallback). "
        f"Formation: {deep_formation.name!r}"
    )


# ---------------------------------------------------------------------------
# LCS connectivity -- two CPTs, same litho body, differing packing sequences
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def sab_lcs_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Scene for the LCS geotech-connectivity regression test.

    Two CPTs share ONE litho body (a ZAND correlation edge) but have
    DIFFERENT packing-class sequences:

    * **CPT-G** has a two-layer qc profile: loose (3 MPa, 0-4 m) then
      dense (22 MPa, 4-8 m) -- geotech segments [<loose>, <dense>].
    * **CPT-H** has a uniform-dense qc profile (22 MPa, 0-8 m) --
      geotech segment [<dense>].

    The old ``aligned_same_sequence_pairs`` rule returned [] (length mismatch
    -- no auto-connect).  The new LCS rule computes
    ``LCS([loose,dense],[dense]) = [dense]`` and emits ONE edge between
    CPT-G's dense band and CPT-H's band.

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``section_id``,
        ``cpt_g_id``, ``cpt_h_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="SAB-LCS test project", status="active")
    db_session.add(proj)
    await db_session.flush()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "LCS-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "LCS-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "LCS-Section",
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

    # CPT-G: two-layer qc (loose top 0-4 m @ 3 MPa / dense base 4-8 m @ 22 MPa).
    depths_g, qc_g = _two_layer_qc(n_top=200, n_bot=200, qc_top=3.0, qc_bot=22.0)
    cpt_g = CptOrm(
        id=uuid7(),
        name="CPT-G",
        cpt_type="CPTU",
        project_id="LCS",
        test_id="LCS/CPT-G",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_g.series = CptSeriesOrm(
        depths_m=depths_g,
        qc_mpa=qc_g,
        fs_mpa=[0.05] * len(depths_g),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # CPT-H: uniform dense (22 MPa, 0-8 m) -- one packing band only.
    depths_h, qc_h = _qc_series(n=400, qc_mpa=22.0)
    cpt_h = CptOrm(
        id=uuid7(),
        name="CPT-H",
        cpt_type="CPTU",
        project_id="LCS",
        test_id="LCS/CPT-H",
        app_project_id=proj.id,
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_h.series = CptSeriesOrm(
        depths_m=depths_h,
        qc_mpa=qc_h,
        fs_mpa=[0.05] * len(depths_h),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    db_session.add_all([cpt_g, cpt_h])
    await db_session.commit()

    # Accept one ZAND litho layer 0-8 m on each CPT, then correlate them
    # so they land in the same litho body after the resolver.
    cg_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_g.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    ch_id = await _accept_cpt_litho(
        async_client,
        pid,
        litho_model_id,
        cpt_id=str(cpt_h.id),
        top=0.0,
        base=8.0,
        soil="ZAND",
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=cg_id,
        contact_b=ch_id,
        section_id=section_id,
    )

    return {
        "project": proj,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_g_id": str(cpt_g.id),
        "cpt_h_id": str(cpt_h.id),
    }


@pytest.mark.asyncio
async def test_sab_lcs_connectivity(
    sab_lcs_scene: dict,
    db_session: AsyncSession,
) -> None:
    """LCS-1: differing packing sequences connect via the shared dense class.

    CPT-G segments [<loose>, <dense>] and CPT-H has [<dense>].
    With the old full-sequence rule the length mismatch yields 0 auto-edges.
    With the new LCS rule the shared dense class yields >= 1 geotech edge
    connecting CPT-G's dense band to CPT-H's band, placing them in the same
    geotech body instead of two isolated bodies.

    LCS-1a  At least one geotech edge exists between CPT-G and CPT-H.
    LCS-1b  Every geotech edge between CPT-G and CPT-H connects same-class bands.
    LCS-1c  Once the engineer accepts the tie, CPT-G and CPT-H share at least one
            geotech body_id (dense bands end up in the same resolved body). The
            accept step is load-bearing: since 2026-08-01 a derived tie is a
            proposal, and the resolver unions approved edges only.
    """
    project = sab_lcs_scene["project"]
    litho_model_id = UUID(sab_lcs_scene["litho_model_id"])
    cpt_g_uuid = UUID(sab_lcs_scene["cpt_g_id"])
    cpt_h_uuid = UUID(sab_lcs_scene["cpt_h_id"])

    result = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = result.geotech_model_id

    # Load all accepted geotech layers for both CPTs.
    geotech_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id.in_([cpt_g_uuid, cpt_h_uuid]),
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    g_layer_ids = {layer.id for layer in geotech_layers if layer.cpt_id == cpt_g_uuid}
    h_layer_ids = {layer.id for layer in geotech_layers if layer.cpt_id == cpt_h_uuid}
    layer_formation = {layer.id: layer.formation_id for layer in geotech_layers}

    all_geotech_edges = (
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
    cross_edges = [
        e
        for e in all_geotech_edges
        if (e.layer_a_id in g_layer_ids and e.layer_b_id in h_layer_ids)
        or (e.layer_b_id in g_layer_ids and e.layer_a_id in h_layer_ids)
    ]

    # LCS-1a: at least one geotech edge connects CPT-G to CPT-H.
    assert len(cross_edges) >= 1, (
        f"LCS-1a: expected >= 1 geotech edge between CPT-G and CPT-H after "
        f"LCS alignment, got 0.  CPT-G layers={len(g_layer_ids)}, "
        f"CPT-H layers={len(h_layer_ids)}.  Regression case: the old "
        f"full-sequence rule returned [] because stacks differ in length "
        f"([loose,dense] vs [dense])."
    )

    # LCS-1b (RE-PINNED, owner rulings 2026-08-13/14): the stacks are
    # [loose,dense] vs [dense]. The litho tie joins the two units' TOP
    # surfaces — its restatement is loose-top ↔ dense-top, CROSS-CLASS, born
    # accepted (the forced-topmost pair). The dense↔dense BODY pair is a
    # machine claim about the interior — the overlap-gated pass proposes it
    # PENDING ("auto correlate is fine, its just a tool"), never accepted.
    assert len(cross_edges) == 2, (
        f"LCS-1b: expected the restatement + the interior body proposal "
        f"between CPT-G and CPT-H, got {len(cross_edges)} edge(s)"
    )
    accepted = [e for e in cross_edges if e.user_approved]
    pending = [e for e in cross_edges if not e.user_approved]
    assert len(accepted) == 1 and len(pending) == 1
    assert layer_formation.get(accepted[0].layer_a_id) != layer_formation.get(
        accepted[0].layer_b_id
    ), (
        "LCS-1b: the restatement joins the two TOPMOST bands (loose vs "
        "dense) — a cross-class pair by construction in this scene"
    )
    assert layer_formation.get(pending[0].layer_a_id) == layer_formation.get(
        pending[0].layer_b_id
    ), "LCS-1b: the interior proposal joins the same-class dense bodies"
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=geotech_model_id,
    )
    geotech_layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id.in_([cpt_g_uuid, cpt_h_uuid]),
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )

    # LCS-1c: CPT-G and CPT-H share at least one geotech body_id once the
    # engineer accepts the interior proposal (the accept-all above) — the
    # dense bodies join through their own tie, the original review flow.
    g_body_ids = {
        layer.body_id for layer in geotech_layers if layer.cpt_id == cpt_g_uuid and layer.body_id
    }
    h_body_ids = {
        layer.body_id for layer in geotech_layers if layer.cpt_id == cpt_h_uuid and layer.body_id
    }
    shared_bodies = g_body_ids & h_body_ids
    assert len(shared_bodies) >= 1, (
        f"LCS-1c: CPT-G and CPT-H have no shared geotech body_id -- "
        f"dense bands should resolve into the same body once the engineer "
        f"accepts the LCS tie that connects them.  CPT-G bodies={g_body_ids}, "
        f"CPT-H bodies={h_body_ids}."
    )


# ---------------------------------------------------------------------------
# SAB-EMPTY — a rebuild with no litho picks clears prior geotech data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sab_empty_rebuild_clears_stale_geotech(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """A SAB rebuild after the litho model is emptied must wipe prior geotech data.

    The no-picks early-return path used to skip ``_delete_all_geotech_data``:
    it fired BEFORE the Phase-4 model-wide cleanup, so a rebuild after the litho
    picks were cleared left the previous run's geotech layers, bodies,
    formation-contact mirrors, and edges orphaned in the DB — the geotech model
    no longer reflected the (empty) litho input (external review finding).

    Steps:
        1. Run SAB on the populated scene → geotech layers/bodies/FCs/edges exist.
        2. Delete all litho layers + edges (empty the litho model).
        3. Re-run SAB → the result is zeroed AND the DB carries zero geotech
           layers, bodies, formation contacts, and edges for the geotech model.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])

    # -- Step 1: build geotech from the populated litho model -----------------
    first = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    geotech_model_id = first.geotech_model_id

    async def _count(model_cls, extra=None):  # noqa: ANN001, ANN202 — local helper
        """Count ``model_cls`` rows for the geotech model (optional extra filter)."""
        stmt = select(model_cls).where(model_cls.model_id == geotech_model_id)
        if extra is not None:
            stmt = stmt.where(extra)
        rows = (await db_session.execute(stmt)).scalars().all()
        return len(rows)

    layers_before = await _count(LithoLayerOrm, LithoLayerOrm.status == "accepted")
    bodies_before = await _count(BodyOrm)
    edges_before = await _count(LithoContactCorrelationEdgeOrm)
    assert layers_before >= 1, "precondition: SAB must materialise geotech layers"
    assert bodies_before >= 1, "precondition: SAB must materialise geotech bodies"
    assert edges_before >= 1, "precondition: SAB must derive geotech edges"

    # -- Step 2: empty the litho model (drop all its layers + edges) ----------
    await db_session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == litho_model_id
        )
    )
    await db_session.execute(delete(LithoLayerOrm).where(LithoLayerOrm.model_id == litho_model_id))
    await db_session.commit()

    # -- Step 3: re-run SAB on the now-empty litho model ----------------------
    second = await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    assert second.layer_count == 0, "empty rebuild must report zero geotech layers"
    assert second.body_count == 0, "empty rebuild must report zero geotech bodies"

    # The stale geotech content from run 1 must be gone.
    assert await _count(LithoLayerOrm, LithoLayerOrm.status == "accepted") == 0, (
        "stale geotech litho_layer rows survived an empty rebuild"
    )
    assert await _count(BodyOrm) == 0, "stale geotech BodyOrm rows survived an empty rebuild"
    assert await _count(FormationContactOrm) == 0, (
        "stale geotech formation_contact rows survived an empty rebuild"
    )
    assert await _count(LithoContactCorrelationEdgeOrm) == 0, (
        "stale geotech correlation-edge rows survived an empty rebuild"
    )


@pytest.mark.asyncio
async def test_confirming_a_flagged_tie_clears_the_flag_and_leaves_it_connected(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """The engineer says "that tie is right" → the flag goes, the tie stays.

    The flag is only half a workflow.  A re-subdivide raises it; the engineer
    resolves it by deleting the tie (the existing right-click delete) or by
    confirming it, which is this path.  Without the confirm the warning would be
    permanent and the section would fill up with flags nobody can clear.

    Confirming must not touch anything else: the tie stays approved, keeps its
    provenance, and still connects the same two bands.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])
    cpt_b_id = UUID(sab_scene["cpt_b_id"])

    first = await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    geotech_model_id = first.geotech_model_id
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id, model_id=geotech_model_id
    )

    # Re-classify CPT-B's deep half so the rebuild raises a class_changed flag.
    series = (
        await db_session.execute(select(CptSeriesOrm).where(CptSeriesOrm.cpt_id == cpt_b_id))
    ).scalar_one()
    series.qc_mpa = [3.0 if q < 10.0 else 12.0 for q in series.qc_mpa]
    await db_session.commit()
    second = await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    assert second.review_tie_reasons, "precondition: the rebuild flagged at least one tie"

    flagged_before = await _tie_fingerprints(
        db_session, geotech_model_id, approved_only=True, flagged_only=True
    )
    all_before = await _tie_fingerprints(db_session, geotech_model_id, approved_only=True)
    assert flagged_before, "precondition: at least one flagged tie is persisted"

    result = await ConfirmCorrelationEdgeReview(db_session).execute(model_id=geotech_model_id)

    assert result.edges_confirmed == len(flagged_before)
    assert not await _tie_fingerprints(
        db_session, geotech_model_id, approved_only=True, flagged_only=True
    ), "confirming must clear every flag"
    assert (
        await _tie_fingerprints(db_session, geotech_model_id, approved_only=True) == all_before
    ), "confirming must not move, drop or unapprove any tie"

    # Idempotent: nothing left to confirm, and that is a normal answer.
    again = await ConfirmCorrelationEdgeReview(db_session).execute(model_id=geotech_model_id)
    assert again.edges_confirmed == 0


@pytest.mark.asyncio
async def test_confirming_never_reaches_across_models(
    sab_scene: dict,
    db_session: AsyncSession,
) -> None:
    """An edge id from another model clears nothing.

    The statement is always constrained by ``model_id``, so a caller passing an
    edge that belongs elsewhere gets a no-op rather than silently clearing a flag
    on a model they did not name.
    """
    project = sab_scene["project"]
    litho_model_id = UUID(sab_scene["litho_model_id"])
    cpt_b_id = UUID(sab_scene["cpt_b_id"])

    first = await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )
    geotech_model_id = first.geotech_model_id
    await AcceptContactCorrelations(db_session).execute(
        project_id=project.id, model_id=geotech_model_id
    )
    series = (
        await db_session.execute(select(CptSeriesOrm).where(CptSeriesOrm.cpt_id == cpt_b_id))
    ).scalar_one()
    series.qc_mpa = [3.0 if q < 10.0 else 12.0 for q in series.qc_mpa]
    await db_session.commit()
    await SubdivideAllBodies(db_session).execute(
        project_id=project.id, litho_model_id=litho_model_id
    )

    flagged = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.review_reason.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert flagged, "precondition: a flagged edge exists"

    # Name the LITHO model but the GEOTECH model's edge.
    result = await ConfirmCorrelationEdgeReview(db_session).execute(
        model_id=litho_model_id, edge_id=flagged[0].id
    )

    assert result.edges_confirmed == 0
    await db_session.refresh(flagged[0])
    assert flagged[0].review_reason is not None, "the flag must survive a cross-model confirm"
