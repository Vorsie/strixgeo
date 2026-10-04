"""Integration test: sample geotech assignment (Task 4 — CS1 crosscut gate).

Scenario (CS1 crosscut with samples)
--------------------------------------
Reuses the CS1 crosscut fixture from
``test_divide_boreholes_litho_confined.py`` (ZAND CPTs flanking a
ZAND-over-KLEI borehole) and adds two samples to BH-1:

* SAND sample: depth_top=1.0, depth_base=1.5 m → midpoint 1.25 m inside the
  ZAND extent [0, 4] → must resolve to a ZAND NAD class (5–12) with a
  non-null ``geotech_body_id`` and ``geotech_assignment_source``.
* CLAY sample: depth_top=5.0, depth_base=5.5 m → midpoint 5.25 m inside the
  KLEI extent [4, 8] → must resolve to a KLEI NAD class (21–28).  The KLEI
  body has NO CPT members in this fixture (CPT-1 and CPT-2 are ZAND-only),
  so ``geotech_body_id`` is ``None`` (the conservative fallback path).

Assertions (SA = sample-assignment)
-------------------------------------
SA-1  sand sample ``geotech_nad_class`` is in [5, 12] (ZAND family).
SA-2  sand sample ``geotech_body_id`` is non-null (CPT-backed ZAND body).
SA-3  sand sample ``geotech_assignment_source`` is non-null.
SA-4  clay sample ``geotech_nad_class`` is in [21, 28] (KLEI family).
SA-5  clay sample ``geotech_body_id`` is ``None`` — the KLEI body in this
      fixture has no CPT members, so the borehole band is a conservative
      fallback with no same-class CPT evidence.
SA-6  clay sample ``geotech_assignment_source`` is non-null.
SA-7  NAD-class family of each sample does not contradict the sample's
      own depth interval (litho coherence: a ZAND depth must not get a
      KLEI NAD class).

Run via::

    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_sample_geotech_assignment.py
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
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from tests.integration.api.geotech_scene_helpers import paint_accepted_ties

# ---------------------------------------------------------------------------
# NAD class range helpers
# ---------------------------------------------------------------------------

_ZAND_NAD_RANGE = range(5, 13)  # 5–12 inclusive
_KLEI_NAD_RANGE = range(21, 29)  # 21–28 inclusive


def _in_zand(nad: int | None) -> bool:
    """Return True when *nad* falls in the ZAND family (5–12)."""
    return nad is not None and nad in _ZAND_NAD_RANGE


def _in_klei(nad: int | None) -> bool:
    """Return True when *nad* falls in the KLEI family (21–28)."""
    return nad is not None and nad in _KLEI_NAD_RANGE


# ---------------------------------------------------------------------------
# Scene helpers (adapted from test_divide_boreholes_litho_confined)
# ---------------------------------------------------------------------------


def _two_layer_qc(
    n_top: int,
    n_bot: int,
    qc_top: float,
    qc_bot: float,
) -> tuple[list[float], list[float]]:
    """Build depth + qc arrays with a top zone and a bottom zone.

    Parameters
    ----------
    n_top : int
        Sample count in the top zone.
    n_bot : int
        Sample count in the bottom zone.
    qc_top : float
        Cone resistance (MPa) in the top zone.
    qc_bot : float
        Cone resistance (MPa) in the bottom zone.

    Returns
    -------
    tuple[list[float], list[float]]
        ``(depths_m, qc_mpa)`` at 0.02 m spacing.
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
    """Accept one CPT litho suggestion and return the created contact id.

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
    """Accept one borehole litho suggestion and return the created contact id.

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
async def sa_project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for sample-assignment tests."""
    proj = ProjectOrm(id=uuid7(), name="SA sample assignment project", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def sa_scene(
    db_session: AsyncSession,
    sa_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """CS1-style scene with two samples in BH-1: one ZAND, one KLEI.

    Layout (x-axis, y=200_000 m)::

        CPT-1 (x=149_000)   BH-1 (x=149_300)   CPT-2 (x=149_600)
        ZAND 0–8 m           ZAND 0–4 m           ZAND 0–8 m
        (loose 0–4 / dense   KLEI 4–8 m           (loose 0–4 / dense
         4–8)                                       4–8)

    Samples on BH-1::

        ZAND-sample: 1.0–1.5 m (midpoint 1.25 m → inside ZAND extent)
        CLAY-sample: 5.0–5.5 m (midpoint 5.25 m → inside KLEI extent)

    Returns
    -------
    dict
        Keys: ``project``, ``litho_model_id``, ``bh_1_id``,
        ``sand_sample_id``, ``clay_sample_id``.
    """
    pid = str(sa_project.id)

    # Geo model (no surfaces → geo-bounding is a no-op).
    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "SA-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    # Litho model parented to geo model.
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "SA-Litho",
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
            "name": "SA-Section",
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

    # Two-layer qc: loose (3 MPa) 0–4 m / dense (22 MPa) 4–8 m.
    depths, qc = _two_layer_qc(n_top=200, n_bot=200, qc_top=3.0, qc_bot=22.0)

    cpt_1 = CptOrm(
        id=uuid7(),
        name="CPT-SA-1",
        cpt_type="CPTU",
        project_id="SA",
        test_id="SA/CPT-1",
        app_project_id=sa_project.id,
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
        name="CPT-SA-2",
        cpt_type="CPTU",
        project_id="SA",
        test_id="SA/CPT-2",
        app_project_id=sa_project.id,
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
        name="BH-SA-1",
        app_project_id=sa_project.id,
        project_id="SA",
        test_id="SA/BH-1",
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )

    # Two samples: one in the ZAND zone, one in the KLEI zone.
    sand_sample = SampleOrm(
        id=uuid7(),
        borehole_id=bh_1.id,
        depth_top_m=1.0,
        depth_base_m=1.5,
        description="ZAND-zone sample",
    )
    clay_sample = SampleOrm(
        id=uuid7(),
        borehole_id=bh_1.id,
        depth_top_m=5.0,
        depth_base_m=5.5,
        description="KLEI-zone sample",
    )

    db_session.add_all([cpt_1, cpt_2, bh_1, sand_sample, clay_sample])
    await db_session.commit()

    # Accept litho contacts.
    c1_id = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_1.id), top=0.0, base=8.0, soil="ZAND"
    )
    c2_id = await _accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_2.id), top=0.0, base=8.0, soil="ZAND"
    )
    bh_zand_id = await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_1.id),
        top=0.0,
        base=4.0,
        soil="ZAND",
    )
    await _accept_borehole_litho(
        async_client,
        pid,
        litho_model_id,
        borehole_id=str(bh_1.id),
        top=4.0,
        base=8.0,
        soil="KLEI",
    )

    # Build the ZAND body via correlations.
    await _correlate(
        async_client, pid, litho_model_id, contact_a=c1_id, contact_b=c2_id, section_id=section_id
    )
    await _correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=c1_id,
        contact_b=bh_zand_id,
        section_id=section_id,
    )

    # The fill paints the litho ties as bands; the recompute's facts make each
    # tied chain ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project": sa_project,
        "litho_model_id": litho_model_id,
        "bh_1_id": str(bh_1.id),
        "sand_sample_id": str(sand_sample.id),
        "clay_sample_id": str(clay_sample.id),
    }


# ---------------------------------------------------------------------------
# SA-1 through SA-7 — all assertions in one test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sample_geotech_assignment(
    sa_scene: dict,
    db_session: AsyncSession,
) -> None:
    """SA-1..SA-8: samples are assigned to the correct geotech body and NAD class.

    SA-1  sand sample nad_class is in ZAND range [5, 12].
    SA-2  sand sample geotech_body_id is non-null.
    SA-3  sand sample geotech_assignment_source is non-null.
    SA-4  clay sample nad_class is in KLEI range [21, 28].
    SA-5  clay sample geotech_body_id is None (no CPT backing for this KLEI body).
    SA-6  clay sample geotech_assignment_source is non-null.
    SA-7  neither sample has a NAD class that contradicts its own lithology.
    SA-8  sand sample geotech_body_id is a TRUE geotech body — a BodyOrm of the
          geotech model, and the body of the borehole's own sand band — not the
          litho body_id the band was carved from.
    """
    project = sa_scene["project"]
    litho_model_id = UUID(sa_scene["litho_model_id"])
    sand_sample_id = UUID(sa_scene["sand_sample_id"])
    clay_sample_id = UUID(sa_scene["clay_sample_id"])

    # Run SAB first (materialises CPT geotech layers).
    await SubdivideAllBodies(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )

    # Run DivideBoreholes (writes borehole bands + assigns samples).
    db_result = await DivideBoreholes(db_session).execute(
        project_id=project.id,
        litho_model_id=litho_model_id,
    )
    assert db_result.layer_count >= 1, f"Expected borehole layers, got {db_result.layer_count}"
    geotech_model_id = db_result.geotech_model_id

    # Expire all cached state so the SELECT below reads from DB, not the
    # identity map (DivideBoreholes committed; the session's in-memory copy of
    # the sample rows may still carry the pre-commit None values).
    db_session.expire_all()
    samples = (
        (
            await db_session.execute(
                select(SampleOrm).where(SampleOrm.id.in_([sand_sample_id, clay_sample_id]))
            )
        )
        .scalars()
        .all()
    )

    by_id = {s.id: s for s in samples}
    sand = by_id[sand_sample_id]
    clay = by_id[clay_sample_id]

    # --- SA-1: sand sample NAD class is in the ZAND family ---
    assert _in_zand(sand.geotech_nad_class), (
        f"SA-1: sand sample nad_class={sand.geotech_nad_class!r} is not in ZAND range [5, 12]"
    )

    # --- SA-2: sand sample has a non-null body id ---
    assert sand.geotech_body_id is not None, (
        "SA-2: sand sample geotech_body_id is None — expected a matched body"
    )

    # --- SA-3: sand sample has a non-null source ---
    assert sand.geotech_assignment_source is not None, (
        "SA-3: sand sample geotech_assignment_source is None"
    )

    # --- SA-4: clay sample NAD class is in the KLEI family ---
    assert _in_klei(clay.geotech_nad_class), (
        f"SA-4: clay sample nad_class={clay.geotech_nad_class!r} is not in KLEI range [21, 28]"
    )

    # --- SA-5: clay sample body id is the borehole KLEI band's resolver body ---
    # Since bec4e53ed (2026-07-07, Phase 8.5) DivideBoreholes re-resolves the
    # geotech model, so borehole bands are first-class members of the body
    # graph — the KLEI band here becomes a (borehole-only) body and the clay
    # sample anchors to it. (The original assertion pinned the pre-07-07
    # "no CPT backing → body_id None" conservative fallback — debt #238.3.)
    bh_klei_body_ids = {
        row
        for row in (
            (
                await db_session.execute(
                    select(LithoLayerOrm.body_id)
                    .join(
                        GeologicalFormationOrm,
                        LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                    )
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.borehole_id.is_not(None),
                        GeologicalFormationOrm.nad_class == clay.geotech_nad_class,
                    )
                )
            )
            .scalars()
            .all()
        )
        if row is not None
    }
    assert clay.geotech_body_id is not None, (
        "SA-5: clay sample geotech_body_id is None — post-Phase-8.5 the borehole "
        "KLEI band is re-resolved into the body graph and the sample must anchor to it"
    )
    assert clay.geotech_body_id in bh_klei_body_ids, (
        f"SA-5: clay sample geotech_body_id={clay.geotech_body_id} is not one of the "
        f"borehole KLEI geotech body ids {bh_klei_body_ids}"
    )

    # --- SA-6: clay sample has a non-null source ---
    assert clay.geotech_assignment_source is not None, (
        "SA-6: clay sample geotech_assignment_source is None"
    )

    # --- SA-7: no cross-family contamination ---
    # ZAND sample must NOT get a KLEI nad class, and vice-versa.
    assert not _in_klei(sand.geotech_nad_class), (
        f"SA-7 (ZAND↔KLEI contamination): sand sample got KLEI NAD class {sand.geotech_nad_class}"
    )
    assert not _in_zand(clay.geotech_nad_class), (
        f"SA-7 (KLEI↔ZAND contamination): clay sample got ZAND NAD class {clay.geotech_nad_class}"
    )

    # --- SA-8: sand sample body_id is a TRUE geotech body, not the litho one ---
    # What this guards is provenance: DivideBoreholes must stamp the body the
    # geotech resolver made, never the litho body the band was carved out of.
    # So the id has to be a BodyOrm row OF THE GEOTECH MODEL, and specifically
    # the body of the borehole's own sand band — the band the sample sits in.
    #
    # It used to assert something stronger: that the id was one of the CPT
    # bands' bodies, because the derived packing ties were auto-approved and the
    # resolver had already merged borehole and CPT into a single body. Since
    # 2026-08-01 a derived tie is a proposal (clean/dirty rule), so that merge
    # waits on the engineer's accept and the borehole band is its own body until
    # then. The provenance question SA-8 exists to answer is unaffected.
    bh_sand_body_ids = {
        row
        for row in (
            (
                await db_session.execute(
                    select(LithoLayerOrm.body_id)
                    .join(
                        GeologicalFormationOrm,
                        LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                    )
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.borehole_id.is_not(None),
                        GeologicalFormationOrm.nad_class == sand.geotech_nad_class,
                    )
                )
            )
            .scalars()
            .all()
        )
        if row is not None
    }
    assert bh_sand_body_ids, (
        f"SA-8 precondition: no borehole geotech layers with "
        f"nad_class={sand.geotech_nad_class} found — cannot verify body_id provenance"
    )
    assert sand.geotech_body_id in bh_sand_body_ids, (
        f"SA-8: sand sample geotech_body_id={sand.geotech_body_id} is not the body of "
        f"any borehole sand band {bh_sand_body_ids}"
    )
    geotech_body_ids = set(
        (await db_session.execute(select(BodyOrm.id).where(BodyOrm.model_id == geotech_model_id)))
        .scalars()
        .all()
    )
    assert sand.geotech_body_id in geotech_body_ids, (
        f"SA-8: sand sample geotech_body_id={sand.geotech_body_id} is not a body of the "
        f"geotech model — DivideBoreholes stamped a foreign (litho?) body_id"
    )
