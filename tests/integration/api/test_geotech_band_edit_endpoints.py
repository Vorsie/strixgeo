"""GB — the first DB-level coverage of the geotech band-edit routes.

Until now every claim about the four shipped routes' database behaviour
(the LL→FC mirror trigger firing on geotech rows, the contiguity trigger
passing at commit, the formation find-or-create, the edge FK cascade) was
reasoned from migration SQL, never exercised. This suite runs the REAL
endpoints against the real Postgres and pins those invariants — plus the new
verbs (move, N-run merge), flag-not-drop, and the statistic selector.

Scene: CPT-A — BH-S — CPT-B on one section, one accepted ZAND litho layer
0–8 m per column, correlated only THROUGH the borehole (the pipeline_scene
recipe). CPT-A reads a LOW top zone (4 MPa) over dicht (18 MPa) with the
transition at 4.0 m, so a merged/moved interval spanning the transition gives
the statistic selector something to disagree about; CPT-B transitions at
5.0 m.

Run via ``scripts\\run-integration-tests.ps1`` ONLY (the conftest guard
refuses any non-integration DATABASE_URL).
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
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
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
    two_layer_qc,
)


@pytest_asyncio.fixture
async def band_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """CPT — borehole — CPT, litho'd and correlated through the borehole.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``section_id``, ``bh_id``,
        ``cpt_a_id``, ``cpt_b_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech band-edit test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GB-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GB-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_resp.json()["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "GB-Section",
            "start_x": 148_700.0,
            "start_y": 201_000.0,
            "end_x": 149_900.0,
            "end_y": 201_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    section_id = sec_resp.json()["id"]

    # Both CPTs read LOW (4 MPa) over dicht (18 MPa) — the same class pair, so a
    # tie between the two upper bands MATCHES. A's transition sits at 3.0 m and
    # its dense zone is the LONGER one (150/250): dragging A's boundary down to
    # 6.5 m floods the upper band with dense material until the dense samples
    # outnumber the loose ones and the MEDIAN flips — the class-breaking move
    # GB6/GB7 pin. (With equal zone lengths no single move can ever flip a
    # median — the majority never crosses.) The 4-vs-18 spread also makes the
    # harmonic and median representatives land in different classes over the
    # union, which GB18 needs.
    depths_a, qc_a = two_layer_qc(n_top=150, n_bot=250, qc_top=4.0, qc_bot=18.0)
    depths_b, qc_b = two_layer_qc(n_top=250, n_bot=150, qc_top=4.0, qc_bot=18.0)

    def _cpt(name: str, x: float, depths: list[float], qc: list[float]) -> CptOrm:
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="GB",
            test_id=f"GB/{name}",
            app_project_id=proj.id,
            location_x=x,
            location_y=201_000.0,
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
        project_id="GB",
        test_id="GB/BH-S",
        location_x=149_300.0,
        location_y=201_000.0,
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

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "bh_id": bh.id,
        "cpt_a_id": cpt_a.id,
        "cpt_b_id": cpt_b.id,
    }


# ---------------------------------------------------------------------------
# Small drivers
# ---------------------------------------------------------------------------


async def _subdivide(client: AsyncClient, scene: dict) -> str:
    """Run step 1 and return the geotech model id."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _bands_on(db_session: AsyncSession, geotech_model_id: str, cpt_id) -> list[LithoLayerOrm]:
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


async def _bands_on_borehole(
    db_session: AsyncSession, geotech_model_id: str, borehole_id
) -> list[LithoLayerOrm]:
    """The borehole's geotech bands, top to bottom."""
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == UUID(geotech_model_id),
                    LithoLayerOrm.borehole_id == borehole_id,
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _band_url(scene: dict, geotech_model_id: str, tail: str) -> str:
    return f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/bands/{tail}"


async def _insert_edge(
    db_session: AsyncSession,
    scene: dict,
    geotech_model_id: str,
    layer_a,
    layer_b,
    *,
    approved: bool,
    review_reason: str | None = None,
) -> UUID:
    """Insert one packing tie directly, returning its id."""
    lo, hi = (layer_a, layer_b) if layer_a < layer_b else (layer_b, layer_a)
    edge_id = uuid7()
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=edge_id,
            model_id=UUID(geotech_model_id),
            section_id=UUID(str(scene["section_id"])),
            layer_a_id=lo,
            layer_b_id=hi,
            layer_a_side="top",
            layer_b_side="top",
            user_approved=approved,
            review_reason=review_reason,
            source="auto",
        )
    )
    await db_session.commit()
    return edge_id


# ---------------------------------------------------------------------------
# GB1–GB4 — the shipped routes' DB invariants, exercised at last
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gb1_split_writes_two_contiguous_rows_and_the_fc_mirror(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB1 — a split lands two contiguous rows; the LL→FC trigger mirrors the new one."""
    gid = await _subdivide(async_client, band_scene)
    bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    target = bands[0]
    # The subdivided band carries the covering litho band it was minted from
    # (Parameters body-tree A3). Capture it before the split expires the row.
    target_parent = target.parent_litho_layer_id
    assert target_parent is not None, (
        "GB1: a subdivided CPT band must carry its covering litho band (A3 stamp)"
    )

    resp = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": str(target.id), "split_depth_m": 2.0},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    created = UUID(payload["created_layer_ids"][0])

    db_session.expire_all()
    after = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert [round(b.depth_top_m, 3) for b in after[:2]] == [0.0, 2.0]
    assert after[0].depth_base_m == after[1].depth_top_m == 2.0
    # GB1 (parent-band FK, A3): both halves stay inside the original band's litho
    # parent (the split is refused outside it), so both keep the SAME covering
    # litho band — the resized upper (original row) and the new lower row.
    assert after[0].parent_litho_layer_id == target_parent
    assert after[1].parent_litho_layer_id == target_parent
    assert after[1].id == created, "the lower half is the newly created row"
    # The mirror trigger fired on the geotech row (kind-unscoped by design).
    mirror = await db_session.get(FormationContactOrm, created)
    assert mirror is not None
    assert round(mirror.depth_top_m, 3) == 2.0


@pytest.mark.asyncio
async def test_gb2_split_outside_the_litho_body_writes_nothing(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB2 — a hierarchy breach is a 422 and the column is untouched (atomicity)."""
    gid = await _subdivide(async_client, band_scene)
    bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    before = [(b.id, b.depth_top_m, b.depth_base_m) for b in bands]

    resp = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": str(bands[0].id), "split_depth_m": 9.0},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "geotech_band_edit_rejected"

    db_session.expire_all()
    after = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert [(b.id, b.depth_top_m, b.depth_base_m) for b in after] == before


@pytest.mark.asyncio
async def test_gb3_merge_extends_the_survivor_and_removes_the_absorbed_mirror(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB3 — the survivor spans the union; the absorbed row AND its FC mirror are gone."""
    gid = await _subdivide(async_client, band_scene)
    bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    upper, lower = bands[0], bands[1]
    absorbed_id = lower.id

    resp = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"upper_band_id": str(upper.id), "lower_band_id": str(lower.id)},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    after = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert len(after) == 1
    assert after[0].id == upper.id  # the SHALLOWEST row survives
    assert round(after[0].depth_base_m, 3) == 8.0
    assert after[0].source == "manual"
    assert await db_session.get(LithoLayerOrm, absorbed_id) is None
    assert await db_session.get(FormationContactOrm, absorbed_id) is None


@pytest.mark.asyncio
async def test_gb4_a_class_that_already_has_a_formation_reuses_it(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB4 — find-or-create: a split into two same-class halves creates NO formation."""
    gid = await _subdivide(async_client, band_scene)
    bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])

    async def _nad_formation_count() -> int:
        # Formations are PROJECT-scoped; the geotech units are the rows carrying
        # a nad_class, so that is the pool find-or-create draws from.
        rows = (
            await db_session.execute(
                select(GeologicalFormationOrm.id).where(
                    GeologicalFormationOrm.app_project_id == UUID(band_scene["project_id"]),
                    GeologicalFormationOrm.nad_class.is_not(None),
                )
            )
        ).all()
        return len(rows)

    count_before = await _nad_formation_count()
    resp = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": str(bands[0].id), "split_depth_m": 2.0},
    )
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    assert await _nad_formation_count() == count_before


