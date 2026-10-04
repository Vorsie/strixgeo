"""Integration tests for the packing-tie crossing guard (owner dogfeed 2026-08-15).

The owner pressed pipeline step 2 and his section answered *"1 crossing
correlation tie — resolve to restore bands"*, with the bands gone on that gap.
A crossing is a HARD CONFLICT by his own §8 Q4 ruling — the renderer suspends
BOTH ties and neither side bands — so a machine proposal that crosses is pure
friction AND it silently kills the fill where it lands.

Scene
-----
CPT-A (x=149 000) — CPT-B (x=149 600) on one section, ZAND 0–9 m on both, a
DIRECT litho correlation A↔B, and three packing zones per column at different
depths (A breaks at 3 m and 6 m, B at 2 m and 5 m).  A hand-drawn ACCEPTED tie
then runs from A's shallowest band down to B's deepest — the shape that makes
the middle same-class pair invert against it.

Cases
-----
XG-DB1  With that approval standing, auto-correlate emits NO tie that crosses
        it: the middle pair is refused rather than proposed.
XG-DB2  Negative control on the same scene with no hand-drawn tie: the very
        same middle pair IS proposed, so the guard is not a blanket
        "propose less".
XG-DB3  The SWEEP deletes a stored machine crossing pair and nothing else —
        the guard gates candidates and cannot reach a row already in the model.
XG-DB4  The sweep never deletes a hand-drawn tie; the machine one yields.
XG-DB5  DRAWING a crossing tie is refused 422 with a reason naming the two
        columns and depths — never a database id — and writes nothing.
XG-DB6  Negative control: a tie that keeps the order still lands.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_geotech_crossing_guard.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_crossing_sweep import sweep_crossing_ties
from groundmodel.domain.services.geotech_edge_crossing_guard import GapTie, ties_cross
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.logging.logger_factory import LoggerFactory
from tests.integration.api.geotech_scene_helpers import (
    accept_cpt_litho,
    correlate,
    paint_accepted_ties,
)

# The two columns break their packing at DIFFERENT depths, which is what lets a
# tie drawn between mismatched bands slope steeply enough to be crossed.
_A_BREAKS_M = (3.0, 6.0)
_B_BREAKS_M = (2.0, 5.0)
_COLUMN_DEPTH_M = 9.0


def _three_zone_qc(breaks_m: tuple[float, float]) -> tuple[list[float], list[float]]:
    """Return ``(depths_m, qc_mpa)`` for three packing zones on a 2 cm interval."""
    depths = [round(i * 0.02, 3) for i in range(int(_COLUMN_DEPTH_M / 0.02))]
    qc = [
        5.0 if d < breaks_m[0] else (12.0 if d < breaks_m[1] else 25.0)  # los / matig / dicht
        for d in depths
    ]
    return depths, qc


@pytest_asyncio.fixture
async def crossing_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Two directly-correlated CPTs whose packing breaks sit at different depths.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``section_id``, ``cpt_a_id``,
        ``cpt_b_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech crossing guard test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "XG-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "XG-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_resp.json()["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "XG-Section",
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

    def _cpt(name: str, x: float, breaks_m: tuple[float, float]) -> CptOrm:
        depths, qc = _three_zone_qc(breaks_m)
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="XG",
            test_id=f"XG/{name}",
            app_project_id=proj.id,
            location_x=x,
            location_y=200_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=_COLUMN_DEPTH_M,
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

    cpt_a = _cpt("CPT-A", 149_000.0, _A_BREAKS_M)
    cpt_b = _cpt("CPT-B", 149_600.0, _B_BREAKS_M)
    db_session.add_all([cpt_a, cpt_b])
    await db_session.commit()

    contact_a = await accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_a.id), top=0.0, base=_COLUMN_DEPTH_M
    )
    contact_b = await accept_cpt_litho(
        async_client, pid, litho_model_id, cpt_id=str(cpt_b.id), top=0.0, base=_COLUMN_DEPTH_M
    )
    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contact_a,
        contact_b=contact_b,
        section_id=section_id,
    )
    # The fill paints the litho tie as a band: ONE litho body (identity follows the
    # drawing, owner 2026-10-04) — the hand-drawn packing ties need that body.
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "cpt_a_id": cpt_a.id,
        "cpt_b_id": cpt_b.id,
    }


async def _subdivide_cpts(client: AsyncClient, scene: dict) -> str:
    """Run pipeline step 1 and return the geotech model id."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _auto_correlate(client: AsyncClient, scene: dict, geotech_model_id: str) -> None:
    """Run pipeline step 2."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/auto-correlate",
        json={},
    )
    assert resp.status_code == 200, resp.text


async def _bands(db_session: AsyncSession, geotech_model_id: str, cpt_id) -> list[LithoLayerOrm]:
    """One column's geotech packing bands, top→base."""
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


