"""RM — first DB-level coverage of POST …/geotech/contact/move (audit F01).

Until this suite, the three-model write ran only through the pure planner tests
(RC1–RC11) and one e2e spec that never exercises the geological arm: every
fixture on the write path carried ``parent_geo_contact_id = null``, so the arm
that moves a GEOLOGICAL contact — the highest-blast-radius write in the stage —
executed for the first time each time the owner used it.

Scene: one CPT, 12 m, two litho units (ZAND 0–6 over KLEI 6–12), a qc transition
INSIDE each unit so both sides of the restated contact at 6.0 m carry two packing
bands — the geometry every gesture in §4c needs. The ZAND top plateau carries
sub-persistence weak spikes so median and harmonic classify it differently, which
ST-SUB4 uses to pin the build's statistic thread end-to-end (audit F04).

Run via ``scripts\\run-integration-tests.ps1`` ONLY.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import accept_cpt_litho


@pytest_asyncio.fixture
async def contact_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """One CPT, ZAND over KLEI, two packing bands per unit.

    Returns
    -------
    dict
        Keys: ``project_id``, ``geo_model_id``, ``litho_model_id``, ``cpt_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Restated-contact move test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "RM-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "RM-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    # 601 samples at 2 cm: ZAND 0–6 (loose-with-spikes over very dense, transition
    # at 3.0) then KLEI 6–12 (matig vast over vrij vast, transition at 9.0).
    depths: list[float] = []
    qc: list[float] = []
    for i in range(601):
        d = round(i * 0.02, 4)
        depths.append(d)
        if d < 3.0:
            # Sub-persistence weak spikes: median says 5 MPa (matig, class 6),
            # the harmonic mean is dragged to ~3.4 MPa (los, class 5) — ST-SUB4.
            qc.append(0.4 if i % 25 == 7 else 5.0)
        elif d < 6.0:
            qc.append(25.0)
        elif d < 9.0:
            qc.append(1.0)
        else:
            qc.append(3.0)

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-RM",
        cpt_type="CPTU",
        project_id="RM",
        test_id="RM/CPT-RM",
        app_project_id=proj.id,
        location_x=149_000.0,
        location_y=201_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=12.0,
    )
    cpt.series = CptSeriesOrm(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=[0.05] * len(depths),
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    db_session.add(cpt)
    await db_session.commit()

    await accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt.id), top=0.0, base=6.0, soil="ZAND"
    )
    await accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt.id), top=6.0, base=12.0, soil="KLEI"
    )

    return {
        "project_id": pid,
        "geo_model_id": geo_model_id,
        "litho_model_id": litho_model_id,
        "cpt_id": cpt.id,
    }


async def _subdivide(client: AsyncClient, scene: dict) -> str:
    """Run pipeline step 1 and return the geotech model id."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _bands(db_session: AsyncSession, geotech_model_id: str, cpt_id) -> list[LithoLayerOrm]:
    """The CPT's geotech bands, top to bottom."""
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == UUID(geotech_model_id),
                    LithoLayerOrm.cpt_id == cpt_id,
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def _litho_rows(db_session: AsyncSession, litho_model_id: str, cpt_id) -> list[LithoLayerOrm]:
    """The CPT's accepted litho layers, top to bottom."""
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == UUID(litho_model_id),
                    LithoLayerOrm.cpt_id == cpt_id,
                    LithoLayerOrm.status == "accepted",
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _move_url(scene: dict, geotech_model_id: str) -> str:
    return f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/contact/move"


async def _contact_pair(
    db_session: AsyncSession, geotech_model_id: str, cpt_id
) -> tuple[LithoLayerOrm, LithoLayerOrm]:
    """The band pair either side of the restated contact at 6.0 m."""
    bands = await _bands(db_session, geotech_model_id, cpt_id)
    upper = next(b for b in bands if abs(b.depth_base_m - 6.0) < 1e-6)
    lower = next(b for b in bands if abs(b.depth_top_m - 6.0) < 1e-6)
    return upper, lower