# ---------------------------------------------------------------------------
# GB5–GB7 — flag-not-drop + the accepted-tie transfer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gb5_the_absorbed_bands_accepted_tie_transfers_to_the_survivor(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB5 — accepted work survives the absorb: re-pointed + flagged, never cascaded."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    b_bands = await _bands_on(db_session, gid, band_scene["cpt_b_id"])
    # Plain UUID snapshots — the ORM instances expire after the write, and an
    # attribute read on an expired instance is sync I/O (MissingGreenlet).
    a_upper_id, a_lower_id = a_bands[0].id, a_bands[1].id
    # The tie sits on the row the merge will DELETE (A's lower band).
    accepted = await _insert_edge(
        db_session, band_scene, gid, a_lower_id, b_bands[0].id, approved=True
    )
    pending = await _insert_edge(
        db_session, band_scene, gid, a_lower_id, b_bands[1].id, approved=False
    )

    resp = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"upper_band_id": str(a_upper_id), "lower_band_id": str(a_lower_id)},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    db_session.expire_all()
    edge = await db_session.get(LithoContactCorrelationEdgeOrm, accepted)
    assert edge is not None, "the accepted tie must survive the absorb"
    assert a_upper_id in (edge.layer_a_id, edge.layer_b_id)  # re-pointed
    assert edge.review_reason is not None  # flagged for the engineer
    assert str(accepted) in payload["flagged_edge_ids"]
    # The pending claim went with the row (machine may withdraw it).
    assert await db_session.get(LithoContactCorrelationEdgeOrm, pending) is None