async def _edge_pairs(db_session: AsyncSession, geotech_model_id: str) -> set[frozenset[UUID]]:
    """Every geotech edge on the model, as unordered endpoint pairs."""
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id)
                )
            )
        )
        .scalars()
        .all()
    )
    return {frozenset((e.layer_a_id, e.layer_b_id)) for e in rows}


async def _plant_hand_drawn_tie(
    db_session: AsyncSession, scene: dict, geotech_model_id: str
) -> None:
    """Approve a tie from A's shallowest band down to B's deepest.

    That is the shape the owner's section carried: it falls steeply to the
    right, so every same-class pair below the top rises across it.
    """
    a_bands = await _bands(db_session, geotech_model_id, scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, scene["cpt_b_id"])
    assert len(a_bands) >= 3 and len(b_bands) >= 3, (
        "the scene must subdivide into at least three packing bands per column, "
        f"got {len(a_bands)} and {len(b_bands)}"
    )
    shallow_a, deep_b = a_bands[0], b_bands[-1]
    lo, hi = (shallow_a.id, deep_b.id) if shallow_a.id < deep_b.id else (deep_b.id, shallow_a.id)
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=UUID(geotech_model_id),
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


@pytest.mark.asyncio
async def test_xgdb1_auto_correlate_emits_no_tie_that_crosses_a_standing_approval(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """XG-DB1: the middle pair would cross the hand-drawn tie, so it is refused.

    Asserted twice over: the specific pair is absent, AND no two ties in the
    gap invert between the columns — the invariant the renderer's warning
    banner enforces from the other side.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    await _plant_hand_drawn_tie(db_session, crossing_scene, geotech_model_id)

    await _auto_correlate(async_client, crossing_scene, geotech_model_id)
    db_session.expire_all()

    a_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_b_id"])
    pairs = await _edge_pairs(db_session, geotech_model_id)

    assert frozenset((a_bands[1].id, b_bands[1].id)) not in pairs, (
        "the middle pair rises to the right while the engineer's own tie falls "
        "to the right — proposing it would suspend BOTH and blank the gap"
    )

    # The invariant itself, on the rows that actually landed: read every edge as
    # the two depths it joins and check no two of them invert.
    depth_of = {
        band.id: (column, float(band.depth_top_m))
        for column, bands in (("A", a_bands), ("B", b_bands))
        for band in bands
    }
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id)
                )
            )
        )
        .scalars()
        .all()
    )
    standing: list[GapTie] = []
    for edge in rows:
        home_a = depth_of.get(edge.layer_a_id)
        home_b = depth_of.get(edge.layer_b_id)
        if home_a is None or home_b is None or home_a[0] == home_b[0]:
            continue
        on_a, on_b = (home_a, home_b) if home_a[0] == "A" else (home_b, home_a)
        standing.append(
            GapTie(
                depth_first_m=on_a[1],
                depth_second_m=on_b[1],
                accepted=bool(edge.user_approved),
                layer_first_id=str(edge.layer_a_id),
                layer_second_id=str(edge.layer_b_id),
            )
        )
    for i, first in enumerate(standing):
        for second in standing[i + 1 :]:
            assert not ties_cross(first, second), (
                f"two ties in the gap invert between the columns: "
                f"{first.depth_first_m}→{first.depth_second_m} against "
                f"{second.depth_first_m}→{second.depth_second_m}"
            )


@pytest.mark.asyncio
async def test_xgdb2_without_the_standing_approval_the_same_pair_is_proposed(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """XG-DB2: negative control — the guard refuses a crossing, not a pair.

    Identical scene, no hand-drawn tie. The middle pair must arrive exactly as
    it always did, or the guard has quietly become "propose less".
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)

    await _auto_correlate(async_client, crossing_scene, geotech_model_id)
    db_session.expire_all()

    a_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_b_id"])
    pairs = await _edge_pairs(db_session, geotech_model_id)

    assert frozenset((a_bands[1].id, b_bands[1].id)) in pairs, (
        "nothing crosses here — the middle same-class pair is exactly what the "
        "engineer presses auto-correlate for"
    )


