"""HTTP-level tests for the body extent endpoints.

Coverage:
  C1  POST /models/{mid}/bodies with a detector-set 'to_target' extent on the
      target side returns 409 + ``{"code": "provenance_violation"}``, not 422.

  S4  Cross-project IDOR regression tests — every body endpoint returns 404
      (not 200 or 403) when the URL's project_id / model_id belongs to a
      different project than the body / model being addressed.

These tests assert routing + error-mapping only.  Use-case semantics (the
provenance rule itself) are pinned by ``test_claim_body_extent.py``.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.correlate_litho_contacts import CorrelateLithoContacts
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def bodies_api_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm, BoreholeOrm, BoreholeOrm]:
    """Minimal project + lithostratigraphic model + formation + two boreholes."""
    project = ProjectOrm(id=uuid7(), name="Bodies API test", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-API",
        kind="geological",
    )
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-API",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI-API",
        color="#aabbcc",
        display_order=0,
        instance_ordinal=0,
    )
    db_session.add(formation)
    await db_session.flush()

    bh_source = BoreholeOrm(
        id=uuid7(),
        name="BH-SRC",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-SRC-API",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    bh_neighbour = BoreholeOrm(
        id=uuid7(),
        name="BH-NBR",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-NBR-API",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_source, bh_neighbour])
    await db_session.commit()
    return project, litho, formation, bh_source, bh_neighbour


# ---------------------------------------------------------------------------
# C1: provenance violation → 409, not 422
# ---------------------------------------------------------------------------


import pytest  # noqa: E402  (after fixture import so ruff is happy)


@pytest.mark.asyncio
async def test_claim_body_extent_provenance_violation_returns_409(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """C1 (audit fix): POST /models/{mid}/bodies when the requested side already
    carries a detector-set ``to_target`` extent must return 409 + a body with
    ``code == 'provenance_violation'``, NOT 422.

    This is the guard that makes ``ProvenanceConflictDialog`` reachable on the
    frontend — the frontend gates the dialog open on HTTP 409 (a
    ``ProvenanceViolationError`` from the API client).
    """
    project, litho, formation, bh_source, bh_neighbour = bodies_api_fixture

    # Pre-seed a body row with the left side already detector-claimed as
    # 'to_target' — simulates what DetectBodies produces.
    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add(body)
    await db_session.commit()

    # Now try to claim the left side as 'pinch_out_halfway' — must be blocked.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho.id}/bodies",
        json={
            "body_id": str(body.id),
            "side": "left",
            "kind": EXTENT_KIND_PINCH_OUT_HALFWAY,
            "neighbour_inv_id": str(bh_neighbour.id),
        },
    )

    # Must be 409, not 422.
    assert resp.status_code == 409, (
        f"Expected 409 Conflict for provenance violation, got {resp.status_code}: {resp.text}"
    )
    body_json = resp.json()
    assert body_json.get("detail", {}).get("code") == "provenance_violation", (
        f"Expected code='provenance_violation' in detail, got: {body_json}"
    )


@pytest.mark.asyncio
async def test_claim_body_extent_other_validation_errors_still_return_422(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """Plain validation errors (invalid side, missing neighbour, etc.) must still
    return 422 — 409 is reserved for the provenance-violation path only.
    """
    project, litho, formation, bh_source, bh_neighbour = bodies_api_fixture

    # Invalid 'side' → must be a 422 validation error, not 409.
    # Note: 'side' is validated by Pydantic at the schema level (it's a
    # Literal['left','right'] field), so the 422 detail shape is FastAPI's
    # standard list-of-errors, not our {"code": ...} dict.  We assert the
    # status code only; the key requirement is that it is NOT 409.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho.id}/bodies",
        json={
            "body_id": str(uuid7()),  # any UUID — side fails Pydantic first
            "side": "centre",  # invalid — neither 'left' nor 'right'
            "kind": EXTENT_KIND_PINCH_OUT_HALFWAY,
            "neighbour_inv_id": str(bh_neighbour.id),
        },
    )

    assert resp.status_code == 422, (
        f"Expected 422 for invalid-side error, got {resp.status_code}: {resp.text}"
    )
    # Confirm we are NOT getting a 409 provenance-violation response.
    assert resp.status_code != 409


# ---------------------------------------------------------------------------
# S4: Cross-project IDOR regression tests
# ---------------------------------------------------------------------------
# Pattern: project A owns a model + body; requests use project B's id in
# the URL path.  Every endpoint must return 404, not 200 or 403.
# 404 is the correct response (the existing pattern — avoids leaking
# existence information to the caller).
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def idor_fixture(
    db_session: AsyncSession,
) -> dict:
    """Two independent projects, each with a lithostratigraphic model.

    project_a owns:
      - model_a (lithostratigraphic)
      - formation_a
      - bh_a (source investigation)
      - bh_a_neighbour
      - body_a (formation_a, ordinal=0, extent_left=to_target → bh_a_neighbour)

    project_b owns:
      - model_b (lithostratigraphic, geological parent model_b_geo)

    The IDOR tests hit project_a endpoints using project_b's id (and
    vice-versa where noted) — the scope guards must reject all of them.
    """
    # ---- project A ---------------------------------------------------------
    project_a = ProjectOrm(id=uuid7(), name="IDOR-project-A", status="active")
    db_session.add(project_a)
    await db_session.flush()

    geo_a = GeologicalModelOrm(
        id=uuid7(), app_project_id=project_a.id, name="Geo-A", kind="geological"
    )
    model_a = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_a.id,
        name="Litho-A",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_a.id,
    )
    db_session.add_all([geo_a, model_a])
    await db_session.flush()

    formation_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_a.id,
        name="KLEI-A",
        color="#aabbcc",
        display_order=0,
        instance_ordinal=0,
    )
    db_session.add(formation_a)
    await db_session.flush()

    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-A-SRC",
        app_project_id=project_a.id,
        project_id="IDOR",
        test_id="BH-A-SRC-IDOR",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    bh_a_neighbour = BoreholeOrm(
        id=uuid7(),
        name="BH-A-NBR",
        app_project_id=project_a.id,
        project_id="IDOR",
        test_id="BH-A-NBR-IDOR",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_a, bh_a_neighbour])
    await db_session.flush()

    body_a = BodyOrm(
        id=uuid7(),
        app_project_id=project_a.id,
        model_id=model_a.id,
        formation_id=formation_a.id,
        body_ordinal=0,
        source_investigation_id=bh_a.id,
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_a_neighbour.id,
    )
    db_session.add(body_a)

    # ---- project B (only needs its own lithostratigraphic model) -----------
    project_b = ProjectOrm(id=uuid7(), name="IDOR-project-B", status="active")
    db_session.add(project_b)
    await db_session.flush()

    geo_b = GeologicalModelOrm(
        id=uuid7(), app_project_id=project_b.id, name="Geo-B", kind="geological"
    )
    model_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_b.id,
        name="Litho-B",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_b.id,
    )
    db_session.add_all([geo_b, model_b])

    await db_session.commit()

    return {
        "project_a": project_a,
        "project_b": project_b,
        "model_a": model_a,
        "model_b": model_b,
        "formation_a": formation_a,
        "bh_a": bh_a,
        "bh_a_neighbour": bh_a_neighbour,
        "body_a": body_a,
    }


@pytest.mark.asyncio
async def test_idor_detect_bodies_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: POST /projects/{B}/geology/models/{A-model}/bodies/detect → 404.

    model_a belongs to project_a; using project_b's id in the URL must
    be rejected by the model scope guard.
    """
    f = idor_fixture
    resp = await async_client.post(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies/detect"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on detect: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_suggest_pinch_outs_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: POST /projects/{B}/geology/models/{A-model}/bodies/suggest-pinch-outs → 404."""
    f = idor_fixture
    resp = await async_client.post(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies/suggest-pinch-outs"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on suggest-pinch-outs: expected 404, "
        f"got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_list_bodies_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: GET /projects/{B}/geology/models/{A-model}/bodies → 404."""
    f = idor_fixture
    resp = await async_client.get(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on list bodies: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_claim_body_extent_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: POST /projects/{B}/geology/models/{A-model}/bodies (claim) → 404."""
    f = idor_fixture
    resp = await async_client.post(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies",
        json={
            "body_id": str(f["body_a"].id),
            "side": "right",
            "kind": "open",
        },
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on claim: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_patch_body_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: PATCH /projects/{B}/geology/models/{A-model}/bodies/{A-body} → 404.

    NameBodyRequest requires ``formation_id`` + ``name`` — we supply both so
    Pydantic passes and the real scope guard (body.app_project_id != project_b)
    is actually exercised.
    """
    f = idor_fixture
    resp = await async_client.patch(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies/{f['body_a'].id}",
        json={
            "formation_id": str(f["formation_a"].id),
            "name": "attempted rename",
        },
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on PATCH body: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_delete_body_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: DELETE /projects/{B}/geology/models/{A-model}/bodies/{A-body} → 404."""
    f = idor_fixture
    resp = await async_client.delete(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies/{f['body_a'].id}"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on DELETE body: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_clear_body_extent_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: DELETE /projects/{B}/geology/models/{A-model}/bodies/{A-body}/extents/left → 404."""
    f = idor_fixture
    resp = await async_client.delete(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}"
        f"/bodies/{f['body_a'].id}/extents/left"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on clear extent: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_get_body_boundary_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: GET /projects/{B}/geology/models/{A-model}/bodies/{A-body}/boundary → 404."""
    f = idor_fixture
    resp = await async_client.get(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}"
        f"/bodies/{f['body_a'].id}/boundary"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on GET boundary: expected 404, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_idor_put_body_boundary_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: PUT /projects/{B}/geology/models/{A-model}/bodies/{A-body}/boundary → 404."""
    f = idor_fixture
    resp = await async_client.put(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}"
        f"/bodies/{f['body_a'].id}/boundary",
        json={"upper_nodes": [], "lower_nodes": [], "render_style": "straight"},
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on PUT boundary: expected 404, got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# CDB: bulk "Delete all detected lenses" (DeleteDetectedBodies)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_detected_bodies_preserves_named_and_claimed(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """CDB1: DELETE /models/{mid}/bodies removes only purely-detected bodies.

    Three bodies of one formation (distinct ordinals): a purely-detected one
    (``to_target``, unnamed), a user-named one, and a user-claimed one
    (``pinch_out_halfway``).  The bulk delete must drop only the first and
    report ``bodies_deleted=1, bodies_preserved=2`` — the named + claimed
    ("accepted") bodies survive.
    """
    project, litho, formation, bh_source, bh_neighbour = bodies_api_fixture

    detected = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    named = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=1,
        source_investigation_id=bh_source.id,
        name="Keeper lens",
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    claimed = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=2,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add_all([detected, named, claimed])
    await db_session.commit()

    resp = await async_client.delete(f"/projects/{project.id}/geology/models/{litho.id}/bodies")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload == {"bodies_deleted": 1, "bodies_preserved": 2}

    # The detected body is gone; the named + claimed survive.
    list_resp = await async_client.get(f"/projects/{project.id}/geology/models/{litho.id}/bodies")
    assert list_resp.status_code == 200, list_resp.text
    remaining_ids = {row["id"] for row in list_resp.json()}
    assert str(detected.id) not in remaining_ids
    assert str(named.id) in remaining_ids
    assert str(claimed.id) in remaining_ids


@pytest.mark.asyncio
async def test_idor_delete_detected_bodies_wrong_project_404(
    async_client: AsyncClient,
    idor_fixture: dict,
) -> None:
    """S4: DELETE /projects/{B}/geology/models/{A-model}/bodies → 404."""
    f = idor_fixture
    resp = await async_client.delete(
        f"/projects/{f['project_b'].id}/geology/models/{f['model_a'].id}/bodies"
    )
    assert resp.status_code == 404, (
        f"IDOR guard failure on bulk delete: expected 404, got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# DSH: "Detect" self-heals after the user clears all bodies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_detect_rematerialises_bodies_after_clear_all(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """DSH1: clearing every body then clicking "Detect" must rebuild the bodies.

    Reproduces the dogfeed bug: bodies are derived from the user-approved
    correlation graph and OWNED by the resolver, which is the only authority
    that creates ``body`` rows and stamps ``litho_layer.body_id``.  When the
    user clears all bodies ("Delete all detected" + dissolves), the
    ``ondelete=SET NULL`` FK wipes every layer's ``body_id`` stamp.

    The body's defining correlation edges are still intact, so the body is
    still IMPLIED by the graph — clicking "Detect" must re-materialise it.
    Before the fix the detect endpoint ran ``DetectBodies`` alone (a pure
    extent manager that cannot create bodies), so it found ``body_id IS NULL``
    on every framed layer, skipped every closure, and silently created
    nothing — leaving "Materialise companions" with no body to act on.

    Topology mirrors ``test_detect_bodies.py`` Test 1: a bilateral #135
    closure from one source borehole to two distinct neighbours.
    """
    project, litho, formation, bh_source, bh_neighbour = bodies_api_fixture

    # A second neighbour so the closure is bilateral (≥2 distinct targets) —
    # the detector requires bilateral closure to materialise a body.
    bh_neighbour_2 = BoreholeOrm(
        id=uuid7(),
        name="BH-NBR2",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-NBR2-API",
        location_x=149700.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    # Three formations on the source column (cap / body / cap) + one shared
    # neighbour formation, all children of the geological parent formation.
    f_top = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND top cap DSH",
        color="#aabbcc",
        display_order=0,
        parent_formation_id=formation.id,
        litho_main_soil_code="ZAND",
    )
    f_body = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI body DSH",
        color="#aabbcc",
        display_order=0,
        parent_formation_id=formation.id,
        litho_main_soil_code="KLEI",
    )
    f_base = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND base cap DSH",
        color="#aabbcc",
        display_order=0,
        parent_formation_id=formation.id,
        litho_main_soil_code="ZAND",
    )
    f_nbr = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND nbr DSH",
        color="#aabbcc",
        display_order=0,
        parent_formation_id=formation.id,
        litho_main_soil_code="ZAND",
    )
    db_session.add_all([bh_neighbour_2, f_top, f_body, f_base, f_nbr])
    await db_session.flush()

    def _c(form: GeologicalFormationOrm, bh: BoreholeOrm, depth: float) -> FormationContactOrm:
        return FormationContactOrm(
            id=uuid7(),
            model_id=litho.id,
            formation_id=form.id,
            borehole_id=bh.id,
            depth_top_m=depth,
            source="borehole_observation",
            confidence="medium",
        )

    c_top = _c(f_top, bh_source, 2.0)
    c_body = _c(f_body, bh_source, 4.0)
    c_base = _c(f_base, bh_source, 6.0)
    c_nbr_1 = _c(f_nbr, bh_neighbour, 3.0)
    c_nbr_2 = _c(f_nbr, bh_neighbour_2, 3.0)
    db_session.add_all([c_top, c_body, c_base, c_nbr_1, c_nbr_2])
    await db_session.commit()

    # Four correlate gestures form the bilateral #135 closure.  Each runs the
    # resolver, so bodies + body_id stamps exist after this block.
    for ca, cb in (
        (c_body, c_nbr_1),
        (c_base, c_nbr_1),
        (c_body, c_nbr_2),
        (c_base, c_nbr_2),
    ):
        await CorrelateLithoContacts(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            contact_a_id=ca.id,
            contact_b_id=cb.id,
        )

    base_url = f"/projects/{project.id}/geology/models/{litho.id}"

    # First Detect — sets to_target extents on the resolver-owned body.
    first = await async_client.post(f"{base_url}/bodies/detect")
    assert first.status_code == 200, first.text
    assert first.json()["bodies_created"] >= 1, (
        f"Setup precondition: first detect should set extents, got {first.json()}"
    )

    # Clear EVERY body — the user's "Delete all detected" gesture.  The
    # ondelete=SET NULL FK now wipes the body_id stamp on all layers.
    cleared = await async_client.delete(f"{base_url}/bodies")
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["bodies_deleted"] >= 1

    list_after_clear = await async_client.get(f"{base_url}/bodies")
    assert list_after_clear.json() == [], "Clear-all must leave zero bodies"

    # Second Detect — the bug: with no resolver run, this found body_id IS NULL
    # on every framed layer and created nothing.  The fix makes Detect run the
    # resolver first, so the body re-materialises from the still-intact
    # correlation graph.  bodies_created >= 1 is only reachable when the layers
    # were re-stamped, since DetectBodies can only set an extent on a
    # resolver-owned body_id — this transitively proves the re-stamp.
    healed = await async_client.post(f"{base_url}/bodies/detect")
    assert healed.status_code == 200, healed.text
    assert healed.json()["bodies_created"] >= 1, (
        "Detect must re-materialise the body after a clear-all; "
        f"got {healed.json()} (resolver did not run before DetectBodies)"
    )

    # A body row exists again.
    list_after_heal = await async_client.get(f"{base_url}/bodies")
    assert len(list_after_heal.json()) >= 1, "Detect must rebuild at least one body row"