@pytest.mark.asyncio
async def test_gb6_a_class_breaking_move_flags_the_accepted_tie_and_drops_the_pending(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB6 — flag-not-drop on a mismatch: accepted survives flagged, pending goes."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    b_bands = await _bands_on(db_session, gid, band_scene["cpt_b_id"])
    # Accepted: A-upper ↔ B-upper — both LOW, a MATCHED tie (its break is the
    # move's doing). Pending: A-LOWER ↔ B-upper — a machine claim on one of the
    # rows the move re-derives, mismatched once judged.
    accepted = await _insert_edge(
        db_session, band_scene, gid, a_bands[0].id, b_bands[0].id, approved=True
    )
    pending = await _insert_edge(
        db_session, band_scene, gid, a_bands[1].id, b_bands[0].id, approved=False
    )

    # Moving A's boundary from 3.0 to 6.5 m floods the upper band with dicht
    # material until the dense samples hold the majority — the re-derived
    # median flips the class and breaks the accepted tie's match.
    resp = await async_client.post(
        _band_url(band_scene, gid, "move"),
        json={
            "upper_band_id": str(a_bands[0].id),
            "lower_band_id": str(a_bands[1].id),
            "new_depth_m": 6.5,
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    db_session.expire_all()
    edge = await db_session.get(LithoContactCorrelationEdgeOrm, accepted)
    assert edge is not None
    assert edge.review_reason == "class_changed"
    assert str(accepted) in payload["flagged_edge_ids"]
    assert await db_session.get(LithoContactCorrelationEdgeOrm, pending) is None
    assert str(pending) in payload["deleted_edge_ids"]


@pytest.mark.asyncio
async def test_gb7_moving_back_self_heals_the_flag(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB7 — drag away then drag back is a true no-op: the flag clears itself."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    b_bands = await _bands_on(db_session, gid, band_scene["cpt_b_id"])
    accepted = await _insert_edge(
        db_session, band_scene, gid, a_bands[0].id, b_bands[0].id, approved=True
    )
    move_url = _band_url(band_scene, gid, "move")
    body = {
        "upper_band_id": str(a_bands[0].id),
        "lower_band_id": str(a_bands[1].id),
    }
    away = await async_client.post(move_url, json={**body, "new_depth_m": 6.5})
    assert away.status_code == 200, away.text
    back = await async_client.post(move_url, json={**body, "new_depth_m": 3.0})
    assert back.status_code == 200, back.text
    payload = back.json()

    db_session.expire_all()
    edge = await db_session.get(LithoContactCorrelationEdgeOrm, accepted)
    assert edge is not None
    assert edge.review_reason is None
    assert str(accepted) in payload["cleared_edge_ids"]


# ---------------------------------------------------------------------------
# GB8–GB9 — the refusals and the locality invariant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gb8_the_qc_only_borehole_verbs_still_refuse_a_borehole_band(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB8 — the verbs that NEED qc still name the cause and refuse on a borehole.

    Owner #35 amended ruling A: a borehole band can be SPLIT (halves keep the
    class) and MERGED (union keeps the survivor's class) — those two are covered
    by GB17/GB18. What still has no meaning on a qc-less column is a PREVIEW of a
    re-derivation (there is no re-derivation to preview) and a MOVE (both bands
    would re-derive from qc that is not there). Those four refuse, naming the
    borehole.
    """
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)
    band = rows[0][0]
    partner = rows[1][0] if len(rows) > 1 else band

    cases = [
        ("preview-split", {"band_id": band, "split_depth_m": 1.0}),
        ("preview-merge", {"upper_band_id": band, "lower_band_id": partner}),
        ("preview-move", {"upper_band_id": band, "lower_band_id": partner, "new_depth_m": 1.0}),
        ("move", {"upper_band_id": band, "lower_band_id": partner, "new_depth_m": 1.0}),
    ]
    for tail, body in cases:
        resp = await async_client.post(_band_url(band_scene, gid, tail), json=body)
        assert resp.status_code == 422, f"{tail}: {resp.status_code} {resp.text}"
        assert "borehole" in resp.json()["detail"]["message"].lower(), tail


@pytest.mark.asyncio
async def test_gb17_split_band_here_is_offered_on_a_borehole_band_too(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB17 — owner #35: "split band here" works on a borehole band, class kept.

    A borehole has no qc, so a split cannot re-derive the halves — it KEEPS the
    original band's class on both. The commit succeeds (no 422), both halves point
    at the original class, and only the source is stamped manual (the boundary is
    the engineer's; the class is not).
    """
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)
    band_id, top, base = rows[0]
    # Learn the band's current class so the "keep" claim can be checked against it.
    before = await db_session.get(LithoLayerOrm, UUID(band_id))
    assert before is not None
    original_formation = await db_session.get(GeologicalFormationOrm, before.formation_id)
    assert original_formation is not None
    original_class = original_formation.nad_class

    mid = round((top + base) / 2, 3)
    resp = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": band_id, "split_depth_m": mid},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    halves = await _bands_on_borehole(db_session, gid, band_scene["bh_id"])
    upper = next(r for r in halves if abs(r.depth_top_m - top) < 1e-6)
    lower = next(r for r in halves if abs(r.depth_top_m - mid) < 1e-6)
    for half in (upper, lower):
        formation = await db_session.get(GeologicalFormationOrm, half.formation_id)
        assert formation is not None
        assert formation.nad_class == original_class, "both halves KEEP the original class"
        assert half.source == "manual", "only the boundary is the engineer's, so only source moves"
    assert abs(lower.depth_base_m - base) < 1e-6, "the split spans the original band exactly"


@pytest.mark.asyncio
async def test_gb18_a_borehole_split_undoes_by_re_merging_keeping_the_class(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB18 — ctrl+z after a borehole split re-merges the two halves, class kept.

    A borehole merge has no qc to re-derive from, so the union takes the SURVIVOR
    (upper) band's class. On the split-undo the two halves share the class, so the
    survivor's class IS the original — the split is reversible.
    """
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)
    band_id, top, base = rows[0]
    before = await db_session.get(LithoLayerOrm, UUID(band_id))
    assert before is not None
    original_formation = await db_session.get(GeologicalFormationOrm, before.formation_id)
    assert original_formation is not None
    original_class = original_formation.nad_class

    mid = round((top + base) / 2, 3)
    split = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": band_id, "split_depth_m": mid},
    )
    assert split.status_code == 200, split.text
    lower_id = split.json()["created_layer_ids"][0]

    merge = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"upper_band_id": band_id, "lower_band_id": lower_id},
    )
    assert merge.status_code == 200, merge.text

    db_session.expire_all()
    survivor = await db_session.get(LithoLayerOrm, UUID(band_id))
    assert survivor is not None
    formation = await db_session.get(GeologicalFormationOrm, survivor.formation_id)
    assert formation is not None
    assert formation.nad_class == original_class, "the re-merged band keeps the original class"
    assert abs(survivor.depth_top_m - top) < 1e-6 and abs(survivor.depth_base_m - base) < 1e-6


@pytest.mark.asyncio
async def test_sr1_a_restore_split_assigns_the_given_classes_ignoring_qc(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SR1 — the restore split ASSIGNS the halves' classes + sources verbatim.

    The merge undo (owner #35) restores the two pre-merge bands rather than
    re-deriving them. A restore split therefore never reads qc: it points each
    half at the class it is handed and stamps the source it is handed — which is
    how the ordinary path (source forced to ``manual`` on both) is told apart
    from a restore that carries a ``segmenter`` provenance back.
    """
    gid = await _subdivide(async_client, band_scene)
    cpt_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert cpt_bands, "subdivide must have produced CPT bands"
    target = max(cpt_bands, key=lambda r: r.depth_base_m - r.depth_top_m)
    mid = round((target.depth_top_m + target.depth_base_m) / 2, 3)

    resp = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={
            "band_id": str(target.id),
            "split_depth_m": mid,
            "restore": True,
            "restore_upper_nad_class": 5,
            "restore_lower_nad_class": 8,
            "restore_upper_source": "segmenter",
            "restore_lower_source": "manual",
        },
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    halves = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    upper = next(r for r in halves if abs(r.depth_top_m - target.depth_top_m) < 1e-6)
    lower = next(r for r in halves if abs(r.depth_top_m - mid) < 1e-6)
    upper_formation = await db_session.get(GeologicalFormationOrm, upper.formation_id)
    lower_formation = await db_session.get(GeologicalFormationOrm, lower.formation_id)
    assert upper_formation is not None and lower_formation is not None
    assert upper_formation.nad_class == 5, "the upper half took the class it was handed"
    assert lower_formation.nad_class == 8, "the lower half took the class it was handed"
    assert upper.source == "segmenter", "the restore carried the source back, not forced manual"
    assert lower.source == "manual"


@pytest.mark.asyncio
async def test_mu1_ctrl_z_after_a_merge_brings_back_both_bands_as_they_were(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """MU1 — the merge response carries each pre-merge band, and a restore split
    with them reproduces the two bands exactly (owner #35).

    This is the backend half of ctrl+z after a merge: the merge captures the
    survivor's + absorbed band's class and source; the undo re-splits at the
    carried boundary and restores them, so nothing is lost to a re-derivation.
    """
    gid = await _subdivide(async_client, band_scene)
    cpt_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    target = max(cpt_bands, key=lambda r: r.depth_base_m - r.depth_top_m)
    # Read every scalar NOW: ``_class_of`` below expires the whole session and an
    # expired ORM attribute reloads lazily, which the async session cannot do
    # outside a greenlet (MissingGreenlet at the merge call otherwise).
    target_id = str(target.id)
    top, base = target.depth_top_m, target.depth_base_m
    mid = round((top + base) / 2, 3)

    # Make a pair inside one litho unit: split the thickest band down the middle.
    split = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": target_id, "split_depth_m": mid},
    )
    assert split.status_code == 200, split.text
    lower_id = split.json()["created_layer_ids"][0]

    async def _class_of(layer_id: str) -> int | None:
        db_session.expire_all()
        row = await db_session.get(LithoLayerOrm, UUID(layer_id))
        assert row is not None
        formation = await db_session.get(GeologicalFormationOrm, row.formation_id)
        assert formation is not None
        return formation.nad_class

    upper_class_before = await _class_of(target_id)
    lower_class_before = await _class_of(lower_id)

    merge = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"upper_band_id": target_id, "lower_band_id": lower_id},
    )
    assert merge.status_code == 200, merge.text
    payload = merge.json()
    # The merge REMEMBERS both pre-merge bands, so the undo need not re-derive.
    assert payload["pre_merge_upper_nad_class"] == upper_class_before
    assert payload["pre_merge_lower_nad_class"] == lower_class_before
    assert payload["pre_merge_upper_source"] == "manual"
    assert payload["pre_merge_lower_source"] == "manual"

    # The undo: re-split at the carried boundary, restoring each half.
    undo = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={
            "band_id": target_id,
            "split_depth_m": mid,
            "restore": True,
            "restore_upper_nad_class": payload["pre_merge_upper_nad_class"],
            "restore_lower_nad_class": payload["pre_merge_lower_nad_class"],
            "restore_upper_source": payload["pre_merge_upper_source"],
            "restore_lower_source": payload["pre_merge_lower_source"],
        },
    )
    assert undo.status_code == 200, undo.text
    restored_lower_id = undo.json()["created_layer_ids"][0]
    assert await _class_of(target_id) == upper_class_before, "the upper band is back"
    assert await _class_of(restored_lower_id) == lower_class_before, "the lower band is back"


@pytest.mark.asyncio
async def test_gb9_a_move_touches_no_other_column_and_no_litho_row(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB9 — ruling 4 at the database: recalculation is local."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])

    async def _snapshot() -> list[tuple]:
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm)
                    .where(LithoLayerOrm.cpt_id == band_scene["cpt_b_id"])
                    .order_by(LithoLayerOrm.model_id, LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .all()
        )
        litho = (
            (
                await db_session.execute(
                    select(LithoLayerOrm)
                    .where(LithoLayerOrm.model_id == UUID(band_scene["litho_model_id"]))
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            )
            .scalars()
            .all()
        )
        return [(r.id, r.depth_top_m, r.depth_base_m, r.formation_id) for r in rows + litho]

    before = await _snapshot()
    resp = await async_client.post(
        _band_url(band_scene, gid, "move"),
        json={
            "upper_band_id": str(a_bands[0].id),
            "lower_band_id": str(a_bands[1].id),
            "new_depth_m": 4.5,
        },
    )
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    assert await _snapshot() == before


# ---------------------------------------------------------------------------
# GB10–GB16 — the new verbs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gb10_move_is_an_atomic_two_row_write_with_manual_provenance(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB10 — one boundary, two rows, both the engineer's; the FC mirror follows."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    upper, lower = a_bands[0], a_bands[1]

    resp = await async_client.post(
        _band_url(band_scene, gid, "move"),
        json={
            "upper_band_id": str(upper.id),
            "lower_band_id": str(lower.id),
            "new_depth_m": 4.5,
        },
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    after = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert after[0].depth_base_m == after[1].depth_top_m == 4.5
    assert after[0].source == "manual" and after[1].source == "manual"
    mirror = await db_session.get(FormationContactOrm, lower.id)
    assert mirror is not None and round(mirror.depth_top_m, 3) == 4.5


@pytest.mark.asyncio
async def test_gb11_move_refusals_name_the_squeeze_gesture(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB11 — outside the pair and sub-millimetre survivors refuse with guidance."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    body = {
        "upper_band_id": str(a_bands[0].id),
        "lower_band_id": str(a_bands[1].id),
    }
    outside = await async_client.post(
        _band_url(band_scene, gid, "move"), json={**body, "new_depth_m": 9.5}
    )
    assert outside.status_code == 422
    assert "merge" in outside.json()["detail"]["message"].lower()
    hairline = await async_client.post(
        _band_url(band_scene, gid, "move"), json={**body, "new_depth_m": 0.0004}
    )
    assert hairline.status_code == 422


@pytest.mark.asyncio
async def test_gb15_the_preview_and_the_commit_tell_one_story(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB15 — preview-move's plan is byte-equal to the committed move's plan."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    body = {
        "upper_band_id": str(a_bands[0].id),
        "lower_band_id": str(a_bands[1].id),
        "new_depth_m": 4.5,
    }
    preview = await async_client.post(_band_url(band_scene, gid, "preview-move"), json=body)
    assert preview.status_code == 200, preview.text
    commit = await async_client.post(_band_url(band_scene, gid, "move"), json=body)
    assert commit.status_code == 200, commit.text
    assert commit.json()["plan"]["intervals"] == preview.json()["intervals"]


@pytest.mark.asyncio
async def test_gb16_an_n_band_run_unions_in_one_transaction(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB16 — band_ids=[a,b,c] → one surviving row; a gapped run refuses."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    split = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": str(a_bands[0].id), "split_depth_m": 2.0},
    )
    assert split.status_code == 200, split.text
    db_session.expire_all()
    three = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert len(three) == 3

    gapped = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"band_ids": [str(three[0].id), str(three[2].id)]},
    )
    assert gapped.status_code == 422

    run = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"band_ids": [str(b.id) for b in three]},
    )
    assert run.status_code == 200, run.text
    db_session.expire_all()
    after = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert len(after) == 1
    assert (round(after[0].depth_top_m, 3), round(after[0].depth_base_m, 3)) == (0.0, 8.0)