async def _plant_tie(
    db_session: AsyncSession,
    scene: dict,
    geotech_model_id: str,
    band_a: LithoLayerOrm,
    band_b: LithoLayerOrm,
    *,
    source: str,
) -> UUID:
    """Store one approved tie between two bands and return its id."""
    lo, hi = (band_a, band_b) if band_a.id < band_b.id else (band_b, band_a)
    edge_id = uuid7()
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=edge_id,
            model_id=UUID(geotech_model_id),
            section_id=UUID(str(scene["section_id"])),
            layer_a_id=lo.id,
            layer_b_id=hi.id,
            layer_a_side="top",
            layer_b_side="top",
            user_approved=True,
            source=source,
        )
    )
    await db_session.commit()
    return edge_id


@pytest.mark.asyncio
async def test_xgdb3_the_sweep_deletes_a_machine_crossing_pair(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """XG-DB3: two machine ties crossing only each other both go.

    Owner ruling 2026-08-17: *"Ties shouldn't be able to cross, if any crossing
    ties are in my test.strix it is because you generated them, not because i
    drew them."*  Verified on his model: all 14 edges behind his four crossings
    were ``source='auto'``.

    The guard cannot help here — it refuses new CANDIDATES, while these rows are
    already stored, and the re-anchor carries them across every rebuild.  Planted
    directly for that reason: this pins the repair, not the emitter.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    a_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_b_id"])

    # A's shallow band to B's deep band, and A's deep band to B's shallow one:
    # inverted between the columns, so they cross.
    down = await _plant_tie(
        db_session, crossing_scene, geotech_model_id, a_bands[0], b_bands[-1], source="auto"
    )
    up = await _plant_tie(
        db_session, crossing_scene, geotech_model_id, a_bands[-1], b_bands[0], source="auto"
    )
    survivor = await _plant_tie(
        db_session, crossing_scene, geotech_model_id, a_bands[1], b_bands[1], source="auto"
    )

    deleted = await sweep_crossing_ties(
        db_session, LoggerFactory.get_logger(__name__), UUID(geotech_model_id)
    )
    await db_session.commit()
    db_session.expire_all()

    remaining = {
        row.id
        for row in (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id)
                )
            )
        ).scalars()
    }
    assert deleted == 2, f"expected the crossing pair to go, swept {deleted}"
    assert down not in remaining and up not in remaining
    assert survivor in remaining, "the monotone middle tie must not be collateral"


@pytest.mark.asyncio
async def test_xgdb4_the_sweep_never_deletes_a_hand_drawn_tie(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """XG-DB4: *"user made ties should be left alone"* — the machine one yields.

    His steep lines are deliberate: *"if the users draws a steep tie, he has a
    reason for it"*.  So a crossing between his tie and a machine tie is resolved
    by deleting the machine's, and the sweep is not a licence to tidy his work.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    a_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_b_id"])

    his = await _plant_tie(
        db_session, crossing_scene, geotech_model_id, a_bands[0], b_bands[-1], source="manual"
    )
    machine = await _plant_tie(
        db_session, crossing_scene, geotech_model_id, a_bands[-1], b_bands[0], source="auto"
    )

    deleted = await sweep_crossing_ties(
        db_session, LoggerFactory.get_logger(__name__), UUID(geotech_model_id)
    )
    await db_session.commit()
    db_session.expire_all()

    remaining = {
        row.id
        for row in (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id)
                )
            )
        ).scalars()
    }
    assert deleted == 1
    assert his in remaining, "his hand-drawn tie must survive its own crossing"
    assert machine not in remaining


