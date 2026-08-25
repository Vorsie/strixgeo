"""Geotech ties are only derived between columns their section actually draws.

Owner ruling, 2026-08-25 — shown a pending machine tie from ``GEO-10/170-S4``
to ``1411-GEO-23/126-B6`` on Tie-section 7, a 62 m section whose corridor B6
sits inside but whose endpoints it falls outside:

    "yeah make it section scoped ofcourse"

Why an integration test and not only the unit ones
--------------------------------------------------
The bug was never in the derivation arithmetic.  It was that the three geotech
writers took their input from ``load_approved_litho_edge_sets``, which selected
the parent model's approved litho edges by ``section_id`` ALONE — trusting the
litho table's own scoping.  That table still carries rows written before
``project_onto_section_corridor`` gained its between-the-endpoints clamp
(2026-08-03).  So the thing under test is a query boundary, and a fake session
can only prove the code runs, not that the real SELECTs and the real projection
agree.

Scene
-----
Two sections and three CPTs, laid out to the owner's real geometry::

    SA-Tie    (149000, 200000) -> (149062, 200000), buffer 7 m
    SB-Cross  (148900, 200002.414) -> (149100, 200002.414), buffer 60 m

    CPT-A     (149001.000, 200000.000)   SA along  1.00   SB: on
    CPT-B     (149060.000, 200000.000)   SA along 60.00   SB: on
    CPT-OFF   (148998.162, 200002.414)   SA along -1.84   SB: on

``CPT-OFF`` is 2.41 m from the SA-Tie line — comfortably inside its 7 m
corridor — but projects 1.84 m BEFORE the start endpoint, so SA-Tie never draws
it.  It IS drawn on SB-Cross, which is what gives it geotech bands and makes
the mis-scoped tie derivable in the first place.

Cases
-----
OS1  Auto-correlate on SA-Tie derives no tie to ``CPT-OFF``, and says so.
OS2  Control — the ``CPT-A``/``CPT-B`` tie on the same section still lands.
OS3  A stored PENDING machine tie to ``CPT-OFF`` is swept.
OS4  An accepted or hand-drawn one is counted and warned about, never deleted.
OS5  The build pass obeys the same rule (the gate is in the shared loader, so
     a full re-subdivide cannot put the tie back).

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_geotech_offsection_edges.py
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
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import accept_cpt_litho, two_layer_qc

# SA-Tie, shaped like the owner's Tie-section 7: short, narrow corridor.
_TIE_START = (149_000.0, 200_000.0)
_TIE_END = (149_062.0, 200_000.0)
_TIE_BUFFER_M = 7.0

# Where the three columns stand.  CPT-OFF repeats B6's real offset/along pair.
_CPT_A_XY = (149_001.0, 200_000.0)
_CPT_B_XY = (149_060.0, 200_000.0)
_CPT_OFF_XY = (148_998.162, 200_002.414)


@pytest_asyncio.fixture
async def offsection_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Two sections, three CPTs, and a mis-scoped approved litho correlation.

    The litho edges are inserted through the ORM rather than the correlate
    endpoint on purpose: they stand in for LEGACY rows: written by a build that
    scoped on lateral offset alone, and unreachable through today's API.  That
    is exactly the state the fix has to cope with.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``tie_section_id``,
        ``cross_section_id``, ``cpt_a_id``, ``cpt_b_id``, ``cpt_off_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech off-section edges", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "OS-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "OS-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_resp.json()["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    async def _section(name: str, start: tuple, end: tuple, buffer_m: float) -> str:
        resp = await async_client.post(
            f"/projects/{pid}/sections",
            json={
                "name": name,
                "start_x": start[0],
                "start_y": start[1],
                "end_x": end[0],
                "end_y": end[1],
                "epsg": 31370,
                "projection_buffer_m": buffer_m,
            },
        )
        assert resp.status_code == 201, resp.text
        return str(resp.json()["id"])

    tie_section_id = await _section("SA-Tie", _TIE_START, _TIE_END, _TIE_BUFFER_M)
    cross_section_id = await _section(
        "SB-Cross", (148_900.0, 200_002.414), (149_100.0, 200_002.414), 60.0
    )

    def _cpt(name: str, xy: tuple) -> CptOrm:
        depths, qc = two_layer_qc(n_top=200, n_bot=200, qc_top=8.0, qc_bot=18.0)
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="OS",
            test_id=f"OS/{name}",
            app_project_id=proj.id,
            location_x=xy[0],
            location_y=xy[1],
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

    cpt_a = _cpt("CPT-A", _CPT_A_XY)
    cpt_b = _cpt("CPT-B", _CPT_B_XY)
    cpt_off = _cpt("CPT-OFF", _CPT_OFF_XY)
    db_session.add_all([cpt_a, cpt_b, cpt_off])
    await db_session.commit()

    for cpt in (cpt_a, cpt_b, cpt_off):
        await accept_cpt_litho(
            async_client, pid, litho_model_id, cpt_id=str(cpt.id), top=0.0, base=8.0
        )

    layer_of = await _litho_layer_by_cpt(db_session, litho_model_id)
    for partner in (cpt_b.id, cpt_off.id):
        # BOTH edges carry SA-Tie's id. The CPT-A/CPT-B one is legitimate; the
        # CPT-A/CPT-OFF one is the legacy mis-scoped row under test.
        a_id, b_id = sorted((layer_of[cpt_a.id], layer_of[partner]))
        db_session.add(
            LithoContactCorrelationEdgeOrm(
                id=uuid7(),
                model_id=UUID(litho_model_id),
                section_id=UUID(tie_section_id),
                layer_a_id=a_id,
                layer_b_id=b_id,
                layer_a_side="top",
                layer_b_side="top",
                source="auto",
                user_approved=True,
            )
        )
    await db_session.commit()

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "tie_section_id": tie_section_id,
        "cross_section_id": cross_section_id,
        "cpt_a_id": cpt_a.id,
        "cpt_b_id": cpt_b.id,
        "cpt_off_id": cpt_off.id,
    }


async def _litho_layer_by_cpt(db_session: AsyncSession, model_id: str) -> dict[UUID, UUID]:
    """The SHALLOWEST accepted litho layer per CPT.

    The scene accepts one 0–8 m unit per column, but taking the shallowest
    explicitly keeps the fixture honest if the litho contiguity triggers ever
    split it: an arbitrary "last row wins" would silently correlate a different
    unit than the comment claims.
    """
    rows = (
        await db_session.execute(
            select(LithoLayerOrm.id, LithoLayerOrm.cpt_id)
            .where(
                LithoLayerOrm.model_id == UUID(model_id),
                LithoLayerOrm.status == "accepted",
            )
            .order_by(LithoLayerOrm.depth_top_m)
        )
    ).all()
    layer_of: dict[UUID, UUID] = {}
    for row in rows:
        layer_of.setdefault(row.cpt_id, row.id)
    return layer_of


async def _subdivide(async_client: AsyncClient, scene: dict) -> str:
    """Run pipeline step 1 (bands only) model-wide; returns the geotech model id."""
    resp = await async_client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _subdivide_all_bodies(async_client: AsyncClient, scene: dict) -> str:
    """Run the COMBINED verb (bands + edge derivation); returns the geotech model id.

    ``subdivide-cpts`` runs with ``derive_edges=False``; this is the press that
    exercises ``SubdivideAllBodies``' own call into the shared derivation.
    """
    resp = await async_client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-all-bodies",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _auto_correlate(async_client: AsyncClient, scene: dict, geotech_model_id: str) -> dict:
    """Run pipeline step 2 scoped to SA-Tie."""
    resp = await async_client.post(
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/auto-correlate",
        json={"section_id": scene["tie_section_id"]},
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _tie_columns_on_section(
    db_session: AsyncSession, geotech_model_id: str, section_id: str
) -> list[set[UUID]]:
    """The pair of columns each geotech edge on a section connects."""
    band_column = {
        row.id: (row.borehole_id if row.borehole_id is not None else row.cpt_id)
        for row in (
            await db_session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.cpt_id, LithoLayerOrm.borehole_id).where(
                    LithoLayerOrm.model_id == UUID(geotech_model_id)
                )
            )
        ).all()
    }
    edges = (
        await db_session.execute(
            select(
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id),
                LithoContactCorrelationEdgeOrm.section_id == UUID(section_id),
            )
        )
    ).all()
    return [{band_column.get(e.layer_a_id), band_column.get(e.layer_b_id)} for e in edges]


async def _store_geotech_tie(
    db_session: AsyncSession,
    scene: dict,
    geotech_model_id: str,
    *,
    source: str,
    user_approved: bool,
) -> UUID:
    """Persist one geotech tie from CPT-A to CPT-OFF on SA-Tie, and return its id.

    Stands in for a row an older derivation wrote before the membership gate
    existed — the only kind the sweep can encounter.
    """
    band_of: dict[UUID, UUID] = {}
    for row in (
        await db_session.execute(
            select(LithoLayerOrm.id, LithoLayerOrm.cpt_id, LithoLayerOrm.depth_top_m)
            .where(LithoLayerOrm.model_id == UUID(geotech_model_id))
            .order_by(LithoLayerOrm.depth_top_m)
        )
    ).all():
        band_of.setdefault(row.cpt_id, row.id)

    a_id, b_id = sorted((band_of[scene["cpt_a_id"]], band_of[scene["cpt_off_id"]]))
    edge_id = uuid7()
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=edge_id,
            model_id=UUID(geotech_model_id),
            section_id=UUID(scene["tie_section_id"]),
            layer_a_id=a_id,
            layer_b_id=b_id,
            # A side pair the derivation never emits, so the row cannot collide
            # with anything the press writes itself.
            layer_a_side="base",
            layer_b_side="base",
            source=source,
            user_approved=user_approved,
        )
    )
    await db_session.commit()
    return edge_id


async def _edge_exists(db_session: AsyncSession, edge_id: UUID) -> bool:
    """Whether a correlation edge row is still in the table."""
    return (
        await db_session.execute(
            select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.id == edge_id
            )
        )
    ).first() is not None


@pytest.mark.asyncio
async def test_os1_no_tie_is_derived_to_a_column_the_section_does_not_draw(
    offsection_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """OS1: "yeah make it section scoped ofcourse".

    CPT-OFF is inside SA-Tie's corridor and correlated to CPT-A at the litho
    level, so the pre-fix derivation restated that tie onto their packing
    bands.  It projects past the section's start endpoint, so SA-Tie never
    draws it and the engineer can neither see nor resolve the gap.
    """
    geotech_model_id = await _subdivide(async_client, offsection_scene)
    payload = await _auto_correlate(async_client, offsection_scene, geotech_model_id)

    pairs = await _tie_columns_on_section(
        db_session, geotech_model_id, offsection_scene["tie_section_id"]
    )
    assert all(offsection_scene["cpt_off_id"] not in pair for pair in pairs), (
        "a tie was derived onto a column the section does not draw"
    )
    assert payload["investigations_off_section"] == 1, payload


@pytest.mark.asyncio
async def test_os2_the_sections_own_columns_still_tie(
    offsection_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """OS2: the control — the gate removes the undrawn column and nothing else.

    CPT-A and CPT-B are both on SA-Tie and carry the same approved litho
    correlation, so their packing ties must survive the scoping change intact.
    """
    geotech_model_id = await _subdivide(async_client, offsection_scene)
    await _auto_correlate(async_client, offsection_scene, geotech_model_id)

    pairs = await _tie_columns_on_section(
        db_session, geotech_model_id, offsection_scene["tie_section_id"]
    )
    expected = {offsection_scene["cpt_a_id"], offsection_scene["cpt_b_id"]}
    assert any(pair == expected for pair in pairs), (
        f"the section's own CPT-A/CPT-B tie went missing; ties found: {pairs}"
    )


@pytest.mark.asyncio
async def test_os3_a_stored_pending_machine_tie_is_swept(
    offsection_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """OS3: a fixed emitter cannot reach a row already in the table.

    A proposal on a gap the section does not draw can be neither accepted nor
    rejected — it can only sit in the review count forever, which is what the
    owner found.  The run that re-proposes the section's ties removes it.
    """
    geotech_model_id = await _subdivide(async_client, offsection_scene)
    edge_id = await _store_geotech_tie(
        db_session, offsection_scene, geotech_model_id, source="auto", user_approved=False
    )

    payload = await _auto_correlate(async_client, offsection_scene, geotech_model_id)

    assert payload["offsection_ties_deleted"] == 1, payload
    assert not await _edge_exists(db_session, edge_id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "user_approved"),
    [("auto", True), ("manual", True), ("manual", False)],
    ids=["machine-tie-he-accepted", "hand-drawn-and-accepted", "hand-drawn-pending"],
)
async def test_os4_an_accepted_or_hand_drawn_tie_is_reported_never_deleted(
    offsection_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
    source: str,
    user_approved: bool,
) -> None:
    """OS4: "user made ties should be left alone".

    The mis-scoping is real either way, but a tie the engineer accepted — or
    drew himself — is his statement about the ground.  The run counts it and
    warns; taking it back is his call.
    """
    geotech_model_id = await _subdivide(async_client, offsection_scene)
    edge_id = await _store_geotech_tie(
        db_session,
        offsection_scene,
        geotech_model_id,
        source=source,
        user_approved=user_approved,
    )

    payload = await _auto_correlate(async_client, offsection_scene, geotech_model_id)

    assert payload["offsection_ties_deleted"] == 0, payload
    assert payload["offsection_ties_retained"] == 1, payload
    assert await _edge_exists(db_session, edge_id)


@pytest.mark.asyncio
async def test_os5_the_build_pass_cannot_put_the_mis_scoped_tie_back(
    offsection_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """OS5: the gate lives in the shared loader, so every writer obeys it.

    ``SubdivideAllBodies`` and ``DivideBoreholes`` read the same approved litho
    edges, and the divide writes its hops born ACCEPTED — a mis-scoped one
    would enter the model looking like the engineer's own line, and the sweep
    would then be right to refuse to remove it.  Gating auto-correlate alone
    would have left the next full press to put the tie straight back.
    """
    geotech_model_id = await _subdivide_all_bodies(async_client, offsection_scene)

    pairs = await _tie_columns_on_section(
        db_session, geotech_model_id, offsection_scene["tie_section_id"]
    )
    assert pairs, "the build derived no ties at all — the scene proves nothing"
    assert all(offsection_scene["cpt_off_id"] not in pair for pair in pairs), (
        "the build pass created a tie onto a column the section does not draw"
    )
    assert any(
        pair == {offsection_scene["cpt_a_id"], offsection_scene["cpt_b_id"]} for pair in pairs
    ), f"the build lost the section's own CPT-A/CPT-B tie; ties found: {pairs}"
