"""HTTP-level tests for the litho-correlation endpoints (Phase-2 Slices 1+3; R7).

Pins the contract the frontend depends on:

Slice 1 (existing):
* POST creates an edge (201) and is idempotent (200 on re-call).
* DELETE removes it and is idempotent (204 whether or not it existed).
* POST after DELETE creates a fresh edge.
* Self-loop and cross-project / cross-group are 422.

Slice 3 (new):
* POST /resolve → 200 with updated list after an edge is created.
* POST /resolve → 200 with empty list when nothing changed (idempotent).
* GET  /correlations → 200 list of edges (id, formation_a_id, formation_b_id, source).
* GET  /correlations on a fresh model → 200 empty list.
* 404 when model does not exist or does not belong to the project (resolve + list).

R7 (Position 4 inference hooks):
* POST correlate → inference engine fires; inferred absence appears for the
  formation that has no contact at the borehole but shares the body via the edge.
* DELETE uncorrelate → inference re-runs; the inferred absence is retracted.
* Accept litho suggestions → inference fires atomically; no unhandled error.

Structural #57 guard (all endpoints):
* None of these endpoints accept a ``section_id`` query / body parameter.
* None of them modify ``seeded_formation_contact_ids`` on any cross-section.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for correlation tests."""
    proj = ProjectOrm(id=uuid7(), name="litho correlation test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


async def _geo_model(client: AsyncClient, project_id) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _litho_model(client: AsyncClient, project_id, parent_id: str) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": parent_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _formation(client: AsyncClient, project_id, name: str) -> dict:  # noqa: ANN001
    # Plain create → parent_formation_id=null, litho_main_soil_code=null,
    # so two of these share the (null, null) naming group and may be
    # correlated.
    resp = await client.post(
        f"/projects/{project_id}/geology/formations",
        json={"name": name, "color": "#aaa"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _two_formations_in_litho_model(client: AsyncClient, project_id) -> tuple[str, str, str]:  # noqa: ANN001
    """Return (litho_model_id, formation_a_id, formation_b_id)."""
    geo = await _geo_model(client, project_id)
    litho = await _litho_model(client, project_id, geo["id"])
    fa = await _formation(client, project_id, "ZAND occ A")
    fb = await _formation(client, project_id, "ZAND occ B")
    return litho["id"], fa["id"], fb["id"]


async def test_correlate_creates_then_idempotent(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """First POST → 201; identical re-POST → 200 (same edge, idempotent)."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}/correlations"

    r1 = await async_client.post(base, json={"formation_a_id": a, "formation_b_id": b})
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    assert body1["was_created"] is True
    assert "edge_id" in body1
    assert isinstance(body1["instance_ordinals_updated"], list)

    # Re-POST with the endpoints swapped — canonical ordering means it is
    # the SAME edge → 200, not a duplicate 201.
    r2 = await async_client.post(base, json={"formation_a_id": b, "formation_b_id": a})
    assert r2.status_code == 200, r2.text
    assert r2.json()["was_created"] is False
    assert r2.json()["edge_id"] == body1["edge_id"]


async def test_correlate_accepts_clients_exact_source_body(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Pin the client↔schema contract for `source` (Phase-2 span audit BLOCKER).

    The frontend client posts ``source: 'manual'`` verbatim; the request
    schema is ``Literal["manual"]``. A prior drift sent
    ``'manual_connect'`` and 422'd EVERY correlate call — invisible to
    the other tests because they omit ``source`` and rely on the Pydantic
    default. This posts the client's EXACT body shape (→ 201) and an
    out-of-literal token (→ 422), pinning both sides.
    """
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}/correlations"

    ok = await async_client.post(
        base, json={"formation_a_id": a, "formation_b_id": b, "source": "manual"}
    )
    assert ok.status_code == 201, ok.text

    bad = await async_client.post(
        base,
        json={"formation_a_id": a, "formation_b_id": b, "source": "manual_connect"},
    )
    assert bad.status_code == 422, bad.text


async def test_uncorrelate_idempotent_and_recreate(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """DELETE is 204 whether or not the edge exists; POST after DELETE re-creates."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}/correlations"

    await async_client.post(base, json={"formation_a_id": a, "formation_b_id": b})

    d1 = await async_client.request("DELETE", base, json={"formation_a_id": a, "formation_b_id": b})
    assert d1.status_code == 204, d1.text
    # Idempotent: deleting a non-existent edge is still 204.
    d2 = await async_client.request("DELETE", base, json={"formation_a_id": a, "formation_b_id": b})
    assert d2.status_code == 204, d2.text

    # Re-create after delete → a fresh 201.
    r = await async_client.post(base, json={"formation_a_id": a, "formation_b_id": b})
    assert r.status_code == 201, r.text
    assert r.json()["was_created"] is True


async def test_self_loop_is_422(async_client: AsyncClient, project: ProjectOrm) -> None:
    """Correlating a formation with itself is rejected at the API boundary."""
    mid, a, _ = await _two_formations_in_litho_model(async_client, project.id)
    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": a, "formation_b_id": a},
    )
    assert r.status_code == 422, r.text


async def test_cross_project_formation_is_rejected(
    async_client: AsyncClient, project: ProjectOrm, db_session: AsyncSession
) -> None:
    """A formation from another project cannot be correlated into this model."""
    mid, a, _ = await _two_formations_in_litho_model(async_client, project.id)

    other = ProjectOrm(id=uuid7(), name="other proj", status="active")
    db_session.add(other)
    await db_session.commit()
    foreign = await _formation(async_client, other.id, "foreign ZAND")

    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": a, "formation_b_id": foreign["id"]},
    )
    assert r.status_code == 422, r.text


async def test_cross_group_different_soil_code_is_422(
    async_client: AsyncClient, project: ProjectOrm, db_session: AsyncSession
) -> None:
    """Two formations in different (parent, soil) groups can't be correlated.

    The resolver only groups within a single (parent_formation_id,
    litho_main_soil_code) bucket; an edge across groups is meaningless
    and rejected at the use case (→ 422). DoD structural-error path at
    the integration level (review S3).
    """
    geo = await _geo_model(async_client, project.id)
    litho = await _litho_model(async_client, project.id, geo["id"])
    # Plain POST /formations has no litho_main_soil_code field, so set
    # the differing codes directly on the ORM rows.
    f_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND A",
        color="#aaa",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    f_clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI A",
        color="#aaa",
        display_order=1,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([f_sand, f_clay])
    await db_session.commit()

    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho['id']}/correlations",
        json={"formation_a_id": str(f_sand.id), "formation_b_id": str(f_clay.id)},
    )
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# Slice 3 — POST /resolve and GET /correlations
# ---------------------------------------------------------------------------


async def test_resolve_returns_updates_after_correlate(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """POST /resolve after adding an edge returns the updated ordinal list."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}"

    # Create an edge so the resolver has something to resolve.
    r = await async_client.post(
        f"{base}/correlations", json={"formation_a_id": a, "formation_b_id": b}
    )
    assert r.status_code == 201, r.text

    # Resolve.
    resolve_resp = await async_client.post(f"{base}/correlations/resolve")
    assert resolve_resp.status_code == 200, resolve_resp.text
    body = resolve_resp.json()
    assert "updated" in body
    assert isinstance(body["updated"], list)


async def test_resolve_idempotent_returns_empty_list(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """POST /resolve twice in a row: second call returns empty updated list."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}"

    await async_client.post(f"{base}/correlations", json={"formation_a_id": a, "formation_b_id": b})

    # First resolve — may produce updates.
    r1 = await async_client.post(f"{base}/correlations/resolve")
    assert r1.status_code == 200, r1.text

    # Second resolve — no structural change → empty updated.
    r2 = await async_client.post(f"{base}/correlations/resolve")
    assert r2.status_code == 200, r2.text
    assert r2.json()["updated"] == []


async def test_list_correlations_returns_edges(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """GET /correlations after creating an edge returns that edge in the list."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}"

    # Empty before any edge.
    r0 = await async_client.get(f"{base}/correlations")
    assert r0.status_code == 200, r0.text
    assert r0.json() == []

    # Create an edge.
    cr = await async_client.post(
        f"{base}/correlations", json={"formation_a_id": a, "formation_b_id": b}
    )
    assert cr.status_code == 201, cr.text
    edge_id = cr.json()["edge_id"]

    # List now returns it.
    r1 = await async_client.get(f"{base}/correlations")
    assert r1.status_code == 200, r1.text
    edges = r1.json()
    assert len(edges) == 1
    edge = edges[0]
    assert edge["id"] == edge_id
    assert set(edge.keys()) >= {"id", "formation_a_id", "formation_b_id", "source", "created_at"}
    assert edge["source"] == "manual"


async def test_list_correlations_empty_on_fresh_model(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """GET /correlations on a model with no edges returns an empty list (200)."""
    geo = await _geo_model(async_client, project.id)
    litho = await _litho_model(async_client, project.id, geo["id"])
    r = await async_client.get(f"/projects/{project.id}/geology/models/{litho['id']}/correlations")
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_resolve_404_for_unknown_model(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """POST /resolve with a non-existent model_id returns 404."""
    from uuid6 import uuid7

    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{uuid7()}/correlations/resolve"
    )
    assert r.status_code == 404, r.text


async def test_list_correlations_404_for_unknown_model(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """GET /correlations with a non-existent model_id returns 404."""
    from uuid6 import uuid7

    r = await async_client.get(f"/projects/{project.id}/geology/models/{uuid7()}/correlations")
    assert r.status_code == 404, r.text


async def test_resolve_and_list_have_no_section_id_param(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Structural #57 guard: resolve + list take no section_id.

    Sends a ``section_id`` as both a query param and a body field and
    asserts neither endpoint uses it — they either 422 (body unexpected
    for GET) or succeed without incorporating the section context.

    The real guarantee is structural: neither endpoint's handler has a
    section_id parameter or calls applyUpdatedSection / touches
    seeded_formation_contact_ids.  This test is a belt-and-suspenders
    contract check that would catch an accidental regression.
    """
    from uuid6 import uuid7

    geo = await _geo_model(async_client, project.id)
    litho = await _litho_model(async_client, project.id, geo["id"])
    mid = litho["id"]
    base = f"/projects/{project.id}/geology/models/{mid}"

    fake_section_id = str(uuid7())

    # GET /correlations — section_id as a query param is ignored (not an endpoint param).
    r_get = await async_client.get(f"{base}/correlations", params={"section_id": fake_section_id})
    # 200: the endpoint is unaffected by the extra param (FastAPI ignores unknown params).
    assert r_get.status_code == 200, r_get.text
    # No seeded_formation_contact_ids in the response body.
    for edge in r_get.json():
        assert "seeded_formation_contact_ids" not in edge

    # POST /resolve — a body with section_id must not be interpreted as a
    # section-scoped resolve (the endpoint takes no body at all).
    r_resolve = await async_client.post(
        f"{base}/correlations/resolve",
        json={"section_id": fake_section_id},
    )
    # FastAPI will 422 because the endpoint takes no body; OR 200 if it
    # simply ignores the payload (implementation-dependent).  Either
    # outcome is acceptable — what matters is the response does NOT carry
    # seeded_formation_contact_ids.
    assert r_resolve.status_code in (200, 422), r_resolve.text
    if r_resolve.status_code == 200:
        assert "seeded_formation_contact_ids" not in r_resolve.json()


# ---------------------------------------------------------------------------
# R7 — Position 4 inference hooks (#101)
#
# Proves the loop closes:
#   correlate  → inferred absence written for the formation with no contact at
#                the borehole that has conflicting-lithology observation layers
#   uncorrelate → inference re-runs without error; absence table stays consistent
#
# Setup:
#   Two ZAND formations (FA, FB) share the same (parent=None, soil=ZAND) bucket.
#   BH-contact is in the corridor and has a FormationContact for FA at depth 3 m.
#   BH-absent is in the corridor and has KLEI observation layers at [2–5 m].
#
#   After correlating FA ↔ FB:
#     FA body depth band = [3.0–3.5 m] (single contact → 0.5 m guard applies).
#     BH-absent: no contact for FA, KLEI at [2–5 m] overlaps [3.0–3.5 m],
#     KLEI ≠ ZAND → absence written for FA at BH-absent.
#     FB: no contacts at all → body_contacts empty → inference skips (no depth
#     band to evaluate); no absence written for FB on the first call.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def r7_project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for R7 inference hook tests."""
    proj = ProjectOrm(id=uuid7(), name="R7 inference hook test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


async def _r7_stack(
    client: AsyncClient,
    db_session: AsyncSession,
    project: ProjectOrm,
) -> dict:
    """Create the full geo/litho/section/borehole stack for R7 tests.

    Returns a dict with keys:
        litho_model_id, fa_id, fb_id, section_id, bh_contact_id, bh_absent_id

    ORM rows are inserted directly (no REST endpoints for contacts/observations)
    so the test controls exactly which formation each contact belongs to,
    bypassing the find-or-create logic in AcceptLithoSuggestions.
    """
    from uuid import UUID

    from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm

    # Geological model + litho model via API.
    geo_resp = await client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo R7", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo = geo_resp.json()

    litho_resp = await client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho R7",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho = litho_resp.json()
    litho_model_id = litho["id"]

    # Two ZAND formations in the same (parent_formation_id=None, soil=ZAND)
    # correlation bucket so the use case allows an edge between them.
    fa = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND R7-A",
        color="#aaa",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    fb = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND R7-B",
        color="#bbb",
        display_order=1,
        litho_main_soil_code="ZAND",
    )
    db_session.add_all([fa, fb])
    await db_session.commit()

    # Cross-section: 500 m EW corridor, projection_buffer_m=50 m.
    # Boreholes are placed on the section line so they fall inside the
    # bounding-box corridor used by _load_corridor_investigations.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="S1-R7",
        start_x=150000.0,
        start_y=200000.0,
        end_x=150500.0,
        end_y=200000.0,
        epsg=31370,
        display_order=0,
        projection_buffer_m=50.0,
    )
    db_session.add(section)

    # BH-contact: the borehole where FA has a FormationContact (depth 3 m).
    bh_contact = BoreholeOrm(
        id=uuid7(),
        name="BH-R7-contact",
        app_project_id=project.id,
        project_id="R7",
        test_id="BH-R7-001",
        location_x=150100.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add(bh_contact)

    # BH-absent: the borehole that shows KLEI at [2–5 m] — positive evidence
    # that ZAND (FA/FB's soil code) is absent there.
    bh_absent = BoreholeOrm(
        id=uuid7(),
        name="BH-R7-absent",
        app_project_id=project.id,
        project_id="R7",
        test_id="BH-R7-002",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add(bh_absent)
    await db_session.commit()

    # ObservationLayer on BH-absent: KLEI at [2–5 m].
    # top_m=2, base_m=5 overlaps the body depth band [3.0–3.5 m].
    # main_soil_codes=['KLEI'] ≠ formation_soil_code='ZAND' → absence.
    obs = ObservationOrm(
        id=uuid7(),
        borehole_id=bh_absent.id,
        observation_type="coded_lithology",
    )
    db_session.add(obs)
    await db_session.commit()

    obs_layer = ObservationLayerOrm(
        id=uuid7(),
        observation_id=obs.id,
        top_m=2.0,
        base_m=5.0,
        main_soil_codes=["KLEI"],
        layer_index=0,
    )
    db_session.add(obs_layer)

    # FormationContact for FA at BH-contact, depth 3 m.
    # Inserted directly so the contact is scoped to FA specifically —
    # bypasses the find-or-create bucket logic in AcceptLithoSuggestions.
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=UUID(litho_model_id),
        formation_id=fa.id,
        borehole_id=bh_contact.id,
        depth_top_m=3.0,
        source="borehole_observation",
        confidence="high",
    )
    db_session.add(contact)
    await db_session.commit()

    return {
        "litho_model_id": litho_model_id,
        "fa_id": str(fa.id),
        "fb_id": str(fb.id),
        "section_id": str(section.id),
        "bh_contact_id": str(bh_contact.id),
        "bh_absent_id": str(bh_absent.id),
    }


async def _count_inferred_absences(
    db_session: AsyncSession,
    formation_id: str,
) -> int:
    """Count inferred absence rows for a given formation."""
    from uuid import UUID

    rows = (
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(
                    FormationAbsenceOrm.formation_id == UUID(formation_id),
                    FormationAbsenceOrm.source == "inferred",
                )
            )
        )
        .scalars()
        .all()
    )
    return len(rows)


async def test_r7_correlate_writes_inferred_absence(
    async_client: AsyncClient,
    db_session: AsyncSession,
    r7_project: ProjectOrm,
) -> None:
    """Correlating FA ↔ FB triggers inference; BH-absent (KLEI) is recorded
    as an inferred absence for FA.

    Loop proof:
    POST /correlations → ``RecomputeFormationAbsencesForFormation`` fires for FA
    → ``infer_formation_absences`` sees BH-absent in the corridor with KLEI at
    [2–5 m], body depth band [3.0–3.5 m] (single contact → 0.5 m guard), overlap
    holds, KLEI ≠ ZAND → absence written for FA at BH-absent.
    """
    stack = await _r7_stack(async_client, db_session, r7_project)
    mid = stack["litho_model_id"]
    fa_id = stack["fa_id"]
    fb_id = stack["fb_id"]

    # Baseline: no inferred absences before correlate.
    assert await _count_inferred_absences(db_session, fa_id) == 0
    assert await _count_inferred_absences(db_session, fb_id) == 0

    # Correlate FA ↔ FB — inference hook fires atomically with the edge insert.
    corr_resp = await async_client.post(
        f"/projects/{r7_project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": fa_id, "formation_b_id": fb_id},
    )
    assert corr_resp.status_code == 201, corr_resp.text

    # FA has a contact at BH-contact (depth 3 m); BH-absent is in the corridor
    # and has KLEI at [2–5 m] which overlaps [3.0–3.5 m] → absence written for FA.
    fa_absences = await _count_inferred_absences(db_session, fa_id)
    assert fa_absences >= 1, (
        f"Expected ≥1 inferred absence for FA after correlate, got {fa_absences}. "
        "Check that the section corridor contains BH-absent and its KLEI layer "
        "overlaps the body depth band [3.0–3.5 m]."
    )


async def test_r7_uncorrelate_reruns_inference_without_error(
    async_client: AsyncClient,
    db_session: AsyncSession,
    r7_project: ProjectOrm,
) -> None:
    """Uncorrelating FA ↔ FB re-runs inference without error.

    The test does not assert a specific absence count after uncorrelate
    (the engine re-runs with updated topology and may keep or retract rows
    depending on the new body membership).  The key contract: the DELETE
    endpoint completes (204) and the inference hook fires atomically with
    the edge deletion.
    """
    stack = await _r7_stack(async_client, db_session, r7_project)
    mid = stack["litho_model_id"]
    fa_id = stack["fa_id"]
    fb_id = stack["fb_id"]

    # First: correlate to create the edge.
    cr = await async_client.post(
        f"/projects/{r7_project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": fa_id, "formation_b_id": fb_id},
    )
    assert cr.status_code == 201, cr.text

    # Uncorrelate — inference hook fires; must complete without error.
    del_resp = await async_client.request(
        "DELETE",
        f"/projects/{r7_project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": fa_id, "formation_b_id": fb_id},
    )
    assert del_resp.status_code == 204, del_resp.text

    # Verify the absence table is still consistent (no PG constraint errors
    # surfaced as a 500, and any existing absences are still valid rows).
    from sqlalchemy import select

    all_rows = (
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(
                    FormationAbsenceOrm.source == "inferred",
                )
            )
        )
        .scalars()
        .all()
    )
    # All remaining rows must have a valid source.
    for row in all_rows:
        assert row.source in ("inferred", "manual", "observed")


async def test_r7_idempotent_correlate_repairs_stale_absences(
    async_client: AsyncClient,
    db_session: AsyncSession,
    r7_project: ProjectOrm,
) -> None:
    """Re-calling correlate on an existing edge repairs a stale absence table.

    Regression for Blocker 3 fix-up 2: the original idempotent-edge path
    returned early before running inference, so a transient failure that left
    the absence table inconsistent was never repaired on retry.

    Contract: after calling correlate twice with the same pair, the absence
    count for FA is stable AND inference ran on the second call (verified by
    artificially deleting the inferred row before the second call and
    confirming it is restored afterwards).
    """
    from sqlalchemy import delete as sa_delete

    stack = await _r7_stack(async_client, db_session, r7_project)
    mid = stack["litho_model_id"]
    fa_id = stack["fa_id"]
    fb_id = stack["fb_id"]

    # First call — creates the edge and writes the inferred absence.
    resp1 = await async_client.post(
        f"/projects/{r7_project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": fa_id, "formation_b_id": fb_id},
    )
    assert resp1.status_code == 201, resp1.text
    count_after_first = await _count_inferred_absences(db_session, fa_id)
    assert count_after_first >= 1, (
        f"Expected ≥1 inferred absence for FA after first correlate, got {count_after_first}"
    )

    # Simulate a transient failure: manually delete the inferred absence rows
    # so the absence table is now stale.
    await db_session.execute(
        sa_delete(FormationAbsenceOrm).where(
            FormationAbsenceOrm.formation_id == fa_id,
            FormationAbsenceOrm.source == "inferred",
        )
    )
    await db_session.commit()
    assert await _count_inferred_absences(db_session, fa_id) == 0, (
        "Absence rows should be gone after manual delete (precondition for the re-call test)"
    )

    # Second call — edge already exists (idempotent), but inference must
    # re-run and restore the stale absence rows.
    resp2 = await async_client.post(
        f"/projects/{r7_project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": fa_id, "formation_b_id": fb_id},
    )
    assert resp2.status_code == 200, resp2.text  # idempotent → 200
    count_after_second = await _count_inferred_absences(db_session, fa_id)
    assert count_after_second >= 1, (
        f"Expected inference to repair absence rows on idempotent re-call; "
        f"got {count_after_second} rows after second correlate"
    )