async def _draw_tie(
    async_client: AsyncClient,
    scene: dict,
    geotech_model_id: str,
    band_a: LithoLayerOrm,
    band_b: LithoLayerOrm,
) -> tuple[int, str]:
    """Draw a packing tie the way the engineer's gesture does, via the API."""
    resp = await async_client.post(
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": str(band_a.id),
            "layer_b_id": str(band_b.id),
            "layer_a_side": "top",
            "layer_b_side": "top",
            "source": "manual",
            "request_section_id": str(scene["section_id"]),
        },
    )
    return resp.status_code, resp.text


@pytest.mark.asyncio
async def test_xgdb5_drawing_a_crossing_tie_is_refused_with_a_readable_reason(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """XG-DB5: owner ruling — *"send a toast and reject the tie"*.

    A crossing is a hard conflict: the renderer suspends BOTH ties and neither
    side bands, so letting the gesture land means silently killing the fill on
    that gap.  Refusing at the write is the only place the engineer finds out
    while he still has the gesture in mind.

    The message must name what he can SEE.  His words on the existing warning:
    *"i can't rule, unclear for me which tests, don't see gap numbers in the
    app"* — so the refusal names the two columns and the depths, never a
    database id.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    a_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_b_id"])

    landed, _ = await _draw_tie(
        async_client, crossing_scene, geotech_model_id, a_bands[0], b_bands[-1]
    )
    assert landed == 201, "the first tie has nothing to cross"

    refused, detail = await _draw_tie(
        async_client, crossing_scene, geotech_model_id, a_bands[-1], b_bands[0]
    )
    assert refused == 422, f"a crossing tie must be refused, got {refused}: {detail}"
    assert "cross" in detail.lower(), detail
    assert "CPT-A" in detail and "CPT-B" in detail, (
        f"the reason must name both columns, not database ids: {detail}"
    )
    assert str(a_bands[0].id) not in detail, f"no ids in a user-facing reason: {detail}"

    db_session.expire_all()
    stored = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(stored) == 1, "a refused gesture must write nothing"


@pytest.mark.asyncio
async def test_xgdb6_a_tie_that_crosses_nothing_still_lands(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """XG-DB6: negative control — the guard is not a blanket "refuse more".

    Two ties in the same gap that keep their order are the ordinary case, and
    they are how a band is stated at all.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    a_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_a_id"])
    b_bands = await _bands(db_session, geotech_model_id, crossing_scene["cpt_b_id"])

    first, _ = await _draw_tie(
        async_client, crossing_scene, geotech_model_id, a_bands[0], b_bands[0]
    )
    second, detail = await _draw_tie(
        async_client, crossing_scene, geotech_model_id, a_bands[1], b_bands[1]
    )
    assert first == 201
    assert second == 201, f"a monotone second tie must land: {detail}"


async def _delete_tie(
    async_client: AsyncClient,
    scene: dict,
    geotech_model_id: str,
    edge: LithoContactCorrelationEdgeOrm,
) -> None:
    """Delete a packing tie the way the engineer's gesture does, via the API."""
    resp = await async_client.request(
        "DELETE",
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/contact-correlations",
        json={
            "layer_a_id": str(edge.layer_a_id),
            "layer_b_id": str(edge.layer_b_id),
            "layer_a_side": edge.layer_a_side,
            "layer_b_side": edge.layer_b_side,
            "request_section_id": str(edge.section_id),
        },
    )
    assert resp.status_code == 204, resp.text


async def _all_edges(
    db_session: AsyncSession, geotech_model_id: str
) -> list[LithoContactCorrelationEdgeOrm]:
    return list(
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id)
                )
            )
        ).scalars()
    )


