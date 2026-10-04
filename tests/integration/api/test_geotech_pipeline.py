"""Integration tests for the four-step geotech pipeline (owner ruling 2026-08-04).

The old "Subdivide all bodies" did too much at once: it subdivided the CPTs AND
derived packing ties, and those ties arrived already accepted.  The pipeline
splits that into the litho stage's own rhythm:

1. **subdivide CPTs into packing** — bands only, no edge derivation;
2. **auto-correlate packing** — PROPOSES ties, pairing CPT to CPT across
   intervening borehole columns;
3. **accept** — per tie or all of them; only accepted ties are visible to the
   resolver, the fill and the 3-D build;
4. **divide boreholes** — gated on step 3 being finished, and able to divide a
   subset of the boreholes.

Scene
-----
CPT-A (x=149 000) — BH-S (x=149 300) — CPT-B (x=149 600), all ZAND 0–8 m on one
section.  The litho correlations are A↔BH and BH↔B **only**: there is
deliberately no direct A↔B edge, so a packing tie between the two CPTs can only
exist if the pairing jumps the borehole column.

Cases
-----
GP1  Step 1 writes CPT packing bands and proposes NOTHING.
GP2  Step 2 proposes ties, unapproved, pairing CPT to CPT across the borehole.
GP3  A pending tie is invisible to the body resolver; accepting it is what puts
     the two bands in one geotech body.
GP4  Step 4 refuses while ties are pending, naming the count.
GP5  Accept all, then step 4 runs and the borehole gets its bands.
GP6  Step 4 can divide a subset of the boreholes, leaving the others as they are.
GP7  The combined legacy verb still works and says it proposed the ties.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_geotech_pipeline.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import (
    accept_borehole_litho,
    accept_cpt_litho,
    correlate,
    paint_accepted_ties,
    two_layer_qc,
)


@pytest_asyncio.fixture
async def pipeline_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """CPT — borehole — CPT on one section, correlated only THROUGH the borehole.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``section_id``, ``bh_id``,
        ``cpt_a_id``, ``cpt_b_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech pipeline test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GP-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GP-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "GP-Section",
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

    # Both CPTs read matig over dicht; A transitions at 4.0 m, B at 5.0 m, so a
    # borehole between them must land somewhere in between.
    depths_a, qc_a = two_layer_qc(n_top=200, n_bot=200, qc_top=8.0, qc_bot=18.0)
    depths_b, qc_b = two_layer_qc(n_top=250, n_bot=150, qc_top=8.0, qc_bot=18.0)

    def _cpt(name: str, x: float, depths: list[float], qc: list[float]) -> CptOrm:
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="GP",
            test_id=f"GP/{name}",
            app_project_id=proj.id,
            location_x=x,
            location_y=200_000.0,
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

    cpt_a = _cpt("CPT-A", 149_000.0, depths_a, qc_a)
    cpt_b = _cpt("CPT-B", 149_600.0, depths_b, qc_b)
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-S",
        app_project_id=proj.id,
        project_id="GP",
        test_id="GP/BH-S",
        location_x=149_300.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=8.0,
    )
    db_session.add_all([cpt_a, cpt_b, bh])
    await db_session.commit()

    contact_a = await accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_a.id), top=0.0, base=8.0
    )
    contact_b = await accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_b.id), top=0.0, base=8.0
    )
    contact_bh = await accept_borehole_litho(
        async_client, pid, litho_model_id, borehole_id=str(bh.id), top=0.0, base=8.0
    )

    # A ↔ BH and BH ↔ B, and deliberately NOT A ↔ B: the CPT pair is only
    # reachable by jumping the borehole column.
    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contact_a,
        contact_b=contact_bh,
        section_id=section_id,
    )
    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contact_bh,
        contact_b=contact_b,
        section_id=section_id,
    )
    # The fill paints the litho ties as bands; the recompute's facts make each tied
    # chain ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "bh_id": bh.id,
        "cpt_a_id": cpt_a.id,
        "cpt_b_id": cpt_b.id,
        # The three accepted contacts, so a test can add the DIRECT A↔B litho
        # correlation the scene deliberately withholds (GP12/GP13 need it —
        # correlating CPT→CPT across the borehole is the owner's own habit).
        "contact_a": contact_a,
        "contact_b": contact_b,
        "contact_bh": contact_bh,
    }


