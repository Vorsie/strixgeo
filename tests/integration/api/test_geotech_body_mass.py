"""Integration tests — a geotech body is one SOIL and one PACKING DENSITY.

Owner, 2026-08-19 (the complete emit specification): *"Fill sweep if a lens is
touching a body with same litho and packing then lens disappears and it becomes
one body, in the renderer AND IN THE DATABASE."*

The renderer half is the fill's merge (``geotechHierarchicalFill``): faces of one
soil and one packing class that touch weld into one region carrying both bands'
``layerIds``. That region is what ``buildBodyRecomputePayload`` sends as the
evidence of one mass, so the DATABASE half is the body resolver: two bands of the
same soil but a DIFFERENT packing density must stay two bodies however they are
tied, and two of the same density that a tie joins must be one.

Before this, the resolver's only filter was ``litho_main_soil_code`` — the soil —
so a medium-dense sand tied to a dense sand merged into one geotech body and the
export carried a body spanning two packing classes.

Scene
-----
* CPT-A and CPT-B stand 500 m apart, each with a two-zone qc log, and are
  litho-correlated so their sands land in ONE litho body (the packing-tie guard
  requires it).
* ``SubdivideAllBodies`` bands both columns: a LOOSE zone over a DENSE zone on
  each, so both a same-class pair and a different-class pair exist.

Test assertions
---------------
BM-1  Correlate the two LOOSE bands, the fill paints them as one mass → after
      the resolver, ONE body id.
BM-2  Correlate a LOOSE band to the facing DENSE band (even with a painted
      fact) → the two keep DIFFERENT body ids: a tie between two masses is a
      contact, not one mass.
BM-3  The litho model is untouched: its two correlated sand layers still share
      one body (the packing filter is inert without a packing class).

Since owner 2026-10-04 (*"identity follows the drawing"*) only the geometry facts
the renderer posts for painted masses union; ``paint_band`` stands in for that
``bodies/recompute`` (the fill is client-side).

⚠ NOT RUN by the author — the integration suite must go through the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_geotech_body_mass.py
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

from .geotech_scene_helpers import accept_cpt_litho, paint_band, two_layer_qc


@pytest_asyncio.fixture
async def bm_project(db_session: AsyncSession) -> ProjectOrm:
    """A project for this module's scene."""
    project = ProjectOrm(id=uuid7(), name="BM-Project", status="active")
    db_session.add(project)
    await db_session.commit()
    return project


