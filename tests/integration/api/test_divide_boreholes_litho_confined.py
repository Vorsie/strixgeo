"""Integration test: litho-confined borehole fill (Task 3 — CS1 crosscut gate).

Scenario (CS1 crosscut)
-----------------------
A borehole with two litho bodies (ZAND 0–4 m, KLEI 4–8 m) sits between two
ZAND CPTs that each carry a two-layer packing profile (loose 0–4 m / dense
4–8 m).  The CPTs are in the same ZAND litho body as the borehole's ZAND
extent.  The borehole's KLEI extent has no CPT neighbour.

Old behaviour (plain TIN): the CPT packing transition at 4 m was built from
ALL CPT layers in the body group, which included the CPT's packing data for
depths 4–8 m (dense ZAND).  When TIN-clamped to the borehole's KLEI extent
(4–8 m), those dense ZAND packing classes (7–10) landed on the KLEI bands —
a cross-lithology contamination.

New behaviour (litho-confined): each CPT's geotech layers are first clipped
to that CPT's own litho-body extent (ZAND 0–8 m for both CPTs here), then
the TIN-interpolated split depths are computed.  The borehole's KLEI extent
is a *separate body group* containing no CPTs, so it receives a conservative
``absolute_min`` fill (KLEI NAD class 21, confidence=low).

DB-1  0 borehole geotech bands where the NAD-class lithology family differs
      from the source litho formation's ``litho_main_soil_code``.
      (The invariant: packing class ⊆ lithology family.)
DB-2  0 NULL-class borehole geotech bands.
DB-3  BH-1's KLEI extent has ``confidence='low'`` (conservative fill — no
      same-lithology CPT exists).
DB-4  BH-1's ZAND extent has ≥ 1 band with ``confidence='high'`` (CPT-
      interpolated packing data reached the borehole).
DB-5  DivideBoreholes result: ``layer_count >= 1``.

Run via:
    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_divide_boreholes_litho_confined.py
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
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import paint_accepted_ties

# ---------------------------------------------------------------------------
# NAD class → lithology family helper (mirrors LITHO_ABSOLUTE_MIN_NAD's inverse)
# ---------------------------------------------------------------------------
_NAD_CLASS_FAMILY: list[tuple[range, str]] = [
    (range(1, 5), "GRIND"),  # 1–4
    (range(5, 13), "ZAND"),  # 5–12
    (range(13, 21), "SILT"),  # 13–20
    (range(21, 29), "KLEI"),  # 21–28
    (range(29, 32), "VEEN"),  # 29–31
]


def _nad_family(nad_class: int) -> str | None:
    """Return the soil family for a NAD packing class.

    Parameters
    ----------
    nad_class : int
        NAD packing class 1–31.

    Returns
    -------
    str | None
        Family string (``"GRIND"`` / ``"ZAND"`` / ``"SILT"`` / ``"KLEI"`` /
        ``"VEEN"``), or ``None`` if out of range.
    """
    for r, family in _NAD_CLASS_FAMILY:
        if nad_class in r:
            return family
    return None


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------


def _two_layer_qc(
    n_top: int,
    n_bot: int,
    qc_top: float,
    qc_bot: float,
) -> tuple[list[float], list[float]]:
    """Depth + qc arrays with a distinct top / bottom zone.

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
        ``(depths_m, qc_mpa)`` with samples at 0.02 m spacing.
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
    """POST one CPT litho suggestion acceptance; return the contact id.

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
    soil : str
        Main soil code.

    Returns
    -------
    str
        Created contact id.
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
    """POST one borehole litho suggestion acceptance; return the contact id.

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
    soil : str
        Main soil code.

    Returns
    -------
    str
        Created contact id.
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
async def cs1_project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for CS1 crosscut tests."""
    proj = ProjectOrm(id=uuid7(), name="CS1 crosscut project", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def cs1_scene(
    db_session: AsyncSession,
    cs1_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """CS1 crosscut scene: ZAND CPTs flanking a ZAND-over-KLEI borehole.

    Layout (x-axis, y=200_000 m)::

        CPT-1 (x=149_000)   BH-1 (x=149_300)   CPT-2 (x=149_600)
        ZAND 0–8 m           ZAND 0–4 m           ZAND 0–8 m
        (loose 0–4 / dense   KLEI 4–8 m           (loose 0–4 / dense
         4–8)                                       4–8)

    Correlations::

        CPT-1 ZAND ↔ BH-1 ZAND  (so BH-1's ZAND extent ∈ the ZAND body)
        CPT-1 ZAND ↔ CPT-2 ZAND (complete the ZAND body)

    BH-1's KLEI extent is standalone (no CPT neighbour in that body).

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``bh_1_id``.
    """
    pid = str(cs1_project.id)

    # Geo model (no surfaces → geo-bounding is a no-op).
    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "CS1-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    # Litho model parented to the geo model.
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "CS1-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # Section covering all three investigations.
    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "CS1-Section",
            "start_x": 148_900.0,
            "start_y": 200_000.0,
            "end_x": 149_700.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # Two-layer qc profile: loose (3 MPa) for 0–4 m (200 samples),
    # dense (22 MPa) for 4–8 m (200 samples).  Both CPTs are identical.
    depths, qc = _two_layer_qc(n_top=200, n_bot=200, qc_top=3.0, qc_bot=22.0)

    cpt_1 = CptOrm(
        id=uuid7(),
        name="CPT-CS1-1",
        cpt_type="CPTU",
        project_id="CS1",
        test_id="CS1/CPT-1",
        app_project_id=cs1_project.id,
        location_x=149_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_1.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    cpt_2 = CptOrm(
        id=uuid7(),
        name="CPT-CS1-2",
        cpt_type="CPTU",
        project_id="CS1",
        test_id="CS1/CPT-2",
        app_project_id=cs1_project.id,
        location_x=149_600.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=8.0,
    )
    cpt_2.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )

    # Borehole: ZAND 0–4 m, KLEI 4–8 m.
    bh_1 = BoreholeOrm(
        id=uuid7(),
        name="BH-CS1-1",
        app_project_id=cs1_project.id,
        project_id="CS1",
        test_id="CS1/BH-1",
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )

    db_session.add_all([cpt_1, cpt_2, bh_1])
    await db_session.commit()

    # Accept litho contacts.
    # CPT-1: ZAND 0–8 m (one layer)
    c1_id = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_1.id), top=0.0, base=8.0, soil="ZAND"
    )
    # CPT-2: ZAND 0–8 m
    c2_id = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_2.id), top=0.0, base=8.0, soil="ZAND"
    )
    # BH-1: ZAND 0–4 m
    bh_zand_id = await _accept_borehole_litho(
        async_client, pid, litho_model_id, borehole_id=str(bh_1.id), top=0.0, base=4.0, soil="ZAND"
    )
    # BH-1: KLEI 4–8 m (standalone — will form its own body with no CPT)
    await _accept_borehole_litho(
        async_client, pid, litho_model_id, borehole_id=str(bh_1.id), top=4.0, base=8.0, soil="KLEI"
    )

    # Correlations: build the ZAND body.
    # CPT-1 ZAND ↔ CPT-2 ZAND
    await _correlate(
        async_client, pid, litho_model_id, contact_a=c1_id, contact_b=c2_id, section_id=section_id
    )
    # CPT-1 ZAND ↔ BH-1 ZAND
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=c1_id,
        contact_b=bh_zand_id,
        section_id=section_id,
    )
    # BH-1 KLEI has no correlation → standalone KLEI body.

    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied chain ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project": cs1_project,
        "litho_model_id": litho_model_id,
        "bh_1_id": str(bh_1.id),
    }


# ---------------------------------------------------------------------------
# DB-1 through DB-5 — all assertions in one test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_divide_boreholes_litho_confined(
    cs1_scene: dict,
    db_session: AsyncSession,
) -> None:
    """DB-1 through DB-5: litho-confined borehole fill — CS1 crosscut gate.

    DB-1  0 borehole geotech bands where NAD-class family ≠ litho soil code.
    DB-2  0 NULL-class borehole geotech bands.
    DB-3  BH-1 KLEI extent: confidence='low' (no same-lithology CPT data).
    DB-4  BH-1 ZAND extent: ≥ 1 band with confidence='high' (CPT-interpolated).
    DB-5  DivideBoreholes result: layer_count >= 1.
    """
    project = cs1_scene["project"]
    litho_model_id = UUID(cs1_scene["litho_model_id"])
    bh_1_id = UUID(cs1_scene["bh_1_id"])

    # Run SAB first (materialises CPT geotech layers in the geotech model).
    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # Run DivideBoreholes (litho-confined borehole fill).
    db_result = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # DB-5: at least one geotech layer was written.
    assert db_result.layer_count >= 1, f"DB-5: layer_count={db_result.layer_count}, expected >= 1"

    # --- load all borehole geotech layers for BH-1 ---
    geotech_model_id = db_result.geotech_model_id
    bh_layers = (
        await db_session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
                LithoLayerOrm.formation_id,
                LithoLayerOrm.confidence,
            )
            .where(
                LithoLayerOrm.model_id == geotech_model_id,
                LithoLayerOrm.borehole_id == bh_1_id,
            )
            .order_by(LithoLayerOrm.depth_top_m)
        )
    ).all()

    assert len(bh_layers) >= 1, "Expected at least one borehole geotech layer for BH-1"

    # Load the geotech formation rows (and their source litho formations).
    formation_ids = {row.formation_id for row in bh_layers}
    geo_formations = {
        f.id: f
        for f in (
            await db_session.execute(
                select(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(formation_ids))
            )
        )
        .scalars()
        .all()
    }

    # Load the source litho formations.
    source_litho_ids = {
        f.source_litho_formation_id
        for f in geo_formations.values()
        if f.source_litho_formation_id is not None
    }
    source_litho_formations = {
        f.id: f
        for f in (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.id.in_(source_litho_ids)
                )
            )
        )
        .scalars()
        .all()
    }

    # --- DB-1 + DB-2: cross-family contamination check ---
    cross_family_violations: list[str] = []
    null_class_violations: list[str] = []

    for row in bh_layers:
        geo_f = geo_formations.get(row.formation_id)
        if geo_f is None:
            cross_family_violations.append(
                f"layer {row.id}: geotech formation {row.formation_id} not found"
            )
            continue

        # DB-2: NAD class must not be NULL.
        if geo_f.nad_class is None:
            null_class_violations.append(
                f"layer {row.id} depth [{row.depth_top_m:.2f},{row.depth_base_m:.2f}]: "
                f"nad_class is None"
            )
            continue

        # DB-1: NAD class family must match source litho soil code.
        source_litho = source_litho_formations.get(geo_f.source_litho_formation_id)  # type: ignore[arg-type]
        if source_litho is None:
            # No source litho FK → can't verify family.
            continue
        expected_family = source_litho.litho_main_soil_code
        actual_family = _nad_family(geo_f.nad_class)
        if actual_family != expected_family:
            cross_family_violations.append(
                f"layer {row.id} depth [{row.depth_top_m:.2f},{row.depth_base_m:.2f}]: "
                f"nad_class={geo_f.nad_class} (family={actual_family}) but "
                f"source_litho soil={expected_family}"
            )

    assert not null_class_violations, (
        f"DB-2: {len(null_class_violations)} NULL-class borehole band(s):\n"
        + "\n".join(null_class_violations)
    )
    assert not cross_family_violations, (
        f"DB-1: {len(cross_family_violations)} cross-family band(s):\n"
        + "\n".join(cross_family_violations)
    )

    # --- DB-3: KLEI extent must be confidence='low' ---
    klei_layers = []
    for row in bh_layers:
        geo_f = geo_formations.get(row.formation_id)
        if geo_f is None:
            continue
        src = source_litho_formations.get(geo_f.source_litho_formation_id)  # type: ignore[arg-type]
        if src is not None and src.litho_main_soil_code == "KLEI":
            klei_layers.append(row)

    assert len(klei_layers) >= 1, "DB-3: expected ≥ 1 KLEI borehole band for BH-1"
    bad_klei_confidence = [r for r in klei_layers if r.confidence != "low"]
    assert not bad_klei_confidence, (
        f"DB-3: KLEI bands must have confidence='low' (no same-lithology CPT data); "
        f"got confidence values: {[r.confidence for r in bad_klei_confidence]}"
    )

    # --- DB-4: ZAND extent must have ≥ 1 band with confidence='high' ---
    zand_layers = []
    for row in bh_layers:
        geo_f = geo_formations.get(row.formation_id)
        if geo_f is None:
            continue
        src = source_litho_formations.get(geo_f.source_litho_formation_id)  # type: ignore[arg-type]
        if src is not None and src.litho_main_soil_code == "ZAND":
            zand_layers.append(row)

    assert len(zand_layers) >= 1, "DB-4: expected ≥ 1 ZAND borehole band for BH-1"
    # CPT interpolation is proven by the PLAN's provenance, not the confidence.
    # This assertion used confidence='high' as the provenance proxy until the
    # 2026-08-11 owner ruling made confidence follow the donor DISTANCE — and
    # this scene's donors sit 300 m out, so every band honestly reads 'low' and
    # the proxy collapsed. The planner's own FillBand.source is the record:
    # 'cpt_interpolated' for the ZAND extent (same-litho donor data reached it),
    # never a conservative fallback token.
    replan = await DivideBoreholes(db_session).plan(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    zand_sources = {
        band.source
        for seg in replan.segments
        for band in seg.bands
        if (src := source_litho_formations.get(band.source_litho_formation_id)) is not None
        and src.litho_main_soil_code == "ZAND"
    }
    assert "cpt_interpolated" in zand_sources, (
        f"DB-4: the ZAND extent must be filled by CPT interpolation; plan "
        f"sources were {sorted(zand_sources)}"
    )
    # And the committed confidence tells the distance truth: 300 m from the
    # nearest donor is beyond the 200 m medium rung — 'low', honestly.
    assert all(r.confidence == "low" for r in zand_layers), (
        f"DB-4: 300 m donors must stamp 'low'; got {[r.confidence for r in zand_layers]}"
    )