async def _insert_pending_tie(db_session: AsyncSession, scene: dict, geotech_model_id) -> None:
    """Insert one PENDING packing tie between the two CPTs' shallowest bands.

    Under the 2026-08-06 refinement the auto path CAN produce pending ties
    again (packing-density pairs + bridged jump pairs), but this helper stays:
    it stages exactly one deterministic pending tie between the two CPTs'
    shallowest bands, so the gate scenes assert on a known count instead of
    whatever the scene's stacks happen to derive.
    """
    from uuid import UUID as _UUID

    async def _top_layer(cpt_id) -> LithoLayerOrm:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm)
                    .where(
                        LithoLayerOrm.model_id == _UUID(str(geotech_model_id)),
                        LithoLayerOrm.cpt_id == cpt_id,
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .all()
        )
        assert rows, f"pending-tie helper: no geotech bands on CPT {cpt_id}"
        return rows[0]

    a = await _top_layer(scene["cpt_a_id"])
    b = await _top_layer(scene["cpt_b_id"])
    lo, hi = (a.id, b.id) if a.id < b.id else (b.id, a.id)
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=_UUID(str(geotech_model_id)),
            section_id=_UUID(str(scene["section_id"])),
            layer_a_id=lo,
            layer_b_id=hi,
            layer_a_side="top",
            layer_b_side="top",
            user_approved=False,
            source="auto",
        )
    )
    await db_session.commit()


async def _subdivide_cpts(client: AsyncClient, scene: dict) -> dict:
    """Run pipeline step 1 and return the response payload."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _auto_correlate(client: AsyncClient, scene: dict, geotech_model_id: str) -> dict:
    """Run pipeline step 2 and return the response payload."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/auto-correlate",
        json={},
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _tie_status(client: AsyncClient, scene: dict, geotech_model_id: str) -> dict:
    """Read the pending / accepted / flagged tie counts."""
    resp = await client.get(
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/tie-status"
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _accept_all_ties(client: AsyncClient, scene: dict, geotech_model_id: str) -> int:
    """Run pipeline step 3 model-wide and return how many ties were accepted."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{geotech_model_id}/contact-correlations/accept",
        json={},
    )
    assert resp.status_code == 200, resp.text
    return int(resp.json()["edges_accepted"])


@pytest.mark.asyncio
async def test_gp1_step_one_writes_packing_bands_and_proposes_nothing(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP1: subdivide-cpts subdivides the CPTs into packing — bands only."""
    payload = await _subdivide_cpts(async_client, pipeline_scene)

    assert payload["edges_derived"] is False
    assert payload["proposed_tie_count"] == 0
    assert payload["layer_count"] > 0

    geotech_model_id = payload["geotech_model_id"]
    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert edges == [], "step 1 must not correlate anything"

    # And the bands it did write are on the CPTs, not the borehole.
    bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
            )
        )
        .scalars()
        .all()
    )
    assert bands, "step 1 must write the CPT packing bands"
    assert all(band.borehole_id is None for band in bands)


