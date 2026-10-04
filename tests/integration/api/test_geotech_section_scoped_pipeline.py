"""Section scoping of the geotech pipeline's steps 2 and 3 (owner ruling 2026-08-15).

The owner dogfed the packing pipeline and said of steps 2 and 3:

    "I also see that this is model wide and not per section, i don't like that"

So the two verbs act on the section he has open, with an explicit
all-sections escape.  On the wire that is one OPTIONAL ``section_id`` in each
request body: present means "this section only", absent means today's
model-wide behaviour, which every existing caller relies on.

Scene
-----
Two sections 1 km apart, each with its own correlated CPT pair:

* section A — CPT-A1 / CPT-A2 at y = 200 000, correlated to each other,
* section B — CPT-B1 / CPT-B2 at y = 201 000, correlated to each other.

Nothing correlates across the two, so a verb that leaks out of its scope shows
up as edges on the section it was not aimed at.

Step 1 is scoped the same way, and the next morning the owner deleted the
all-sections escape beside all three verbs:

    "I didn't ask for the on all sections option, it's ugly and confusing
    delete it and keep only on this section"

which makes the scoped subdivide the ONLY subdivide he can press — so it may
no longer wipe what it does not rebuild.  Before that ruling the verb deleted
the whole geotech model and only narrowed the rebuild, which with no escape
left would mean two sections could never be subdivided at the same time.

Cases
-----
GS1  Step 2 scoped to section A proposes on A and leaves B empty.
GS2  Step 2 with the field OMITTED still reaches both sections.
GS3  Step 3 scoped to section A leaves section B's ties pending.
GS4  ``tie-status`` reports the pending count PER SECTION — the number the
     toolbar's chip and the step-4 gate now speak in.
GS5  Step 1 scoped to section A bands A's CPTs and not B's.
GS6  Subdividing B afterwards ADDS B's bands and leaves A's standing — the two
     sections are subdivided at the same time.
GS7  Re-running A rebuilds A and does not touch B's rows at all.
GS8  An accepted tie on B's columns survives a subdivide of A.
GS9  A scoped run does not report the OTHER section's columns as left out of
     the model — they are still in it, this press simply did not touch them.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/api/test_geotech_section_scoped_pipeline.py
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
from tests.integration.api.geotech_scene_helpers import (
    accept_cpt_litho,
    correlate,
    paint_accepted_ties,
    two_layer_qc,
)


@pytest_asyncio.fixture
async def two_section_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Two sections, each carrying its own correlated CPT pair.

    Returns
    -------
    dict
        Keys: ``project_id``, ``litho_model_id``, ``section_a_id``,
        ``section_b_id``, ``cpt_a1_id``, ``cpt_a2_id``, ``cpt_b1_id``,
        ``cpt_b2_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Geotech section-scope test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "GS-Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model_id = geo_resp.json()["id"]

    litho_resp = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "GS-Litho",
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
                # 60 m either side: wide enough for the pair on this line, far
                # too narrow to reach the pair 1 km away.
                "projection_buffer_m": 60.0,
            },
        )
        assert resp.status_code == 201, resp.text
        return str(resp.json()["id"])

    section_a_id = await _section("GS-Section-A", 200_000.0)
    section_b_id = await _section("GS-Section-B", 201_000.0)

    def _cpt(name: str, x: float, y: float, transition_samples: int) -> CptOrm:
        depths, qc = two_layer_qc(
            n_top=transition_samples, n_bot=400 - transition_samples, qc_top=8.0, qc_bot=18.0
        )
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="GS",
            test_id=f"GS/{name}",
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

    # Each pair reads matig over dicht with the transition at a slightly
    # different depth, so the two stacks align class-for-class.
    cpt_a1 = _cpt("CPT-A1", 149_000.0, 200_000.0, 200)
    cpt_a2 = _cpt("CPT-A2", 149_600.0, 200_000.0, 250)
    cpt_b1 = _cpt("CPT-B1", 149_000.0, 201_000.0, 200)
    cpt_b2 = _cpt("CPT-B2", 149_600.0, 201_000.0, 250)
    db_session.add_all([cpt_a1, cpt_a2, cpt_b1, cpt_b2])
    await db_session.commit()

    contacts: dict[str, str] = {}
    for cpt in (cpt_a1, cpt_a2, cpt_b1, cpt_b2):
        contacts[cpt.name] = await accept_cpt_litho(
            async_client, pid, litho_model_id, cpt_id=str(cpt.id), top=0.0, base=8.0
        )

    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contacts["CPT-A1"],
        contact_b=contacts["CPT-A2"],
        section_id=section_a_id,
    )
    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contacts["CPT-B1"],
        contact_b=contacts["CPT-B2"],
        section_id=section_b_id,
    )
    # The fill paints the litho ties as bands; the recompute's facts make each tied
    # chain ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    return {
        "project_id": pid,
        "litho_model_id": litho_model_id,
        "section_a_id": section_a_id,
        "section_b_id": section_b_id,
        "cpt_a1_id": cpt_a1.id,
        "cpt_a2_id": cpt_a2.id,
        "cpt_b1_id": cpt_b1.id,
        "cpt_b2_id": cpt_b2.id,
    }


async def _subdivide_cpts(
    client: AsyncClient, scene: dict, *, section_id: str | None = None
) -> str:
    """Run pipeline step 1 and return the geotech model id it created.

    Parameters
    ----------
    section_id : str | None
        Scope the run to one section, the way the toolbar's only remaining
        subdivide item does.  ``None`` omits the field entirely — the historic
        model-wide press.
    """
    body: dict = {"litho_model_id": scene["litho_model_id"]}
    if section_id is not None:
        body["section_id"] = section_id
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


async def _bands_by_cpt(
    db_session: AsyncSession, geotech_model_id: str
) -> dict[UUID, list[tuple[UUID, float, float]]]:
    """Every geotech band of the model, grouped by the CPT it sits on.

    Returns
    -------
    dict[UUID, list[tuple[UUID, float, float]]]
        ``cpt_id -> [(layer_id, depth_top_m, depth_base_m), ...]``, depth
        ordered.  The layer id is carried so a test can tell "rebuilt
        identically" from "never touched".
    """
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == UUID(geotech_model_id),
                    LithoLayerOrm.cpt_id.is_not(None),
                )
                .order_by(LithoLayerOrm.cpt_id, LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    grouped: dict[UUID, list[tuple[UUID, float, float]]] = {}
    for row in rows:
        grouped.setdefault(row.cpt_id, []).append((row.id, row.depth_top_m, row.depth_base_m))
    return grouped


def _shape(bands: list[tuple[UUID, float, float]]) -> list[tuple[float, float]]:
    """The depths of a column's bands, with the row ids dropped."""
    return [(top, base) for _, top, base in bands]


