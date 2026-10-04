"""Section scoping of the geotech pipeline's step 4 (owner ruling 2026-08-15).

The owner read the pipeline menu after steps 1-3 became section-scoped:

    "i'm reading divide boreholes (whole model), no that should also be section
    scoped"

So ``POST .../geotech/divide-boreholes`` takes an optional ``section_id``.
Present, it divides that section's member boreholes and gates on THAT section's
pending ties; absent, it is exactly the historic whole-model run every existing
caller relies on.

The point of the change is finishing one section end to end: the owner must be
able to divide CS1's boreholes while CS2 still carries proposals he has not
reviewed.  Before it, one unreviewed tie anywhere in the model locked step 4 on
every section.

Scene
-----
Two sections 1 km apart, each carrying its own CPT - borehole - CPT triple:

* section A - CPT-A1 / BH-A / CPT-A2 at y = 200 000,
* section B - CPT-B1 / BH-B / CPT-B2 at y = 201 000.

Each triple is litho-correlated only THROUGH its borehole, and nothing
correlates across the two sections, so a verb that leaks out of its scope shows
up as bands on the borehole it was not aimed at.

Cases
-----
DS1  A scoped divide runs while the OTHER section's ties are still pending, and
     bands only its own borehole.
DS2  The same model refuses the whole-model divide while any tie is pending.
DS3  Dividing the second section afterwards leaves the first section's borehole
     bands EXACTLY as they were - row ids included, so a whole-model delete
     that rebuilt them identically still fails.
DS4  A scoped divide leaves the other section's ties untouched.
DS5  The preview is scoped the same way the commit is (DB5's parity, per
     section): it reports only the scoped section's borehole.
DS6  A scoped divide derives edges for its own section only.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_geotech_divide_boreholes_scope.py
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
async def two_section_borehole_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Two sections, each with a CPT - borehole - CPT triple correlated through it.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``section_a_id``,
        ``section_b_id``, ``bh_a_id``, ``bh_b_id``, ``cpt_a1_id``,
        ``cpt_a2_id``, ``cpt_b1_id``, ``cpt_b2_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech divide-scope test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "DS-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "DS-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model_id = litho_resp.json()["id"]

    async def _section(name: str, y: float) -> str:
        resp = await async_client.post(
            f"/projects/{pid}/sections",
            json={
                "name": name,
                "start_x": 148_700.0,
                "start_y": y,
                "end_x": 149_900.0,
                "end_y": y,
                "epsg": 31370,
                # 60 m either side: wide enough for its own triple, far too
                # narrow to reach the triple 1 km away.
                "projection_buffer_m": 60.0,
            },
        )
        assert resp.status_code == 201, resp.text
        return str(resp.json()["id"])

    section_a_id = await _section("DS-Section-A", 200_000.0)
    section_b_id = await _section("DS-Section-B", 201_000.0)

    def _cpt(name: str, x: float, y: float, transition_samples: int) -> CptOrm:
        depths, qc = two_layer_qc(
            n_top=transition_samples, n_bot=400 - transition_samples, qc_top=8.0, qc_bot=18.0
        )
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="DS",
            test_id=f"DS/{name}",
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

    def _borehole(name: str, x: float, y: float) -> BoreholeOrm:
        return BoreholeOrm(
            id=uuid7(),
            name=name,
            app_project_id=proj.id,
            project_id="DS",
            test_id=f"DS/{name}",
            location_x=x,
            location_y=y,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            total_depth_m=8.0,
        )

    cpt_a1 = _cpt("CPT-A1", 149_000.0, 200_000.0, 200)
    cpt_a2 = _cpt("CPT-A2", 149_600.0, 200_000.0, 250)
    cpt_b1 = _cpt("CPT-B1", 149_000.0, 201_000.0, 200)
    cpt_b2 = _cpt("CPT-B2", 149_600.0, 201_000.0, 250)
    bh_a = _borehole("BH-A", 149_300.0, 200_000.0)
    bh_b = _borehole("BH-B", 149_300.0, 201_000.0)
    db_session.add_all([cpt_a1, cpt_a2, cpt_b1, cpt_b2, bh_a, bh_b])
    await db_session.commit()

    cpt_contacts: dict[str, str] = {}
    for cpt in (cpt_a1, cpt_a2, cpt_b1, cpt_b2):
        cpt_contacts[cpt.name] = await accept_cpt_litho(
            async_client, pid, litho_model_id, cpt_id=str(cpt.id), top=0.0, base=8.0
        )
    bh_contacts: dict[str, str] = {}
    for bh in (bh_a, bh_b):
        bh_contacts[bh.name] = await accept_borehole_litho(
            async_client, pid, litho_model_id, borehole_id=str(bh.id), top=0.0, base=8.0
        )

    # Each triple is joined only THROUGH its borehole — the shape the borehole
    # divide exists for.
    for left, mid, right, section_id in (
        ("CPT-A1", "BH-A", "CPT-A2", section_a_id),
        ("CPT-B1", "BH-B", "CPT-B2", section_b_id),
    ):
        await correlate(
            async_client,
            pid,
            litho_model_id,
            contact_a=cpt_contacts[left],
            contact_b=bh_contacts[mid],
            section_id=section_id,
        )
        await correlate(
            async_client,
            pid,
            litho_model_id,
            contact_a=bh_contacts[mid],
            contact_b=cpt_contacts[right],
            section_id=section_id,
        )
    # The fill paints the litho ties as bands; the recompute's facts make each tied
    # chain ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "section_a_id": section_a_id,
        "section_b_id": section_b_id,
        "bh_a_id": bh_a.id,
        "bh_b_id": bh_b.id,
        "cpt_a1_id": cpt_a1.id,
        "cpt_a2_id": cpt_a2.id,
        "cpt_b1_id": cpt_b1.id,
        "cpt_b2_id": cpt_b2.id,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _subdivide_cpts(client: AsyncClient, scene: dict) -> str:
    """Run pipeline step 1 model-wide and return the geotech model id."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _divide(client: AsyncClient, scene: dict, body: dict):
    """POST step 4 with the given request body verbatim."""
    return await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/divide-boreholes",
        json=body,
    )