@pytest.mark.asyncio
async def test_gp2_step_two_proposes_cpt_to_cpt_ties_across_the_borehole(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP2: the pairing connects CPT to CPT across the intervening borehole."""
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]

    result = await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    assert result["edges_proposed"] > 0, (
        "the only litho path from CPT-A to CPT-B runs through the borehole; "
        "a pairing that stops at borehole columns proposes nothing here"
    )

    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert edges
    assert all(edge.user_approved is False for edge in edges), (
        "refinement of ruling A (owner 2026-08-06): a BRIDGED pair is not "
        "'already a tie in the litho model' — it was inferred by walking the "
        "litho chain across the bandless borehole, so it arrives as a "
        "rejectable proposal"
    )

    # Both endpoints of every proposal are CPT bands: the borehole has none yet.
    layer_ids = {edge.layer_a_id for edge in edges} | {edge.layer_b_id for edge in edges}
    endpoints = (
        (await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.id.in_(layer_ids))))
        .scalars()
        .all()
    )
    assert {layer.cpt_id for layer in endpoints} == {
        pipeline_scene["cpt_a_id"],
        pipeline_scene["cpt_b_id"],
    }


@pytest.mark.asyncio
async def test_gp3_only_accepted_ties_are_visible_to_the_resolver(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP3: a tie joins nothing on its own — pending OR accepted.

    Re-arranged under ruling A (2026-08-05): auto-correlate now yields accepted
    ties, so the pending state is staged with an explicitly inserted proposal
    (the row any non-litho-backed source would write).

    Owner 2026-10-04, *"identity follows the drawing"*: accepting the ties no
    longer merges bands by itself. The accept moves the tie counts; the bodies
    change only when the renderer's recompute posts the fill's geometry facts
    (the desktop schedules it after the accept). The resolver run inside the
    accept therefore leaves the body partition exactly as it was.
    """
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _insert_pending_tie(db_session, pipeline_scene, geotech_model_id)

    async def _body_ids() -> set:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm).where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.cpt_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        return {(row.cpt_id, row.depth_top_m, row.body_id) for row in rows}

    db_session.expire_all()
    while_pending = await _body_ids()
    pending_bodies = {body for _cpt, _top, body in while_pending if body is not None}

    status_before = await _tie_status(async_client, pipeline_scene, geotech_model_id)
    assert status_before["pending_tie_count"] > 0
    assert status_before["accepted_tie_count"] == 0

    accepted = await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)
    assert accepted == status_before["pending_tie_count"]

    db_session.expire_all()
    after = await _body_ids()
    accepted_bodies = {body for _cpt, _top, body in after if body is not None}

    # Each band stood alone while the ties were pending, and still does: an
    # accepted tie is a surface statement until the fill paints it.
    assert len(accepted_bodies) == len(pending_bodies), (
        f"accepting a tie must not join bands by itself "
        f"(pending={len(pending_bodies)} accepted={len(accepted_bodies)})"
    )

    status_after = await _tie_status(async_client, pipeline_scene, geotech_model_id)
    assert status_after["pending_tie_count"] == 0
    assert status_after["accepted_tie_count"] == accepted


@pytest.mark.asyncio
async def test_gp4_divide_boreholes_refuses_while_ties_are_pending(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP4: step 4 is gated on step 3 being finished, and says by how much.

    Staged with an explicit pending tie (ruling A — see GP3).
    """
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _insert_pending_tie(db_session, pipeline_scene, geotech_model_id)
    proposed = 1

    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "geotech_ties_pending"
    assert detail["pending_tie_count"] == proposed


@pytest.mark.asyncio
async def test_gp5_accepting_the_ties_unblocks_the_divide(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP5: with every tie accepted, step 4 runs and the borehole gets bands."""
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    bh_bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == pipeline_scene["bh_id"],
                )
            )
        )
        .scalars()
        .all()
    )
    assert bh_bands, "the borehole must be divided once the ties are accepted"


@pytest.mark.asyncio
async def test_gp6_a_subset_of_the_boreholes_can_be_divided(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP6: naming no boreholes in the subset divides none of them."""
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    # A subset naming an id that exists in NO table: unknown ids are silently
    # ignored (200, zero layers) and the scene's one real borehole is left
    # alone. Honest scope note (audit F29): this scene has exactly one borehole,
    # so subset SELECTION among several real boreholes is pinned nowhere at this
    # level — the ghost right-click e2e flow covers the gesture, not the
    # two-real-boreholes API case.
    other_borehole_id = str(uuid7())
    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={"borehole_ids": [other_borehole_id]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["layer_count"] == 0

    db_session.expire_all()
    bh_bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == pipeline_scene["bh_id"],
                )
            )
        )
        .scalars()
        .all()
    )
    assert bh_bands == [], "a borehole outside the subset must not be divided"

    # Now name it, and it gets divided.
    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={"borehole_ids": [str(pipeline_scene["bh_id"])]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["layer_count"] > 0


@pytest.mark.asyncio
async def test_gp7_the_combined_verb_still_runs_steps_one_and_two(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP7: the old endpoint keeps working, and reports the ties as proposals."""
    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/subdivide-all-bodies",
        json={"litho_model_id": pipeline_scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["edges_derived"] is True
    assert payload["proposed_tie_count"] > 0

    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == payload["geotech_model_id"]
                )
            )
        )
        .scalars()
        .all()
    )
    assert edges
    assert all(edge.user_approved is False for edge in edges), (
        "refinement of ruling A (owner 2026-08-06): the combined verb's "
        "derived ties here are bridged jump pairs — not ties the litho model "
        "already has — so they arrive as rejectable proposals"
    )