async def _auto_correlate(
    client: AsyncClient, scene: dict, geotech_model_id: str, body: dict
) -> dict:
    """Run pipeline step 2 with the given request body verbatim."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/{geotech_model_id}/geotech/auto-correlate",
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _accept(client: AsyncClient, scene: dict, geotech_model_id: str, body: dict) -> dict:
    """Run pipeline step 3 with the given request body verbatim."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{geotech_model_id}/contact-correlations/accept",
        json=body,
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


async def _edges_by_section(
    db_session: AsyncSession, geotech_model_id: str
) -> dict[str, list[LithoContactCorrelationEdgeOrm]]:
    """Every geotech edge of the model, grouped by the section it lives on."""
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
    grouped: dict[str, list[LithoContactCorrelationEdgeOrm]] = {}
    for row in rows:
        grouped.setdefault(str(row.section_id), []).append(row)
    return grouped


async def _stage_pending_tie(
    db_session: AsyncSession,
    geotech_model_id: str,
    *,
    section_id: str,
    cpt_a_id: UUID,
    cpt_b_id: UUID,
    approved: bool = False,
) -> None:
    """Insert one packing tie between two CPTs' shallowest bands.

    Staged by hand rather than derived so the scoping assertions read a known
    count instead of whatever the derivation happens to produce.

    Parameters
    ----------
    approved : bool
        ``False`` (the default) stages a PENDING proposal; ``True`` stages the
        engineer's own accepted tie, which nothing may destroy.
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
            user_approved=approved,
            source="manual" if approved else "auto",
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_gs1_step_two_scoped_to_a_section_leaves_the_other_untouched(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS1: "this is model wide and not per section, i don't like that".

    Aimed at section A, step 2 must derive on A only — section B keeps no
    geotech edge at all.
    """
    geotech_model_id = await _subdivide_cpts(async_client, two_section_scene)

    result = await _auto_correlate(
        async_client,
        two_section_scene,
        geotech_model_id,
        {"section_id": two_section_scene["section_a_id"]},
    )
    assert result["sections_processed"] == 1, (
        "one section in scope means one section examined; a second means the scope leaked"
    )

    grouped = await _edges_by_section(db_session, geotech_model_id)
    assert two_section_scene["section_a_id"] in grouped, (
        "the section he had open must actually get its ties"
    )
    assert two_section_scene["section_b_id"] not in grouped, (
        "section B was never on screen — nothing may be written there"
    )


