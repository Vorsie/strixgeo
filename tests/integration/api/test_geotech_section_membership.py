"""Only investigations that appear on a cross-section enter the geotech model.

Owner ruling (dogfeed 2026-08-15):

    "i want subdivide cpt's also to be section scoped, i don't want any cpt's
    that aren't on any sections to be subdivided and included in the model"

Two separate claims, tested separately:

* **the verb can be scoped** — ``subdivide-cpts`` takes an optional
  ``section_id`` and then subdivides only that section's columns;
* **the membership invariant** — an investigation that projects onto NO
  section is never subdivided, in EITHER mode.

The invariant is PREVENTIVE.  On the owner's live project 64 of 68 CPTs
project onto a section and the 4 strays happen to carry no litho layers, so
the model is accidentally clean today; a fixture that merely mirrored that
would pass with the guard deleted.  Every case below therefore CONSTRUCTS the
polluting column — an off-section CPT with accepted litho layers, in the same
body as an on-section one.

Scene
-----
One section along y = 200 000 with CPT-ON at (149 000, 200 000).  CPT-OFF sits
at (149 000, 205 000) — 5 km off the line, far outside the 60 m corridor — and
carries the same accepted ZAND unit, so it lands in the same litho body.  A
borehole BH-OFF sits beside it, equally off-section.

Cases
-----
DM1  A model-wide subdivide writes bands for the on-section CPT and NONE for
     the off-section one, and reports the skip.
DM2  The skip is reported by NAME, not just counted.
DM3  A subdivide scoped to the section subdivides that section's columns only.
DM4  ``divide-boreholes`` will not give bands to a borehole on no section.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_geotech_section_membership.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import (
    accept_borehole_litho,
    accept_cpt_litho,
    two_layer_qc,
)


@pytest_asyncio.fixture
async def membership_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """One on-section CPT, one off-section CPT, one off-section borehole.

    All three carry the same accepted ZAND unit, so nothing but the section
    projection distinguishes them.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``section_id``,
        ``cpt_on_id``, ``cpt_off_id``, ``bh_off_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech membership test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "DM-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "DM-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "DM-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_900.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = str(sec_resp.json()["id"])

    def _cpt(name: str, x: float, y: float) -> CptOrm:
        depths, qc = two_layer_qc(n_top=200, n_bot=200, qc_top=8.0, qc_bot=18.0)
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="DM",
            test_id=f"DM/{name}",
            app_project_id=proj.id,
            location_x=x,
            location_y=y,
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
        return cpt

    cpt_on = _cpt("CPT-ON", 149_000.0, 200_000.0)
    # 5 km off the section line: no buffer this project would ever set reaches
    # it, so its absence from the model is about membership and nothing else.
    cpt_off = _cpt("CPT-OFF", 149_000.0, 205_000.0)
    bh_off = BoreholeOrm(
        id=uuid7(),
        name="BH-OFF",
        app_project_id=proj.id,
        project_id="DM",
        test_id="DM/BH-OFF",
        location_x=149_200.0,
        location_y=205_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )
    db_session.add_all([cpt_on, cpt_off, bh_off])
    await db_session.commit()

    for cpt in (cpt_on, cpt_off):
        await accept_cpt_litho(
            async_client, pid, litho_model_id, cpt_id=str(cpt.id), top=0.0, base=8.0
        )
    await accept_borehole_litho(
        async_client, pid, litho_model_id, borehole_id=str(bh_off.id), top=0.0, base=8.0
    )

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_on_id": cpt_on.id,
        "cpt_off_id": cpt_off.id,
        "bh_off_id": bh_off.id,
    }


async def _subdivide_cpts(client: AsyncClient, scene: dict, body: dict) -> dict:
    """Run pipeline step 1 with the given extra request fields."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"], **body},
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _geotech_columns(db_session: AsyncSession, geotech_model_id: str) -> set[UUID]:
    """Ids of the investigations that own at least one geotech band."""
    rows = (
        await db_session.execute(
            select(LithoLayerOrm.cpt_id, LithoLayerOrm.borehole_id).where(
                LithoLayerOrm.model_id == UUID(geotech_model_id)
            )
        )
    ).all()
    return {row.borehole_id if row.borehole_id is not None else row.cpt_id for row in rows}


@pytest.mark.asyncio
async def test_dm1_an_off_section_cpt_never_enters_the_model(
    membership_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DM1: "i don't want any cpt's that aren't on any sections ... included".

    Model-wide press, so nothing here is about scoping — this is the invariant
    that holds in BOTH modes.
    """
    payload = await _subdivide_cpts(async_client, membership_scene, {})
    columns = await _geotech_columns(db_session, payload["geotech_model_id"])

    assert membership_scene["cpt_on_id"] in columns, (
        "the CPT the engineer can see on his section must still be subdivided"
    )
    assert membership_scene["cpt_off_id"] not in columns, (
        "a CPT on no section can never be drawn, correlated or corrected — "
        "subdividing it puts bands in the model that nobody can reach"
    )
    assert payload["skipped_off_section_count"] >= 1, (
        "a model that came out smaller has to say so — a silent skip is the "
        "kind of thing that gets discovered in an export"
    )


@pytest.mark.asyncio
async def test_dm2_the_skipped_columns_are_named_not_just_counted(
    membership_scene: dict,
    async_client: AsyncClient,
) -> None:
    """DM2: "log what was NOT found" — the response names what it dropped."""
    payload = await _subdivide_cpts(async_client, membership_scene, {})
    labels = payload["skipped_off_section_labels"]
    assert any("CPT-OFF" in label for label in labels), labels
    assert not any("CPT-ON" in label for label in labels), labels


@pytest.mark.asyncio
async def test_dm3_a_scoped_subdivide_takes_only_that_sections_columns(
    membership_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DM3: step 1 accepts the same optional ``section_id`` as steps 2 and 3."""
    payload = await _subdivide_cpts(
        async_client, membership_scene, {"section_id": membership_scene["section_id"]}
    )
    columns = await _geotech_columns(db_session, payload["geotech_model_id"])
    assert columns == {membership_scene["cpt_on_id"]}


@pytest.mark.asyncio
async def test_dm4_an_off_section_borehole_gets_no_bands(
    membership_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DM4: the same rule for boreholes — one on no section has no donor CPTs.

    Pinned rather than assumed: before this ruling ``DivideBoreholes`` loaded
    its litho picks model-wide with no section filter, so an off-section
    borehole sharing a body with an on-section CPT WOULD have been filled.
    """
    payload = await _subdivide_cpts(async_client, membership_scene, {})
    geotech_model_id = payload["geotech_model_id"]

    resp = await async_client.post(
        f"/projects/{membership_scene['project_id']}/geology/models/"
        f"{membership_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )
    assert resp.status_code == 200, resp.text

    columns = await _geotech_columns(db_session, geotech_model_id)
    assert membership_scene["bh_off_id"] not in columns