@pytest.mark.asyncio
async def test_gp8_an_empty_subset_divides_nothing(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP8: ``{"borehole_ids": []}`` means "divide none", never "divide all".

    A renderer with a cleared selection sends an empty list; the server must
    not translate that into the maximal irreversible whole-model rebuild
    (review finding 1, 2026-08-05).
    """
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={"borehole_ids": []},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["layer_count"] == 0, "an empty subset must write nothing"

    db_session.expire_all()
    bh_bands = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == pipeline_scene["bh_id"],
                )
            )
        )
        .scalars()
        .all()
    )
    assert bh_bands == [], "an empty subset must leave every borehole untouched"


@pytest.mark.asyncio
async def test_gp9_a_subset_preview_shows_exactly_what_the_subset_commit_writes(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP9: preview≡commit holds PER SUBSET (review finding 2, 2026-08-05).

    The ghost-accept flow previews and commits one borehole at a time; the
    ghosts drawn from a subset preview must be exactly the rows the same
    subset's commit writes.
    """
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    subset = {"borehole_ids": [str(pipeline_scene["bh_id"])]}
    base = (
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes"
    )
    preview_resp = await async_client.post(f"{base}/preview", json=subset)
    assert preview_resp.status_code == 200, preview_resp.text
    previewed = {
        column["borehole_id"]: [
            (
                round(band["depth_top_m"], 3),
                round(band["depth_base_m"], 3),
                band["nad_class"],
                band["confidence"],
            )
            for band in column["bands"]
        ]
        for column in preview_resp.json()["columns"]
    }
    assert list(previewed) == [str(pipeline_scene["bh_id"])], (
        "a subset preview must plan the subset only"
    )

    commit_resp = await async_client.post(base, json=subset)
    assert commit_resp.status_code == 200, commit_resp.text

    db_session.expire_all()
    committed_rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.borehole_id == pipeline_scene["bh_id"],
                )
            )
        )
        .scalars()
        .all()
    )
    # FULL tuples — depth, class AND confidence (audit F28: the depths-only
    # compare let a subset commit write the previewed depths with different
    # classes; DB5 pins four-field parity only for the whole-model call).
    class_by_formation = {
        f.id: f.nad_class
        for f in ((await db_session.execute(select(GeologicalFormationOrm))).scalars().all())
    }
    committed = sorted(
        (
            round(r.depth_top_m, 3),
            round(r.depth_base_m, 3),
            class_by_formation.get(r.formation_id),
            r.confidence,
        )
        for r in committed_rows
    )
    expected = sorted((t, b, n, c) for t, b, n, c in previewed[str(pipeline_scene["bh_id"])])
    assert committed == expected, f"GP9: subset ghosts {expected} != subset commit {committed}"


# ---------------------------------------------------------------------------
# GP10/GP11 — the 2026-08-14 ruling: the mediated chain REPLACES the jump ties
# ---------------------------------------------------------------------------


async def _cpt_to_cpt_edges(db_session: AsyncSession, scene: dict, geotech_model_id: str) -> dict:
    """Read every CPT-A↔CPT-B geotech edge, keyed by its canonical layer pair.

    Returns
    -------
    dict
        ``(min_layer_id, max_layer_id) -> LithoContactCorrelationEdgeOrm`` for
        edges whose BOTH endpoints sit on the scene's two CPTs.
    """
    db_session.expire_all()
    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    layer_rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
            )
        )
        .scalars()
        .all()
    )
    cpt_by_layer = {r.id: r.cpt_id for r in layer_rows if r.cpt_id is not None}
    cpt_ids = {scene["cpt_a_id"], scene["cpt_b_id"]}
    return {
        (min(e.layer_a_id, e.layer_b_id), max(e.layer_a_id, e.layer_b_id)): e
        for e in edges
        if cpt_by_layer.get(e.layer_a_id) in cpt_ids and cpt_by_layer.get(e.layer_b_id) in cpt_ids
    }