@pytest.mark.asyncio
async def test_gs2_step_two_without_a_section_still_reaches_every_section(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS2: the escape hatch — omitting the field keeps the model-wide run.

    The secondary "on all sections" menu item and every pre-existing caller
    send no ``section_id``, and both must still cover the whole model.
    """
    geotech_model_id = await _subdivide_cpts(async_client, two_section_scene)

    result = await _auto_correlate(async_client, two_section_scene, geotech_model_id, {})
    assert result["sections_processed"] == 2

    grouped = await _edges_by_section(db_session, geotech_model_id)
    assert two_section_scene["section_a_id"] in grouped
    assert two_section_scene["section_b_id"] in grouped


@pytest.mark.asyncio
async def test_gs3_step_three_scoped_to_a_section_leaves_the_other_pending(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS3: accepting on the open section must not approve the neighbour's ties.

    Accepting a correlation is a judgement about geometry the engineer can
    see; a model-wide accept approves ties on sections that are not on screen.
    """
    geotech_model_id = await _subdivide_cpts(async_client, two_section_scene)
    await _stage_pending_tie(
        db_session,
        geotech_model_id,
        section_id=two_section_scene["section_a_id"],
        cpt_a_id=two_section_scene["cpt_a1_id"],
        cpt_b_id=two_section_scene["cpt_a2_id"],
    )
    await _stage_pending_tie(
        db_session,
        geotech_model_id,
        section_id=two_section_scene["section_b_id"],
        cpt_a_id=two_section_scene["cpt_b1_id"],
        cpt_b_id=two_section_scene["cpt_b2_id"],
    )

    result = await _accept(
        async_client,
        two_section_scene,
        geotech_model_id,
        {"section_id": two_section_scene["section_a_id"]},
    )
    assert result["edges_accepted"] == 1

    grouped = await _edges_by_section(db_session, geotech_model_id)
    for edge in grouped[two_section_scene["section_a_id"]]:
        assert edge.user_approved is True
    for edge in grouped[two_section_scene["section_b_id"]]:
        assert edge.user_approved is False, (
            "section B's tie was never reviewed — a scoped accept may not touch it"
        )


@pytest.mark.asyncio
async def test_gs4_tie_status_reports_the_pending_count_per_section(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS4: the gate must say WHICH sections still carry proposals.

    Step 4 stays model-wide (dividing boreholes rewrites every section), so the
    toolbar has to explain why a clean section still cannot divide.  A bare
    model total cannot; a per-section breakdown can, and it is also what the
    pending chip reports for the section on screen.
    """
    geotech_model_id = await _subdivide_cpts(async_client, two_section_scene)
    await _stage_pending_tie(
        db_session,
        geotech_model_id,
        section_id=two_section_scene["section_a_id"],
        cpt_a_id=two_section_scene["cpt_a1_id"],
        cpt_b_id=two_section_scene["cpt_a2_id"],
    )
    await _stage_pending_tie(
        db_session,
        geotech_model_id,
        section_id=two_section_scene["section_b_id"],
        cpt_a_id=two_section_scene["cpt_b1_id"],
        cpt_b_id=two_section_scene["cpt_b2_id"],
    )

    status = await _tie_status(async_client, two_section_scene, geotech_model_id)
    assert status["pending_tie_count"] == 2
    assert status["pending_by_section"] == {
        two_section_scene["section_a_id"]: 1,
        two_section_scene["section_b_id"]: 1,
    }

    # Accept section A's, and the breakdown must shrink to the section that is
    # actually still blocking the divide.
    await _accept(
        async_client,
        two_section_scene,
        geotech_model_id,
        {"section_id": two_section_scene["section_a_id"]},
    )
    status = await _tie_status(async_client, two_section_scene, geotech_model_id)
    assert status["pending_tie_count"] == 1
    assert status["pending_by_section"] == {two_section_scene["section_b_id"]: 1}


# ---------------------------------------------------------------------------
# GS5-GS8 — a scoped subdivide only WIPES what it rebuilds
#
# With the all-sections escape deleted, the scoped press is the only press
# there is.  If it still cleared the whole geotech model first, subdividing
# CS1 would strip CS2 and no project could ever have two sections subdivided
# at once.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gs5_step_one_scoped_to_a_section_bands_only_that_sections_cpts(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS5: aimed at section A, step 1 subdivides A's CPTs and nobody else's."""
    geotech_model_id = await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_a_id"]
    )

    bands = await _bands_by_cpt(db_session, geotech_model_id)
    assert two_section_scene["cpt_a1_id"] in bands
    assert two_section_scene["cpt_a2_id"] in bands
    assert two_section_scene["cpt_b1_id"] not in bands
    assert two_section_scene["cpt_b2_id"] not in bands


@pytest.mark.asyncio
async def test_gs6_subdividing_the_second_section_keeps_the_first_sections_bands(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS6: two sections subdivided at the same time — the point of the scoping.

    Before the fix the rebuild deleted the whole geotech model and only
    narrowed what it re-created, so this second press erased the first one's
    work and there was no way to have both.
    """
    geotech_model_id = await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_a_id"]
    )
    before = await _bands_by_cpt(db_session, geotech_model_id)
    assert before[two_section_scene["cpt_a1_id"]], "section A must be banded before we test B"

    await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_b_id"]
    )
    after = await _bands_by_cpt(db_session, geotech_model_id)

    assert after[two_section_scene["cpt_b1_id"]], "section B's CPTs must now carry bands"
    assert after[two_section_scene["cpt_b2_id"]]
    assert after.get(two_section_scene["cpt_a1_id"]) == before[two_section_scene["cpt_a1_id"]], (
        "subdividing B may not delete, move or renumber a single band on A — "
        "the rows must be the SAME rows"
    )
    assert after.get(two_section_scene["cpt_a2_id"]) == before[two_section_scene["cpt_a2_id"]]


@pytest.mark.asyncio
async def test_gs7_re_running_a_section_rebuilds_it_and_leaves_the_other_alone(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS7: a re-run of A is idempotent for A and does not touch B's rows."""
    geotech_model_id = await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_a_id"]
    )
    await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_b_id"]
    )
    before = await _bands_by_cpt(db_session, geotech_model_id)

    await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_a_id"]
    )
    after = await _bands_by_cpt(db_session, geotech_model_id)

    # A is rebuilt: same geometry from the same qc, fresh rows.
    assert _shape(after[two_section_scene["cpt_a1_id"]]) == _shape(
        before[two_section_scene["cpt_a1_id"]]
    ), "the same qc over the same litho unit must come back with the same bands"
    # B is not rebuilt: the very same rows, ids and all.
    assert after[two_section_scene["cpt_b1_id"]] == before[two_section_scene["cpt_b1_id"]]
    assert after[two_section_scene["cpt_b2_id"]] == before[two_section_scene["cpt_b2_id"]]