@pytest.mark.asyncio
async def test_rm1_a_nudge_moves_the_litho_contact_and_rederives_both_bands(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RM1 — the plain move writes both models and stamps manual provenance."""
    gid = await _subdivide(async_client, contact_scene)
    upper, lower = await _contact_pair(db_session, gid, contact_scene["cpt_id"])
    upper_id, lower_id = upper.id, lower.id

    resp = await async_client.post(
        _move_url(contact_scene, gid),
        json={
            "upper_band_id": str(upper_id),
            "lower_band_id": str(lower_id),
            "new_depth_m": 6.4,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted_layer_ids"] == []

    db_session.expire_all()
    upper_after = await db_session.get(LithoLayerOrm, upper_id)
    lower_after = await db_session.get(LithoLayerOrm, lower_id)
    assert upper_after is not None and lower_after is not None
    assert upper_after.depth_base_m == pytest.approx(6.4)
    assert lower_after.depth_top_m == pytest.approx(6.4)
    assert upper_after.source == "manual"
    assert lower_after.source == "manual"

    litho = await _litho_rows(db_session, contact_scene["litho_model_id"], contact_scene["cpt_id"])
    assert [round(r.depth_base_m, 3) for r in litho[:1]] == [6.4]
    assert litho[1].depth_top_m == pytest.approx(6.4)


@pytest.mark.asyncio
async def test_rm2_the_geological_arm_moves_the_geo_contact_in_the_same_write(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RM2 — the arm no automated test had ever executed (audit F01).

    The litho row below the contact carries ``parent_geo_contact_id``; the move
    must carry that geological contact to the same depth in the same
    transaction, so the two levels cannot disagree about one physical boundary.
    """
    gid = await _subdivide(async_client, contact_scene)
    upper, lower = await _contact_pair(db_session, gid, contact_scene["cpt_id"])
    upper_id, lower_id = upper.id, lower.id

    geo_formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=UUID(contact_scene["project_id"]),
        name="RM-Formatie",
        color="#888888",
        display_order=1,
    )
    db_session.add(geo_formation)
    await db_session.flush()
    geo_contact = FormationContactOrm(
        id=uuid7(),
        model_id=UUID(contact_scene["geo_model_id"]),
        formation_id=geo_formation.id,
        cpt_id=contact_scene["cpt_id"],
        depth_top_m=6.0,
        source="manual_pick",
    )
    db_session.add(geo_contact)
    await db_session.flush()
    geo_contact_id = geo_contact.id
    litho = await _litho_rows(db_session, contact_scene["litho_model_id"], contact_scene["cpt_id"])
    litho[1].parent_geo_contact_id = geo_contact_id
    await db_session.commit()

    resp = await async_client.post(
        _move_url(contact_scene, gid),
        json={
            "upper_band_id": str(upper_id),
            "lower_band_id": str(lower_id),
            "new_depth_m": 6.4,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["geo_contact_id"] == str(geo_contact_id)

    db_session.expire_all()
    moved = await db_session.get(FormationContactOrm, geo_contact_id)
    assert moved is not None
    assert moved.depth_top_m == pytest.approx(6.4), (
        "the geological contact must move with the boundary it is the parent of"
    )


@pytest.mark.asyncio
async def test_rm3_the_downward_landing_absorbs_the_band_below(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RM3 — the drag-merge, at the endpoint: one band fewer, litho at 9.0."""
    gid = await _subdivide(async_client, contact_scene)
    upper, lower = await _contact_pair(db_session, gid, contact_scene["cpt_id"])
    upper_id, lower_id = upper.id, lower.id
    before = len(await _bands(db_session, gid, contact_scene["cpt_id"]))

    resp = await async_client.post(
        _move_url(contact_scene, gid),
        json={
            "upper_band_id": str(upper_id),
            "lower_band_id": str(lower_id),
            "new_depth_m": 9.0,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted_layer_ids"] == [str(lower_id)]

    db_session.expire_all()
    after = await _bands(db_session, gid, contact_scene["cpt_id"])
    assert len(after) == before - 1
    litho = await _litho_rows(db_session, contact_scene["litho_model_id"], contact_scene["cpt_id"])
    assert litho[0].depth_base_m == pytest.approx(9.0)
    assert litho[1].depth_top_m == pytest.approx(9.0)


@pytest.mark.asyncio
async def test_rm4_the_upward_landing_absorbs_the_band_above_under_the_lower_unit(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RM4 — the F02 gesture at the endpoint: up = the layer below grows.

    Before the fix this exact request — the payload the renderer produces for
    every upward drag — was answered 422 "falls outside the pair" after the
    telegraph promised a merge and the dialog confirmed it. The survivor must
    belong to the LOWER unit: its class sits in KLEI's NAD range.
    """
    gid = await _subdivide(async_client, contact_scene)
    upper, lower = await _contact_pair(db_session, gid, contact_scene["cpt_id"])
    upper_id, lower_id = upper.id, lower.id

    resp = await async_client.post(
        _move_url(contact_scene, gid),
        json={
            "upper_band_id": str(upper_id),
            "lower_band_id": str(lower_id),
            "new_depth_m": 3.0,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted_layer_ids"] == [str(upper_id)]

    db_session.expire_all()
    survivor = await db_session.get(LithoLayerOrm, lower_id)
    assert survivor is not None
    assert survivor.depth_top_m == pytest.approx(3.0)
    formation = await db_session.get(GeologicalFormationOrm, survivor.formation_id)
    assert formation is not None and formation.nad_class is not None
    assert 21 <= formation.nad_class <= 28, (
        f"the union belongs to the unit BELOW (KLEI, classes 21-28), got {formation.nad_class}"
    )
    litho = await _litho_rows(db_session, contact_scene["litho_model_id"], contact_scene["cpt_id"])
    assert litho[0].depth_base_m == pytest.approx(3.0)
    assert litho[1].depth_top_m == pytest.approx(3.0)


@pytest.mark.asyncio
async def test_rm5_a_landing_outside_the_pair_is_a_named_422_not_a_500(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RM5 — the refusal reaches the wire as the planner's own sentence."""
    gid = await _subdivide(async_client, contact_scene)
    upper, lower = await _contact_pair(db_session, gid, contact_scene["cpt_id"])

    resp = await async_client.post(
        _move_url(contact_scene, gid),
        json={
            "upper_band_id": str(upper.id),
            "lower_band_id": str(lower.id),
            "new_depth_m": 20.0,
        },
    )
    assert resp.status_code == 422, resp.text
    assert "outside the pair" in resp.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_st_sub4_the_build_rederives_under_the_models_chosen_statistic(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """ST-SUB4 — the statistic thread through the BUILD, end to end (audit F04).

    ST-SUB3 pins the domain function; deleting ``statistic=statistic`` at the
    ONE line that threads the model's choice into the build
    (``subdivide_all_bodies``) left every suite green while the model stamped
    ``classified_with_statistic='harmonic'`` over median-classified bands. This
    runs the real pipeline twice: the spiky ZAND top classifies matig (6) under
    the default median and los (5) under harmonic — same data, same boundaries,
    a different name only if the choice actually reaches the classifier.
    """
    gid = await _subdivide(async_client, contact_scene)

    async def top_band_class() -> int | None:
        db_session.expire_all()
        bands = await _bands(db_session, gid, contact_scene["cpt_id"])
        formation = await db_session.get(GeologicalFormationOrm, bands[0].formation_id)
        return formation.nad_class if formation is not None else None

    assert await top_band_class() == 6, "median run: spikes shrugged off, matig (6)"

    stat_resp = await async_client.post(
        f"/projects/{contact_scene['project_id']}/geology/models/{gid}/geotech/statistic",
        json={"statistic": "harmonic"},
    )
    assert stat_resp.status_code == 200, stat_resp.text

    gid2 = await _subdivide(async_client, contact_scene)
    assert gid2 == gid, "the re-run rebuilds the same geotech model"
    assert await top_band_class() == 5, (
        "harmonic run: the weak spikes drag the representative below 4 MPa — "
        "los (5). Class 6 here means the build ignored the model's statistic."
    )


@pytest.mark.asyncio
async def test_rm6_a_coinciding_but_unlinked_geo_contact_is_carried_and_relinked(
    contact_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """RM6 — coincidence couples at move time, and the move heals the link (F34).

    The dev model held two litho rows sitting bit-for-bit ON a geological
    contact with no ``parent_geo_contact_id`` — provably once-coupled (only the
    accept-time snap copies the float exactly) and severed later, most likely by
    a delete + re-accept whose found-existing branch skipped re-coupling. Owner:
    *"it shouldn't be that easy to unlink them."* So a move that finds no link
    but a geo contact within the coincidence tolerance carries it anyway AND
    writes the link back — self-healing on touch, exactly as the litho↔geotech
    seam already resolves by depth.
    """
    gid = await _subdivide(async_client, contact_scene)
    upper, lower = await _contact_pair(db_session, gid, contact_scene["cpt_id"])
    upper_id, lower_id = upper.id, lower.id

    geo_formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=UUID(contact_scene["project_id"]),
        name="RM-Formatie-unlinked",
        color="#888888",
        display_order=1,
    )
    db_session.add(geo_formation)
    await db_session.flush()
    geo_contact = FormationContactOrm(
        id=uuid7(),
        model_id=UUID(contact_scene["geo_model_id"]),
        formation_id=geo_formation.id,
        cpt_id=contact_scene["cpt_id"],
        depth_top_m=6.0,  # coincides with the restated contact — NO link set
        source="manual_pick",
    )
    db_session.add(geo_contact)
    await db_session.commit()
    geo_contact_id = geo_contact.id

    resp = await async_client.post(
        _move_url(contact_scene, gid),
        json={
            "upper_band_id": str(upper_id),
            "lower_band_id": str(lower_id),
            "new_depth_m": 6.4,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["geo_contact_id"] == str(geo_contact_id), (
        "the coinciding geological contact must be carried even without the link"
    )

    db_session.expire_all()
    moved = await db_session.get(FormationContactOrm, geo_contact_id)
    assert moved is not None and moved.depth_top_m == pytest.approx(6.4)
    litho = await _litho_rows(db_session, contact_scene["litho_model_id"], contact_scene["cpt_id"])
    assert litho[1].parent_geo_contact_id == geo_contact_id, (
        "the move must heal the severed link, not just carry the contact once"
    )