@pytest.mark.asyncio
async def test_gp10_dividing_the_borehole_replaces_the_jump_ties(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP10: "those cpt to cpt ties should be replaced by cpt to borehole to
    borehole to cpt ties once i click subdivide boreholes" (owner, 2026-08-14).

    After the divide materialises the accepted chain (the forced-top
    restatements of the direct litho ties A↔BH and BH↔B), the accepted
    CPT↔CPT jump tie between the same top bands must be GONE — "just delete
    all, it'll be a real bother to delete all by hand once the proper chain
    is there".  A jump tie whose chain hops are still pending proposals keeps
    carrying the connection and survives.
    """
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    before = await _cpt_to_cpt_edges(db_session, pipeline_scene, geotech_model_id)
    assert before, "scene invariant: accepted CPT↔CPT jump ties exist before the divide"
    assert all(e.user_approved for e in before.values())

    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    after = await _cpt_to_cpt_edges(db_session, pipeline_scene, geotech_model_id)
    deleted_pairs = set(before) - set(after)
    assert deleted_pairs, (
        "GP10: the divide materialised the accepted chain, so at least the "
        "top jump tie must be replaced by it — none was deleted"
    )
    assert payload["superseded_jump_tie_count"] == len(deleted_pairs), (
        f"GP10: the response must own the deletion — reported "
        f"{payload['superseded_jump_tie_count']}, actually deleted {len(deleted_pairs)}"
    )

    # The proper chain is really there: accepted edges now join each CPT to
    # the borehole (the replacement the ruling names, not merely a deletion).
    db_session.expire_all()
    all_edges = (
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
    layer_rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
            )
        )
        .scalars()
        .all()
    )
    inv_by_layer = {r.id: (r.cpt_id if r.cpt_id is not None else r.borehole_id) for r in layer_rows}
    accepted_inv_pairs = {
        frozenset((inv_by_layer.get(e.layer_a_id), inv_by_layer.get(e.layer_b_id)))
        for e in all_edges
    }
    assert frozenset((pipeline_scene["cpt_a_id"], pipeline_scene["bh_id"])) in accepted_inv_pairs
    assert frozenset((pipeline_scene["bh_id"], pipeline_scene["cpt_b_id"])) in accepted_inv_pairs

    # And every surviving jump tie is one whose chain is NOT accepted yet —
    # the deep (dicht) pair's chain hops arrive as pending interior proposals,
    # so that jump tie is still the only accepted carrier and stays.
    for pair_key, survivor in after.items():
        assert survivor.user_approved, (
            f"GP10: a surviving jump tie should be the still-only-carrier kind, "
            f"got an unapproved leftover {pair_key}"
        )


@pytest.mark.asyncio
async def test_gp11_an_undivided_borehole_keeps_the_jump_ties(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP11: no chain, no supersession — a divide that leaves the borehole
    bandless (unknown-id subset) must not touch the jump ties: they are still
    the only carrier of the CPT↔CPT connection."""
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    before = await _cpt_to_cpt_edges(db_session, pipeline_scene, geotech_model_id)
    assert before

    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={"borehole_ids": [str(uuid7())]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["superseded_jump_tie_count"] == 0

    after = await _cpt_to_cpt_edges(db_session, pipeline_scene, geotech_model_id)
    assert set(after) == set(before), "GP11: an undivided borehole must keep every jump tie"


# ---------------------------------------------------------------------------
# GP12/GP13 — the 2026-08-15 correction: supersession keys on GEOMETRY
# ---------------------------------------------------------------------------


async def _accepted_investigation_pairs(
    db_session: AsyncSession, geotech_model_id: str
) -> set[frozenset]:
    """Every ACCEPTED geotech edge, as the unordered pair of columns it joins."""
    db_session.expire_all()
    edges = (
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
    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
            )
        )
        .scalars()
        .all()
    )
    inv_by_layer = {r.id: (r.cpt_id if r.cpt_id is not None else r.borehole_id) for r in layers}
    return {
        frozenset((inv_by_layer.get(e.layer_a_id), inv_by_layer.get(e.layer_b_id))) for e in edges
    }