@pytest.mark.asyncio
async def test_gs8_an_accepted_tie_on_the_other_section_survives_the_subdivide(
    two_section_scene: dict,
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """GS8: the engineer's accepted tie on B is not collateral of a rebuild of A.

    The endpoint FKs cascade, so a wholesale layer wipe takes an accepted tie
    with it without passing through any application code.  A tie on columns
    the run does not rebuild must never reach that path at all.
    """
    geotech_model_id = await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_a_id"]
    )
    await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_b_id"]
    )
    await _stage_pending_tie(
        db_session,
        geotech_model_id,
        section_id=two_section_scene["section_b_id"],
        cpt_a_id=two_section_scene["cpt_b1_id"],
        cpt_b_id=two_section_scene["cpt_b2_id"],
        approved=True,
    )
    grouped = await _edges_by_section(db_session, geotech_model_id)
    tie_before = grouped[two_section_scene["section_b_id"]][0]
    endpoints_before = (tie_before.layer_a_id, tie_before.layer_b_id)

    await _subdivide_cpts(
        async_client, two_section_scene, section_id=two_section_scene["section_a_id"]
    )

    db_session.expire_all()
    grouped = await _edges_by_section(db_session, geotech_model_id)
    surviving = grouped.get(two_section_scene["section_b_id"], [])
    assert len(surviving) == 1, (
        "the accepted tie on section B was destroyed by a rebuild of section A"
    )
    assert surviving[0].user_approved is True
    assert surviving[0].source == "manual", "a hand-drawn tie must still read as hand work"
    assert (surviving[0].layer_a_id, surviving[0].layer_b_id) == endpoints_before, (
        "B's bands were never rebuilt, so its tie must still point at the very same rows"
    )


@pytest.mark.asyncio
async def test_gs9_a_scoped_run_does_not_report_the_other_section_as_left_out(
    two_section_scene: dict,
    async_client: AsyncClient,
) -> None:
    """GS9: "left out of the model" means on NO section, not "not on this one".

    The skip report exists to say a model came out smaller than the sidebar's
    investigation count.  A column on the neighbouring section is IN the model
    and keeps its bands through this press, so naming it here would send the
    engineer looking for a problem that is not there.
    """
    resp = await async_client.post(
        f"/projects/{two_section_scene['project_id']}/geology/models/"
        f"{two_section_scene['litho_model_id']}/geotech/subdivide-cpts",
        json={
            "litho_model_id": two_section_scene["litho_model_id"],
            "section_id": two_section_scene["section_a_id"],
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    assert payload["skipped_off_section_count"] == 0, payload["skipped_off_section_labels"]
    assert payload["skipped_off_section_labels"] == []
