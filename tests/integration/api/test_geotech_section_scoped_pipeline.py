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

Cases
-----
GS1  Step 2 scoped to section A proposes on A and leaves B empty.
GS2  Step 2 with the field OMITTED still reaches both sections.
GS3  Step 3 scoped to section A leaves section B's ties pending.
GS4  ``tie-status`` reports the pending count PER SECTION — the number the
     toolbar's chip and the step-4 gate now speak in.

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


async def _subdivide_cpts(client: AsyncClient, scene: dict) -> str:
    """Run pipeline step 1 and return the geotech model id it created."""
    resp = await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['litho_model_id']}/geotech/subdivide-cpts",
        json={"litho_model_id": scene["litho_model_id"]},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["geotech_model_id"])


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
) -> None:
    """Insert one PENDING packing tie between two CPTs' shallowest bands.

    Staged by hand rather than derived so the scoping assertions read a known
    count instead of whatever the derivation happens to produce.
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