async def _approved_litho_investigation_pairs(
    db_session: AsyncSession, litho_model_id: str
) -> set[frozenset]:
    """Every APPROVED litho correlation, as the unordered pair of columns it joins."""
    db_session.expire_all()
    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == litho_model_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == litho_model_id)
            )
        )
        .scalars()
        .all()
    )
    inv_by_layer = {r.id: (r.cpt_id if r.cpt_id is not None else r.borehole_id) for r in layers}
    return {
        frozenset((inv_by_layer.get(e.layer_a_id), inv_by_layer.get(e.layer_b_id))) for e in edges
    }


@pytest.mark.asyncio
async def test_gp12_a_restatement_of_a_direct_litho_tie_is_replaced_too(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP12: the owner's own case — he correlates CPT→CPT ACROSS the borehole.

    *"clicked divide boreholes, the ties that jump over boreholes still stay
    and the chain isn't made from cpt to borehole to borehole to cpt"*
    (2026-08-15).  The tie he means restates a DIRECT A↔B litho correlation,
    which the first implementation read as a restatement and spared.  It must
    go like any other spanning tie: "just delete all, it'll be a real bother to
    delete all by hand once the proper chain is there".

    Doubles as the no-deadlock pin: the A↔B tie is ACCEPTED and standing while
    the divide derives the A→BH and BH→B hops, and both hops must still land.
    (They can: the crossing guard buckets candidates by the sorted investigation
    PAIR, so a tie in the A↔B gap is never judged against one in the A↔BH gap.)
    """
    # The scene withholds the direct A↔B litho tie on purpose; add it, so the
    # geotech derivation produces the very restatement the old rule protected.
    await correlate(
        async_client,
        pipeline_scene["project_id"],
        pipeline_scene["litho_model_id"],
        contact_a=pipeline_scene["contact_a"],
        contact_b=pipeline_scene["contact_b"],
        section_id=pipeline_scene["section_id"],
    )

    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    before = await _cpt_to_cpt_edges(db_session, pipeline_scene, geotech_model_id)
    assert before, "scene invariant: A↔B ties exist before the divide"
    # THE discriminator against GP10: this scene's A↔B geotech ties restate an
    # approved LITHO correlation between the very same two CPTs — the shape the
    # provenance carve-out spared, and 93 of the owner's 103 ties.
    litho_pairs = await _approved_litho_investigation_pairs(
        db_session, pipeline_scene["litho_model_id"]
    )
    assert frozenset((pipeline_scene["cpt_a_id"], pipeline_scene["cpt_b_id"])) in litho_pairs, (
        "scene invariant: the direct A↔B litho correlation is what makes this a restatement"
    )

    resp = await async_client.post(
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )
    assert resp.status_code == 200, resp.text

    after = await _cpt_to_cpt_edges(db_session, pipeline_scene, geotech_model_id)
    assert set(before) - set(after), (
        "GP12: the A↔B tie restates a direct litho correlation, and the borehole "
        "chain now carries it — provenance must not spare it"
    )

    # The replacement is really there: A→BH and BH→B, both accepted.
    accepted_pairs = await _accepted_investigation_pairs(db_session, geotech_model_id)
    assert frozenset((pipeline_scene["cpt_a_id"], pipeline_scene["bh_id"])) in accepted_pairs
    assert frozenset((pipeline_scene["bh_id"], pipeline_scene["cpt_b_id"])) in accepted_pairs
    assert resp.json()["superseded_jump_tie_count"] == len(set(before) - set(after))


async def _demote_borehole_hops(db_session: AsyncSession, geotech_model_id: str) -> int:
    """Set every borehole-involving geotech edge back to PENDING.

    Reproduces the state the engineer is in when he has not pressed step 3 on
    the proposals the divide just derived.
    """
    db_session.expire_all()
    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
            )
        )
        .scalars()
        .all()
    )
    borehole_layer_ids = {r.id for r in layers if r.borehole_id is not None}
    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    demoted = 0
    for edge in edges:
        if edge.layer_a_id in borehole_layer_ids or edge.layer_b_id in borehole_layer_ids:
            edge.user_approved = False
            demoted += 1
    await db_session.commit()
    return demoted


async def _hand_draw_top_band_tie(
    db_session: AsyncSession, scene: dict, geotech_model_id: str
) -> UUID:
    """Draw an ACCEPTED tie between the two CPTs' shallowest bands, by hand."""
    db_session.expire_all()

    async def _top(cpt_id) -> LithoLayerOrm:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm)
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.cpt_id == cpt_id,
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .all()
        )
        assert rows, f"no geotech bands on CPT {cpt_id}"
        return rows[0]

    a = await _top(scene["cpt_a_id"])
    b = await _top(scene["cpt_b_id"])
    lo, hi = (a.id, b.id) if a.id < b.id else (b.id, a.id)
    edge_id = uuid7()
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=edge_id,
            model_id=UUID(str(geotech_model_id)),
            section_id=UUID(str(scene["section_id"])),
            layer_a_id=lo,
            layer_b_id=hi,
            layer_a_side="top",
            layer_b_side="top",
            user_approved=True,
            source="manual",
        )
    )
    await db_session.commit()
    return edge_id