async def _preview_divide(client: AsyncClient, scene: dict, body: dict) -> dict:
    """POST the step-4 preview with the given request body verbatim."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/divide-boreholes/preview",
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _borehole_bands(
    db_session: AsyncSession, geotech_model_id: str, borehole_id: UUID
) -> list[tuple[UUID, float, float]]:
    """One borehole's geotech bands as ``(layer_id, top, base)``, depth ordered.

    The row id is carried so a test can tell "left alone" from "deleted and
    rebuilt identically" — the exact difference between a scoped delete and a
    whole-model one.
    """
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
    return [(row.id, row.depth_top_m, row.depth_base_m) for row in rows]


async def _stage_pending_tie(
    db_session: AsyncSession,
    geotech_model_id: str,
    *,
    section_id: str,
    cpt_a_id: UUID,
    cpt_b_id: UUID,
) -> None:
    """Stage ONE pending packing tie between two CPTs' shallowest bands.

    Deterministic by construction, so the gate scenes assert on a known count
    rather than on whatever auto-correlate happens to derive.
    """

    async def _top_layer(cpt_id: UUID) -> LithoLayerOrm:
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
        assert rows, f"pending-tie helper: no geotech bands on CPT {cpt_id}"
        return rows[0]

    a = await _top_layer(cpt_a_id)
    b = await _top_layer(cpt_b_id)
    lo, hi = (a.id, b.id) if a.id < b.id else (b.id, a.id)
    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=UUID(geotech_model_id),
            section_id=UUID(section_id),
            layer_a_id=lo,
            layer_b_id=hi,
            layer_a_side="top",
            layer_b_side="top",
            user_approved=False,
            source="auto",
        )
    )
    await db_session.commit()


async def _pending_edges_on(
    db_session: AsyncSession, geotech_model_id: str, section_id: str
) -> list[LithoContactCorrelationEdgeOrm]:
    """The section's unapproved geotech edges."""
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(geotech_model_id),
                    LithoContactCorrelationEdgeOrm.section_id == UUID(section_id),
                    LithoContactCorrelationEdgeOrm.user_approved.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


# ---------------------------------------------------------------------------
# DS1-DS6
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ds1_a_scoped_divide_runs_while_the_other_section_is_still_pending(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS1: section A divides even though section B has proposals outstanding.

    This is the whole point of the change — the owner finishes CS1 end to end
    while CS2 is still under review.
    """
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)
    await _stage_pending_tie(
        db_session,
        gid,
        section_id=scene["section_b_id"],
        cpt_a_id=scene["cpt_b1_id"],
        cpt_b_id=scene["cpt_b2_id"],
    )

    resp = await _divide(async_client, scene, {"section_id": scene["section_a_id"]})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    bands_a = await _borehole_bands(db_session, gid, scene["bh_a_id"])
    bands_b = await _borehole_bands(db_session, gid, scene["bh_b_id"])
    assert bands_a, "the scoped section's borehole must be divided"
    assert bands_b == [], (
        "the other section's borehole must be left undivided — the press was not aimed at it"
    )


@pytest.mark.asyncio
async def test_ds2_the_whole_model_divide_still_refuses_while_any_tie_is_pending(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS2: omitting the section keeps the model-wide gate exactly as it was.

    The scoped call is an addition, not a loophole: a caller that asks to
    rewrite every section still has to have the whole model clear.
    """
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)
    await _stage_pending_tie(
        db_session,
        gid,
        section_id=scene["section_b_id"],
        cpt_a_id=scene["cpt_b1_id"],
        cpt_b_id=scene["cpt_b2_id"],
    )

    resp = await _divide(async_client, scene, {})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "geotech_ties_pending"
    assert detail["pending_tie_count"] == 1