@pytest.mark.asyncio
async def test_ts1_a_deleted_tie_stays_deleted_across_a_reautocorrelate(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """TS1 — owner ruling 2026-08-17: *"A tie i delete stays deleted"*.

    The full loop he actually lives: step 2 derives ties, he deletes one, he
    presses step 2 again.  Before the tombstone every press re-stated the
    deleted tie from the litho model — the machine arguing with his judgement
    forever.  The deletion is remembered by PLACE (*"just do position xyz left
    and xyz right and the section it was on"*), because step 1 and step 4
    rebuild every band and ids cannot carry the memory.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    await _auto_correlate(async_client, crossing_scene, geotech_model_id)
    db_session.expire_all()
    before = await _all_edges(db_session, geotech_model_id)
    assert before, "the scene must derive at least one tie to delete"
    victim = before[0]
    victim_pair = frozenset((victim.layer_a_id, victim.layer_b_id))

    await _delete_tie(async_client, crossing_scene, geotech_model_id, victim)

    await _auto_correlate(async_client, crossing_scene, geotech_model_id)
    db_session.expire_all()
    after = {
        frozenset((e.layer_a_id, e.layer_b_id))
        for e in await _all_edges(db_session, geotech_model_id)
    }
    assert victim_pair not in after, (
        "the deleted tie came back — the tombstone is not being consulted"
    )


@pytest.mark.asyncio
async def test_ts2_without_a_deletion_the_second_press_keeps_the_tie(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """TS2 — negative control: TS1 fails for the RIGHT reason.

    A second press on an untouched model keeps every tie, so TS1's absence can
    only come from the tombstone, not from step 2 being non-repeatable.
    """
    geotech_model_id = await _subdivide_cpts(async_client, crossing_scene)
    await _auto_correlate(async_client, crossing_scene, geotech_model_id)
    db_session.expire_all()
    before = {
        frozenset((e.layer_a_id, e.layer_b_id))
        for e in await _all_edges(db_session, geotech_model_id)
    }

    await _auto_correlate(async_client, crossing_scene, geotech_model_id)
    db_session.expire_all()
    after = {
        frozenset((e.layer_a_id, e.layer_b_id))
        for e in await _all_edges(db_session, geotech_model_id)
    }
    assert before <= after and before


@pytest.mark.asyncio
async def test_ts3_a_litho_tie_deletion_writes_no_tombstone(
    crossing_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """TS3 — *"but does not delete on the litho model"*, and the converse.

    The tombstone records geotech judgement only.  A litho correlation the
    engineer removes is already its own statement — the derivation simply
    stops restating it — so recording it would be dead weight at best and a
    future false suppression at worst.
    """
    from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import (
        GeotechTieTombstoneOrm,
    )

    litho_edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id
                    == UUID(crossing_scene["litho_model_id"])
                )
            )
        )
        .scalars()
        .all()
    )
    assert litho_edges, "the scene correlates the litho pair in its fixture"
    await _delete_tie(
        async_client, crossing_scene, crossing_scene["litho_model_id"], litho_edges[0]
    )
    db_session.expire_all()
    stones = (await db_session.execute(select(GeotechTieTombstoneOrm))).scalars().all()
    assert stones == []