async def _edge_exists(db_session: AsyncSession, edge_id: UUID) -> bool:
    """Whether a correlation-edge row is still in the table."""
    db_session.expire_all()
    return (
        await db_session.execute(
            select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.id == edge_id
            )
        )
    ).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_gp13_a_pending_chain_hop_keeps_the_spanning_tie(
    pipeline_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GP13: a hop the engineer has not accepted carries nothing.

    Same CPT–BH–CPT world as GP12, but the borehole chain is left unjudged.
    The spanning A↔B tie is then the only ACCEPTED carrier of that connection,
    so deleting it would lose approved information — it stays.  Accepting the
    chain and asking again is the negative control: the very same tie goes.

    ``borehole_ids: []`` divides no borehole (GP8), so the two presses below
    differ in exactly one thing — whether the chain is accepted.
    """
    await correlate(
        async_client,
        pipeline_scene["project_id"],
        pipeline_scene["litho_model_id"],
        contact_a=pipeline_scene["contact_a"],
        contact_b=pipeline_scene["contact_b"],
        section_id=pipeline_scene["section_id"],
    )
    geotech_model_id = (await _subdivide_cpts(async_client, pipeline_scene))["geotech_model_id"]
    await _auto_correlate(async_client, pipeline_scene, geotech_model_id)
    await _accept_all_ties(async_client, pipeline_scene, geotech_model_id)

    divide_url = (
        f"/projects/{pipeline_scene['project_id']}/geology/models/"
        f"{pipeline_scene['litho_model_id']}/geotech/divide-boreholes"
    )
    first = await async_client.post(divide_url, json={})
    assert first.status_code == 200, first.text

    demoted = await _demote_borehole_hops(db_session, geotech_model_id)
    assert demoted, "scene invariant: the divide derived borehole hops to demote"
    hand_tie = await _hand_draw_top_band_tie(db_session, pipeline_scene, geotech_model_id)

    # ``ignore_pending_ties`` only skips the accept-your-ties GATE; it says
    # nothing to the supersession, which reads approval per hop.
    pending_run = await async_client.post(
        divide_url, json={"borehole_ids": [], "ignore_pending_ties": True}
    )
    assert pending_run.status_code == 200, pending_run.text
    assert pending_run.json()["superseded_jump_tie_count"] == 0, (
        "GP13: the supersession reads per-hop approval and every hop is "
        "pending — IT may delete nothing"
    )
    assert pending_run.json()["replaced_span_count"] >= 1, (
        "GP13: Phase 8.6 replaces the span with its own accepted pieces "
        "instead — the borehole has data at the line"
    )
    assert not await _edge_exists(db_session, hand_tie), (
        "GP13: the span is re-expressed, not preserved"
    )
    # The approved information survives as ACCEPTED pieces anchored on the
    # borehole — nothing rides on the pending hops.
    accepted_count = (
        await db_session.execute(
            select(func.count())
            .select_from(LithoContactCorrelationEdgeOrm)
            .where(
                LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id),
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).scalar_one()
    assert accepted_count >= 2, "GP13: the chain pieces landing on the borehole must exist accepted"