@pytest.mark.asyncio
async def test_ds2b_a_scoped_divide_refuses_on_its_own_sections_pending_ties(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS2b: the gate follows the scope — it does not disappear with it.

    A pending tie ON the section being divided is still evidence the divide
    would throw away, so the refusal is unchanged there.
    """
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)
    await _stage_pending_tie(
        db_session,
        gid,
        section_id=scene["section_a_id"],
        cpt_a_id=scene["cpt_a1_id"],
        cpt_b_id=scene["cpt_a2_id"],
    )

    resp = await _divide(async_client, scene, {"section_id": scene["section_a_id"]})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "geotech_ties_pending"
    assert resp.json()["detail"]["pending_tie_count"] == 1


@pytest.mark.asyncio
async def test_ds3_dividing_the_second_section_leaves_the_first_untouched(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS3: two sections can be divided at once — the analogue of GS5-GS9.

    Asserted on the ROW IDS, not the depths: a whole-model delete that rebuilt
    section A's bands byte-identically would still be a regression, because the
    ties anchored on those rows cascade away with them.
    """
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)

    resp_a = await _divide(async_client, scene, {"section_id": scene["section_a_id"]})
    assert resp_a.status_code == 200, resp_a.text
    db_session.expire_all()
    bands_a_before = await _borehole_bands(db_session, gid, scene["bh_a_id"])
    assert bands_a_before, "DS3: section A was not divided — nothing is being tested"

    resp_b = await _divide(async_client, scene, {"section_id": scene["section_b_id"]})
    assert resp_b.status_code == 200, resp_b.text

    db_session.expire_all()
    bands_a_after = await _borehole_bands(db_session, gid, scene["bh_a_id"])
    bands_b_after = await _borehole_bands(db_session, gid, scene["bh_b_id"])
    assert bands_b_after, "DS3: section B's borehole must be divided by its own press"
    assert bands_a_after == bands_a_before, (
        "DS3: dividing section B rewrote section A's borehole bands — the "
        "delete is reaching outside the press's scope"
    )


@pytest.mark.asyncio
async def test_ds4_a_scoped_divide_leaves_the_other_sections_ties_alone(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS4: the neighbour's proposals survive a divide aimed elsewhere."""
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)
    await _stage_pending_tie(
        db_session,
        gid,
        section_id=scene["section_b_id"],
        cpt_a_id=scene["cpt_b1_id"],
        cpt_b_id=scene["cpt_b2_id"],
    )
    before = {edge.id for edge in await _pending_edges_on(db_session, gid, scene["section_b_id"])}
    assert len(before) == 1

    resp = await _divide(async_client, scene, {"section_id": scene["section_a_id"]})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    after = {edge.id for edge in await _pending_edges_on(db_session, gid, scene["section_b_id"])}
    assert after == before, "DS4: the other section's pending ties were touched"


@pytest.mark.asyncio
async def test_ds5_the_preview_is_scoped_the_same_way_the_commit_is(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS5: preview ≡ commit, per section (the standing DB5 gate).

    A preview that showed both boreholes while the commit wrote one would put
    ghost bands on a column the press never reaches.
    """
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)

    preview = await _preview_divide(async_client, scene, {"section_id": scene["section_a_id"]})
    previewed = {
        column["borehole_id"]: [
            (band["depth_top_m"], band["depth_base_m"]) for band in column["bands"]
        ]
        for column in preview["columns"]
    }
    assert set(previewed) == {str(scene["bh_a_id"])}, (
        f"DS5: the scoped preview reported {sorted(previewed)} — it must report "
        f"only the scoped section's borehole"
    )

    resp = await _divide(async_client, scene, {"section_id": scene["section_a_id"]})
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    committed = [
        (top, base) for _id, top, base in await _borehole_bands(db_session, gid, scene["bh_a_id"])
    ]
    assert committed == previewed[str(scene["bh_a_id"])], (
        "DS5: the scoped preview promised different bands than the scoped commit wrote"
    )


@pytest.mark.asyncio
async def test_ds6_a_scoped_divide_derives_edges_for_its_own_section_only(
    two_section_borehole_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """DS6: phase 8.5's borehole-mediated derivation follows the scope.

    The divide adds the CPT-borehole-CPT chain's edges once the borehole
    carries bands.  Aimed at section A, it must not author edges on section B —
    whose borehole has no bands for them to point at.
    """
    scene = two_section_borehole_scene
    gid = await _subdivide_cpts(async_client, scene)

    resp = await _divide(async_client, scene, {"section_id": scene["section_a_id"]})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == UUID(gid),
                    LithoContactCorrelationEdgeOrm.section_id == UUID(scene["section_b_id"]),
                )
            )
        )
        .scalars()
        .all()
    )
    assert list(rows) == [], (
        "DS6: the scoped divide authored edges on the section it was not aimed at"
    )