# ---------------------------------------------------------------------------
# GB17–GB19 — the statistic selector, threaded end to end
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gb17_the_statistic_change_stales_the_bands_and_rederives_nothing(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB17 — one column written; bands untouched; the rebuild stamps + clears."""
    gid = await _subdivide(async_client, band_scene)
    bands_before = [
        (b.id, b.depth_top_m, b.depth_base_m, b.formation_id)
        for b in await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    ]

    stat_url = f"/projects/{band_scene['project_id']}/geology/models/{gid}/geotech/statistic"
    resp = await async_client.post(stat_url, json={"statistic": "harmonic"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "representative_statistic": "harmonic",
        "classified_with_statistic": "median",
        "bands_stale": True,
    }

    db_session.expire_all()
    bands_after = [
        (b.id, b.depth_top_m, b.depth_base_m, b.formation_id)
        for b in await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    ]
    assert bands_after == bands_before  # ruling 8: never silently re-derives

    models = await async_client.get(f"/projects/{band_scene['project_id']}/geology/models")
    geotech = next(m for m in models.json() if m["id"] == gid)
    assert geotech["representative_statistic"] == "harmonic"

    # The rebuild classifies under the choice and stamps it — stale self-clears.
    await _subdivide(async_client, band_scene)
    models = await async_client.get(f"/projects/{band_scene['project_id']}/geology/models")
    geotech = next(m for m in models.json() if m["id"] == gid)
    assert geotech["classified_with_statistic"] == "harmonic"


@pytest.mark.asyncio
async def test_gb18_the_preview_reads_the_chosen_statistic(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB18 — ruling 6: harmonic set → the preview quotes harmonic numbers.

    CPT-A's union (4 MPa over 18 MPa) is where the statistics disagree: the
    harmonic representative sits below the median one, and on this series the
    class comes out LOWER (more conservative).
    """
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    body = {
        "upper_band_id": str(a_bands[0].id),
        "lower_band_id": str(a_bands[1].id),
    }
    url = _band_url(band_scene, gid, "preview-merge")
    stat_url = f"/projects/{band_scene['project_id']}/geology/models/{gid}/geotech/statistic"

    median_plan = (await async_client.post(url, json=body)).json()
    assert median_plan["statistic"] == "median"

    assert (await async_client.post(stat_url, json={"statistic": "harmonic"})).status_code == 200
    harmonic_plan = (await async_client.post(url, json=body)).json()
    assert harmonic_plan["statistic"] == "harmonic"

    m_interval, h_interval = median_plan["intervals"][0], harmonic_plan["intervals"][0]
    assert h_interval["representative_qc_mpa"] < m_interval["representative_qc_mpa"]
    assert h_interval["nad_class"] < m_interval["nad_class"]


@pytest.mark.asyncio
async def test_gb19_the_litho_model_is_refused_by_the_kind_guard(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB19 — bands/move and geotech/statistic 422 on a lithostratigraphic model."""
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    lid = band_scene["litho_model_id"]

    move = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{lid}/geotech/bands/move",
        json={
            "upper_band_id": str(a_bands[0].id),
            "lower_band_id": str(a_bands[1].id),
            "new_depth_m": 4.5,
        },
    )
    assert move.status_code == 422

    stat = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{lid}/geotech/statistic",
        json={"statistic": "harmonic"},
    )
    assert stat.status_code == 422


@pytest.mark.asyncio
async def test_gb20_a_flagged_tie_stops_unioning_the_two_bands_into_one_body(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB20 — a tie under review no longer joins its two bands into one body.

    Owner ruling 2026-08-10, on his own data: a hand edit had left one body
    spanning NAD 8 and NAD 7, and pressing Build there would have welded a very
    dense sand to a dense sand across the gap and exported it. A body's contract
    is one packing class, so a shape that breaks it must not survive on the
    strength of a correlation the engineer has been asked to re-judge.

    The flag itself is unchanged — the tie is still kept, still self-heals, and
    still shows its violet badge. Only its effect on the model is suspended while
    it waits.

    The control move exists because "the two bands do not share a body" passes
    trivially if they never shared one. It runs the resolver with the tie in place
    and matching, which is the state the ruling changes.
    """
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    b_bands = await _bands_on(db_session, gid, band_scene["cpt_b_id"])
    # Held as plain values: ``expire_all`` below detaches every loaded attribute, and
    # reading one back would lazy-load from inside the assertion.
    a_top_id, a_low_id, b_top_id = a_bands[0].id, a_bands[1].id, b_bands[0].id
    boundary_m = a_bands[0].depth_base_m
    accepted = await _insert_edge(db_session, band_scene, gid, a_top_id, b_top_id, approved=True)
    move_url = _band_url(band_scene, gid, "move")
    pair = {"upper_band_id": str(a_top_id), "lower_band_id": str(a_low_id)}

    # Control: a nudge too small to change either class, so the tie still matches.
    resp = await async_client.post(
        move_url, json={**pair, "new_depth_m": round(boundary_m + 0.2, 3)}
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    edge = await db_session.get(LithoContactCorrelationEdgeOrm, accepted)
    assert edge is not None
    assert edge.review_reason is None, "the control move was supposed to keep the classes"
    a_top = await db_session.get(LithoLayerOrm, a_top_id)
    b_top = await db_session.get(LithoLayerOrm, b_top_id)
    assert a_top is not None and b_top is not None
    assert a_top.body_id is not None
    assert a_top.body_id == b_top.body_id, "an accepted, matching tie unions its bands"

    # GB6's class-breaking move: the tie survives, flagged.
    resp = await async_client.post(move_url, json={**pair, "new_depth_m": 6.5})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    edge = await db_session.get(LithoContactCorrelationEdgeOrm, accepted)
    assert edge is not None
    assert edge.review_reason == "class_changed"
    a_top = await db_session.get(LithoLayerOrm, a_top_id)
    b_top = await db_session.get(LithoLayerOrm, b_top_id)
    assert a_top is not None and b_top is not None
    assert a_top.body_id != b_top.body_id, "a flagged tie must not hold the body together"


@pytest.mark.asyncio
async def test_gb21_undoing_a_merge_gives_both_original_classes_back(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB21 — merge two differently-classed bands, split back, get both classes back.

    The owner, dogfeeding: *"when i merge a dense and very dense sand, and then ctrl z,
    I get 2 dense sands not the original dense and very dense sand"*.

    Undo of a merge is a split at the carried boundary, and a split re-derives each
    half from the qc over that half — so the two original classes should return by
    construction. This pins that at the level the undo command actually works on: the
    endpoints, against a real column, with classes that genuinely differ.
    """
    gid = await _subdivide(async_client, band_scene)
    bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    assert len(bands) >= 2, "the scene must give CPT-A at least two packing bands"
    upper_id, lower_id = bands[0].id, bands[1].id
    boundary_m = bands[0].depth_base_m

    upper_class = (await db_session.get(GeologicalFormationOrm, bands[0].formation_id)).nad_class
    lower_class = (await db_session.get(GeologicalFormationOrm, bands[1].formation_id)).nad_class
    # The whole point of the case: the two bands disagree about the packing class, so a
    # carried class and a re-derived one give different answers.
    assert upper_class != lower_class, "the fixture must give the two bands DIFFERENT classes"

    merged = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"upper_band_id": str(upper_id), "lower_band_id": str(lower_id)},
    )
    assert merged.status_code == 200, merged.text

    # This is what the undo command sends: split the survivor at the carried boundary.
    undone = await async_client.post(
        _band_url(band_scene, gid, "split"),
        json={"band_id": str(upper_id), "split_depth_m": boundary_m},
    )
    assert undone.status_code == 200, undone.text

    db_session.expire_all()
    after = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    restored_upper = next(b for b in after if b.id == upper_id)
    restored_lower = next(
        b for b in after if abs(b.depth_top_m - boundary_m) < 0.002 and b.id != upper_id
    )
    assert (
        await db_session.get(GeologicalFormationOrm, restored_upper.formation_id)
    ).nad_class == upper_class
    assert (
        await db_session.get(GeologicalFormationOrm, restored_lower.formation_id)
    ).nad_class == lower_class, "the deeper band came back with the wrong packing class"


@pytest.mark.asyncio
async def test_gb22_a_dropped_accepted_tie_is_named_as_accepted_on_the_wire(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB22 — ``deleted_accepted_edge_ids`` carries the accepted ties an absorb drops.

    The field was added in the 2026-08-08 review round so the toast could stop
    calling a deleted ACCEPTED tie a withdrawn pending proposal — and then no use
    case ever populated it (audit F10): it was defined, defaulted, wired through
    the router, and empty in every response, so every suite stayed green while the
    misreport it existed to prevent came back.

    The scene: an accepted tie between the two bands being merged. After the
    absorb it would connect the survivor to itself, so the transfer must DROP it —
    and the response must say an accepted tie went, not a pending one.
    """
    gid = await _subdivide(async_client, band_scene)
    bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    upper_id, lower_id = bands[0].id, bands[1].id
    self_loop_tie = await _insert_edge(
        db_session, band_scene, gid, upper_id, lower_id, approved=True
    )

    resp = await async_client.post(
        _band_url(band_scene, gid, "merge"),
        json={"upper_band_id": str(upper_id), "lower_band_id": str(lower_id)},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    assert str(self_loop_tie) in payload["deleted_edge_ids"]
    # The pin this test exists for: the ACCEPTED list is not empty on the wire.
    assert payload["deleted_accepted_edge_ids"] == [str(self_loop_tie)]


@pytest.mark.asyncio
async def test_gb23_a_band_absorbed_tie_still_unions_its_two_bands(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """GB23 — only a MISMATCH suspends the body union, not every review flag.

    The 2026-08-10 "split" ruling was made on a class-mismatch case: one body
    spanning NAD 8 and NAD 7 that a Build would have welded and exported. But a
    §4c merge stamps ``band_absorbed`` on every tie it re-anchors even when the
    survivor's class still MATCHES the partner — a correlation the design doc
    itself calls "still right" — and that flag never self-heals and is excluded
    from the keep-or-delete prompt. Suspending the union for it too meant every
    routine contact drag-merge silently and durably fragmented bodies (audit F31).

    So the rule is scoped to what the ruling was about: ``class_changed`` and
    ``ambiguous_band`` suspend (mismatched ends / doubtful anchor identity);
    ``band_absorbed`` keeps unioning. GB20 pins the class_changed half; this pins
    the band_absorbed half, and the ambiguous_band guard alongside it.
    """
    gid = await _subdivide(async_client, band_scene)
    a_bands = await _bands_on(db_session, gid, band_scene["cpt_a_id"])
    b_bands = await _bands_on(db_session, gid, band_scene["cpt_b_id"])
    # Held as plain values: ``expire_all`` below detaches every loaded attribute.
    a_top_id, a_low_id = a_bands[0].id, a_bands[1].id
    b_top_id, b_low_id = b_bands[0].id, b_bands[1].id
    boundary_m = a_bands[0].depth_base_m
    await _insert_edge(
        db_session,
        band_scene,
        gid,
        a_top_id,
        b_top_id,
        approved=True,
        review_reason="band_absorbed",
    )
    await _insert_edge(
        db_session,
        band_scene,
        gid,
        a_low_id,
        b_low_id,
        approved=True,
        review_reason="ambiguous_band",
    )

    # Any committed edit runs the resolver; the control nudge changes no class.
    resp = await async_client.post(
        _band_url(band_scene, gid, "move"),
        json={
            "upper_band_id": str(a_top_id),
            "lower_band_id": str(a_low_id),
            "new_depth_m": round(boundary_m + 0.2, 3),
        },
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    a_top = await db_session.get(LithoLayerOrm, a_top_id)
    b_top = await db_session.get(LithoLayerOrm, b_top_id)
    assert a_top is not None and b_top is not None
    assert a_top.body_id is not None
    # The pin: a still-matching correlation keeps doing its job while it waits.
    assert a_top.body_id == b_top.body_id, "a band_absorbed tie must keep unioning"
    a_low = await db_session.get(LithoLayerOrm, a_low_id)
    b_low = await db_session.get(LithoLayerOrm, b_low_id)
    assert a_low is not None and b_low is not None
    # And the doubt-flags still suspend: anchor identity in question, no union.
    assert a_low.body_id != b_low.body_id, "an ambiguous_band tie must NOT union"


async def _divided_borehole_bands(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> tuple[str, list[tuple[str, float, float]]]:
    """Run the pipeline through divide-boreholes; return (id, top, base) rows.

    Plain values, not ORM instances — the shared test session expires across
    the route calls, and a lazy refresh from a plain attribute read raises
    ``MissingGreenlet``.
    """
    gid = await _subdivide(async_client, band_scene)
    auto = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{gid}/geotech/auto-correlate",
        json={},
    )
    assert auto.status_code == 200, auto.text
    accept = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{gid}/contact-correlations/accept",
        json={},
    )
    assert accept.status_code == 200, accept.text
    divide = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )
    assert divide.status_code == 200, divide.text
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == UUID(gid),
                    LithoLayerOrm.borehole_id == band_scene["bh_id"],
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    assert rows, "divide-boreholes must have produced borehole bands"
    return gid, [(str(r.id), r.depth_top_m, r.depth_base_m) for r in rows]


@pytest.mark.asyncio
async def test_sc1_the_engineer_sets_a_borehole_bands_class_by_hand(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SC1 — owner ask 2026-08-18: a borehole band's class is the engineer's call.

    A borehole band's class is donor-extrapolated, not measured, so the
    engineer's own judgement outranks it — *"if the user edits TS11 he will
    notice and change it"*. Setting the class repoints the band to the target
    NAD formation and stamps manual provenance; geometry never moves.
    """
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)
    band_id, old_top, old_base = rows[0]

    resp = await async_client.post(
        _band_url(band_scene, gid, "set-class"),
        json={"band_id": band_id, "nad_class": 8},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["investigation_id"] == str(band_scene["bh_id"])

    db_session.expire_all()
    row = await db_session.get(LithoLayerOrm, UUID(band_id))
    assert row is not None
    formation = await db_session.get(GeologicalFormationOrm, row.formation_id)
    assert formation is not None
    assert formation.nad_class == 8, "the band must point at the chosen NAD class"
    assert row.source == "manual", "a hand class is the engineer's, and provenance must say so"
    assert (row.depth_top_m, row.depth_base_m) == (old_top, old_base), "geometry never moves"


@pytest.mark.asyncio
async def test_sc2_a_cpt_bands_class_is_measured_and_refuses_a_hand_class(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SC2 — a CPT band's class comes from its own qc; a hand class would falsify it."""
    gid = await _subdivide(async_client, band_scene)
    cpt_rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == UUID(gid),
                    LithoLayerOrm.cpt_id == band_scene["cpt_a_id"],
                )
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    assert cpt_rows, "subdivide must have produced CPT bands"

    resp = await async_client.post(
        _band_url(band_scene, gid, "set-class"),
        json={"band_id": str(cpt_rows[0].id), "nad_class": 8},
    )
    assert resp.status_code == 422, resp.text
    assert "measured" in resp.json()["detail"]["message"].lower()


@pytest.mark.asyncio
async def test_sc3_a_class_outside_the_bands_soil_family_is_refused(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SC3 — a ZAND band cannot take a CLAY class; the refusal names both."""
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)

    resp = await async_client.post(
        _band_url(band_scene, gid, "set-class"),
        json={"band_id": rows[0][0], "nad_class": 21},
    )
    assert resp.status_code == 422, resp.text
    message = resp.json()["detail"]["message"].lower()
    assert "21" in message and "zand" in message


@pytest.mark.asyncio
async def test_se1_a_second_subdivide_with_skip_keeps_existing_cpt_bands(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SE1 — owner ruling 2026-08-18: *"does this test already have a subdivision?
    if yes import and skip"* — no discrepancies on tie sections.

    A test subdivided once (usually before the tie section) must show the SAME
    bands on every later press: the second press imports the existing columns
    as-is and builds nothing over them. Identical row ids are the proof — a
    rebuild mints fresh uuid7s.
    """
    gid = await _subdivide(async_client, band_scene)

    async def cpt_row_ids() -> set[str]:
        db_session.expire_all()
        rows = (
            (
                await db_session.execute(
                    select(LithoLayerOrm.id).where(
                        LithoLayerOrm.model_id == UUID(gid),
                        LithoLayerOrm.cpt_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        return {str(r) for r in rows}

    before = await cpt_row_ids()
    assert before, "the first press must have built CPT bands"

    resp = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": band_scene["litho_model_id"], "skip_existing": True},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("skipped_existing_count", 0) > 0

    assert await cpt_row_ids() == before, "skip must keep the FIRST subdivision's rows"


@pytest.mark.asyncio
async def test_se2_without_skip_the_second_subdivide_still_rebuilds(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SE2 — negative control: the historic rebuild stays reachable (statistic
    re-runs and litho-change re-derives depend on it)."""
    gid = await _subdivide(async_client, band_scene)
    db_session.expire_all()
    before = {
        str(r)
        for r in (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id == UUID(gid),
                    LithoLayerOrm.cpt_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    }

    resp = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": band_scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    after = {
        str(r)
        for r in (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id == UUID(gid),
                    LithoLayerOrm.cpt_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    }
    assert after != before, "the default press is still the idempotent rebuild"


@pytest.mark.asyncio
async def test_se3_a_second_divide_with_skip_keeps_the_hand_classed_borehole(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SE3 — the divide half of the same ruling: an already-divided borehole is
    imported as-is, so a hand-set class survives the next section's press."""
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)
    band_id = rows[0][0]

    set_resp = await async_client.post(
        _band_url(band_scene, gid, "set-class"),
        json={"band_id": band_id, "nad_class": 8},
    )
    assert set_resp.status_code == 200, set_resp.text

    divide = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/divide-boreholes",
        json={"skip_existing": True},
    )
    assert divide.status_code == 200, divide.text
    assert divide.json().get("skipped_existing_borehole_count", 0) == 1

    db_session.expire_all()
    row = await db_session.get(LithoLayerOrm, UUID(band_id))
    assert row is not None, "the hand-classed band must survive the skipped divide"
    formation = await db_session.get(GeologicalFormationOrm, row.formation_id)
    assert formation is not None and formation.nad_class == 8, (
        "the hand class must survive — that is the whole point of the skip"
    )


@pytest.mark.asyncio
async def test_se4_a_machine_placed_borehole_is_replanned_not_skipped(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """SE4 — owner ruling 2026-08-23: *"you only decide how the boreholes get
    divided after user review"*.

    First-subdivision-wins protects the ENGINEER's work, not the machine's
    first guess. A borehole carrying only machine-placed bands must be
    RE-PLANNED on the next press, because the review that follows step 4 can
    otherwise never reach it: step 4 derives ties of its own AFTER placing its
    bands, so the first pass is planned against a thinner tie set than the one
    the engineer ends up approving.

    Measured on the dev model the day of the ruling: 1411-GEO-23/126-B8 was
    banded at 18:23:28 in the same run that wrote 145 ties, and kept one fat
    ``NAD 6`` band from 10.97 to 16.00 m where a re-plan against the finished
    tie set reads 6 / 5 / 7 / 6 / 8. A CPT-to-CPT span across it also survived,
    because a mid-band crossing has no contact to land on — one fat band, two
    visible defects.

    SE3 is the other half and must stay green: touch the borehole by hand and
    it is protected again. The predicate is ``source == 'manual'``, which every
    band-edit writer stamps (set-class, merge, split, move-boundary,
    move-restated-contact), so it is not specific to the set-class verb.
    """
    gid, _rows = await _divided_borehole_bands(band_scene, async_client, db_session)

    divide = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/divide-boreholes",
        json={"skip_existing": True},
    )
    assert divide.status_code == 200, divide.text
    assert divide.json().get("skipped_existing_borehole_count", 0) == 0, (
        "a borehole the engineer never touched must be re-planned, not "
        "imported as-is — otherwise pressing 4 again is a no-op forever"
    )
    # And it must still HAVE bands afterwards: re-planned, not merely deleted.
    db_session.expire_all()
    remaining = (
        (
            await db_session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.model_id == UUID(gid),
                    LithoLayerOrm.borehole_id == band_scene["bh_id"],
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(remaining) > 0, "the re-plan must leave the borehole banded"


@pytest.mark.asyncio
async def test_cl1_clear_subdivision_empties_one_column_and_only_that_column(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """CL1 — owner ask 2026-08-18: *"a per test clear subdivision just for
    utility, right click tests label and you can fire it"*.

    The clear is the escape hatch of first-subdivision-wins: wipe ONE test's
    bands (its ties cascade, no tombstones), then the next pipeline press
    rebuilds exactly that column. Every other column's rows stay untouched.
    """
    gid, _rows = await _divided_borehole_bands(band_scene, async_client, db_session)

    async def rows_of(inv_key: str) -> set[str]:
        db_session.expire_all()
        col = LithoLayerOrm.borehole_id if inv_key == "bh_id" else LithoLayerOrm.cpt_id
        return {
            str(r)
            for r in (
                await db_session.execute(
                    select(LithoLayerOrm.id).where(
                        LithoLayerOrm.model_id == UUID(gid),
                        col == band_scene[inv_key],
                    )
                )
            )
            .scalars()
            .all()
        }

    bh_before = await rows_of("bh_id")
    cpt_before = await rows_of("cpt_a_id")
    assert bh_before and cpt_before

    resp = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{gid}/geotech/columns/clear",
        json={"investigation_id": str(band_scene["bh_id"])},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted_band_count"] == len(bh_before)

    assert await rows_of("bh_id") == set(), "the cleared column must be empty"
    assert await rows_of("cpt_a_id") == cpt_before, "no other column may move"


@pytest.mark.asyncio
async def test_cl2_clear_then_skip_press_rebuilds_exactly_the_cleared_column(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """CL2 — the full utility loop: clear one CPT, press step 1 with skip —
    the cleared column rebuilds, every already-banded column is imported as-is."""
    gid = await _subdivide(async_client, band_scene)

    async def cpt_rows(key: str) -> set[str]:
        db_session.expire_all()
        return {
            str(r)
            for r in (
                await db_session.execute(
                    select(LithoLayerOrm.id).where(
                        LithoLayerOrm.model_id == UUID(gid),
                        LithoLayerOrm.cpt_id == band_scene[key],
                    )
                )
            )
            .scalars()
            .all()
        }

    b_before = await cpt_rows("cpt_b_id")

    clear = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{gid}/geotech/columns/clear",
        json={"investigation_id": str(band_scene["cpt_a_id"])},
    )
    assert clear.status_code == 200, clear.text

    press = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": band_scene["litho_model_id"], "skip_existing": True},
    )
    assert press.status_code == 200, press.text

    assert await cpt_rows("cpt_a_id"), "the cleared column must be rebuilt"
    assert await cpt_rows("cpt_b_id") == b_before, "the untouched column is imported as-is"


# ---------------------------------------------------------------------------
# OS — the orphan-formation sweep
#
# The owner's Geotech-units pane, 2026-08-26: 94 rows, 32 with bands, 62
# describing nothing. Geotech formations are created on demand and were never
# removed, so every re-subdivide, re-divide and band edit that stopped
# producing a packing class left its unit behind — and a .strix restore brought
# the whole accumulated set back. These pin that the geotech verbs now retire
# their own vocabulary, and that retiring it is reversible.
# ---------------------------------------------------------------------------


async def _geotech_formations(db_session: AsyncSession, project_id) -> list[GeologicalFormationOrm]:
    """Every geotech unit in the project — the roster the pane renders."""
    db_session.expire_all()
    rows = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.app_project_id == project_id,
                    GeologicalFormationOrm.source_litho_formation_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _find_or_create_keys(formations: list[GeologicalFormationOrm]) -> set[tuple]:
    """The identity the find-or-create path matches on, per unit.

    Ids are NOT stable across a sweep (a re-created row gets a fresh uuid7), so
    "the same unit came back" has to be asked in the vocabulary the
    materialiser itself uses.
    """
    return {
        (f.nad_class, f.source_litho_formation_id, f.source_geo_formation_id) for f in formations
    }


@pytest.mark.asyncio
async def test_os1_a_band_edit_sweeps_a_unit_that_describes_nothing(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """OS1 — a geotech unit nothing points at is gone after the next verb runs.

    The stray is planted directly rather than manufactured through a sequence
    of edits, because that is how the owner's 62 arrived: already in the file,
    made by runs whose history no longer exists.  The sweep's contract is about
    what a row REFERENCES, not about who made it.

    OS2 rides along in the same scene: the sweep took ONLY the stray.  A sweep
    that also took a unit still carrying bands would empty the model, so the
    two claims are worth asserting against one another rather than apart.
    """
    gid, rows = await _divided_borehole_bands(band_scene, async_client, db_session)

    live = await _geotech_formations(db_session, band_scene["project_id"])
    assert live, "the pipeline must have produced geotech units to sweep around"
    source_litho_id = live[0].source_litho_formation_id

    stray_id = uuid7()
    db_session.add(
        GeologicalFormationOrm(
            id=stray_id,
            app_project_id=band_scene["project_id"],
            name="ZAND (NAD 12) - stray from an older run",
            color="#d4b84a",
            display_order=99,
            nad_class=12,
            litho_main_soil_code="ZAND",
            source_litho_formation_id=source_litho_id,
        )
    )
    await db_session.commit()
    assert await db_session.get(GeologicalFormationOrm, stray_id) is not None

    live_ids_before = {
        f.id for f in await _geotech_formations(db_session, band_scene["project_id"])
    }

    # Any geotech verb will do — this one is the cheapest.
    resp = await async_client.post(
        _band_url(band_scene, gid, "set-class"),
        json={"band_id": rows[0][0], "nad_class": 8},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    assert await db_session.get(GeologicalFormationOrm, stray_id) is None, (
        "a unit with no bands, no contacts and no bodies must not survive a verb"
    )

    after_ids = {f.id for f in await _geotech_formations(db_session, band_scene["project_id"])}
    swept_live = (live_ids_before - {stray_id}) - after_ids
    # The edited band's own former class may legitimately retire here; nothing
    # else may. Any unit that still holds a band must still be on the roster.
    still_banded = set(
        (
            await db_session.execute(
                select(LithoLayerOrm.formation_id)
                .where(LithoLayerOrm.model_id == UUID(gid))
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    assert swept_live & still_banded == set(), (
        "the sweep removed a unit that still had bands behind it"
    )


@pytest.mark.asyncio
async def test_os3_a_swept_unit_comes_back_when_the_next_divide_needs_it(
    band_scene: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """OS3 — sweeping is reversible: re-run the verb and the unit is re-created.

    This is what makes the delete safe.  Nothing about a geotech unit is
    authored — its identity is the find-or-create key ``(nad_class, source
    litho, source geo)`` and every other column is copied from the source litho
    formation at create time — so a divide that needs the class again rebuilds
    an equivalent row.  The pin compares KEYS, not ids: a re-created row is a
    new uuid7 by construction.
    """
    gid, _rows = await _divided_borehole_bands(band_scene, async_client, db_session)

    keys_before = _find_or_create_keys(
        await _geotech_formations(db_session, band_scene["project_id"])
    )
    assert keys_before, "the pipeline must have produced geotech units"

    # Clear the borehole column: its bands go and nothing rebuilds them here,
    # so any unit that lived only on that column is swept.
    clear = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/{gid}/geotech/columns/clear",
        json={"investigation_id": str(band_scene["bh_id"])},
    )
    assert clear.status_code == 200, clear.text

    keys_after_clear = _find_or_create_keys(
        await _geotech_formations(db_session, band_scene["project_id"])
    )
    assert keys_after_clear <= keys_before, "the sweep must never invent a unit"

    # Press the step again — same donors, so the same classes.
    divide = await async_client.post(
        f"/projects/{band_scene['project_id']}/geology/models/"
        f"{band_scene['litho_model_id']}/geotech/divide-boreholes",
        json={},
    )
    assert divide.status_code == 200, divide.text

    keys_after_redivide = _find_or_create_keys(
        await _geotech_formations(db_session, band_scene["project_id"])
    )
    assert keys_before <= keys_after_redivide, (
        "every unit the sweep retired must be back after the divide that needs it"
    )