@pytest_asyncio.fixture
async def bm_scene(
    db_session: AsyncSession,
    bm_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Two CPTs, one litho sand body, two packing zones per column.

    Returns
    -------
    dict
        ``project``, ``litho_model_id``, ``geotech_model_id``, ``section_id``,
        ``cpt_a_id``, ``cpt_b_id``.
    """
    pid = str(bm_project.id)

    geo = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "BM-Geo", "kind": "geological"},
    )
    assert geo.status_code == 201, geo.text
    litho = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "BM-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo.json()["id"],
        },
    )
    assert litho.status_code == 201, litho.text
    litho_model_id = litho.json()["id"]

    section = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "BM-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_400.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert section.status_code == 201, section.text
    section_id = section.json()["id"]

    # A LOOSE zone (qc 4 MPa) over a DENSE zone (qc 25 MPa) on both columns, so
    # each column carries two packing classes of ONE soil.
    depths, qc = two_layer_qc(150, 150, 4.0, 25.0)
    cpt_ids: list[str] = []
    for index, x in enumerate((148_800.0, 149_300.0)):
        cpt = CptOrm(
            id=uuid7(),
            name=f"BM-{index}",
            cpt_type="CPTU",
            project_id="BM",
            test_id=f"BM/{index}",
            app_project_id=bm_project.id,
            location_x=x,
            location_y=200_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=15.0,
        )
        cpt.series = CptSeriesOrm(
            depths_m=depths,
            qc_mpa=qc,
            fs_mpa=[0.05] * len(depths),
            u2_mpa=None,
        )
        db_session.add(cpt)
        await db_session.flush()
        cpt_ids.append(str(cpt.id))
    await db_session.commit()

    contacts = [
        await accept_cpt_litho(
            async_client,
            pid,
            litho_model_id,
            cpt_id=cpt_id,
            top=0.0,
            base=6.0,
            soil="ZAND",
        )
        for cpt_id in cpt_ids
    ]
    correlate = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/contact-correlations",
        json={
            "layer_a_id": contacts[0],
            "layer_b_id": contacts[1],
            "request_section_id": section_id,
        },
    )
    assert correlate.status_code in (200, 201), correlate.text
    # The fill paints the tied sands as one band: the recompute's fact makes them
    # ONE litho body (the packing-tie guard and the subdivide read that body).
    await paint_band(db_session, litho_model_id, (contacts[0], contacts[1]))

    geotech_model_id = await SubdivideAllBodies(db_session).execute(
        project_id=bm_project.id, litho_model_id=litho.json()["id"]
    )
    await db_session.commit()
    return {
        "project": bm_project,
        "section_id": section_id,
        "litho_model_id": litho_model_id,
        "geotech_model_id": str(geotech_model_id.geotech_model_id),
        "cpt_a_id": cpt_ids[0],
        "cpt_b_id": cpt_ids[1],
    }


async def _bands(session: AsyncSession, model_id: str, cpt_id: str) -> list[LithoLayerOrm]:
    """Every accepted band of one column, shallowest first."""
    rows = (
        await session.execute(
            select(LithoLayerOrm)
            .where(
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.cpt_id == cpt_id,
                LithoLayerOrm.status == "accepted",
            )
            .order_by(LithoLayerOrm.depth_top_m)
        )
    ).scalars()
    return list(rows)


@pytest.mark.asyncio
async def test_bm1_same_packing_bands_become_one_body(
    db_session: AsyncSession, bm_scene: dict, async_client: AsyncClient
) -> None:
    """BM-1 — a painted tie between two bands of the same soil AND density is one mass."""
    pid = str(bm_scene["project"].id)
    left = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_a_id"])
    right = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_b_id"])
    assert left and right, "the subdivide produced no bands"
    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{bm_scene['geotech_model_id']}/contact-correlations",
        json={
            "layer_a_id": str(left[0].id),
            "layer_b_id": str(right[0].id),
            "request_section_id": bm_scene["section_id"],
        },
    )
    assert resp.status_code in (200, 201), resp.text
    await db_session.commit()
    await paint_band(db_session, bm_scene["geotech_model_id"], (left[0].id, right[0].id))
    db_session.expire_all()
    left = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_a_id"])
    right = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_b_id"])
    assert left[0].body_id is not None
    assert left[0].body_id == right[0].body_id


@pytest.mark.asyncio
async def test_bm2_different_packing_bands_stay_two_bodies(
    db_session: AsyncSession, bm_scene: dict, async_client: AsyncClient
) -> None:
    """BM-2 — a tie across a density change is a contact, never one body."""
    pid = str(bm_scene["project"].id)
    left = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_a_id"])
    right = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_b_id"])
    assert len(left) >= 2 and len(right) >= 2, "expected two packing zones per column"
    assert left[0].formation_id != left[1].formation_id, "the two zones share a class"
    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{bm_scene['geotech_model_id']}/contact-correlations",
        json={
            "layer_a_id": str(left[0].id),
            "layer_b_id": str(right[1].id),
            "request_section_id": bm_scene["section_id"],
        },
    )
    assert resp.status_code in (200, 201), resp.text
    await db_session.commit()
    # Even a fact across the density change must not weld (one mass = one class).
    await paint_band(db_session, bm_scene["geotech_model_id"], (left[0].id, right[1].id))
    db_session.expire_all()
    left = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_a_id"])
    right = await _bands(db_session, bm_scene["geotech_model_id"], bm_scene["cpt_b_id"])
    assert left[0].body_id != right[1].body_id


@pytest.mark.asyncio
async def test_bm3_the_litho_model_is_untouched(db_session: AsyncSession, bm_scene: dict) -> None:
    """BM-3 — no packing class, no packing filter: the litho sands stay one body."""
    left = await _bands(db_session, bm_scene["litho_model_id"], bm_scene["cpt_a_id"])
    right = await _bands(db_session, bm_scene["litho_model_id"], bm_scene["cpt_b_id"])
    assert left and right
    assert left[0].body_id is not None
    assert left[0].body_id == right[0].body_id
