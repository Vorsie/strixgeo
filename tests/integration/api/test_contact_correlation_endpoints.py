"""HTTP-level tests for the new contact-correlation endpoints (#133 Phase 2).

Covers:
  POST   .../contact-correlations/auto       → 200 + count shape
  POST   .../contact-correlations/accept     → 200 + count shape
  POST   .../lens-companions/materialise     → 200 + count shape
  GET    .../contact-correlations            → user_approved in each item
  POST   .../contact-correlations            → requires a valid request_section_id (section-scoped)
  DELETE .../contact-correlations            → request_section_id accepted (not enforced on delete)

These tests assert routing, JSON shape, and scope guards; they do NOT re-pin
the underlying use-case semantics (those are covered by the application-layer
integration tests).
"""

from __future__ import annotations

from uuid import UUID

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project_with_two_boreholes(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, BoreholeOrm, BoreholeOrm]:
    """Minimal project + two boreholes at distinct coordinates."""
    project = ProjectOrm(id=uuid7(), name="CC endpoint test", status="active")
    db_session.add(project)
    await db_session.flush()

    bh1 = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="TEST",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    bh2 = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=project.id,
        project_id="TEST",
        test_id="BH-002",
        location_x=150050.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add_all([bh1, bh2])
    await db_session.commit()
    return project, bh1, bh2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_formation(client: AsyncClient, project_id) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/formations",
        json={"name": "F1", "color": "#abc"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_model(client: AsyncClient, project_id) -> dict:  # noqa: ANN001
    # litho_contact_correlation_edge is litho-only by design (the FK target
    # is litho_layer post A4 slice 4a). Force kind='lithostratigraphic' so
    # the FC→LL mirror trigger materialises the layer rows the FK requires.
    # A litho model needs a parent geological model — create one first.
    parent = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": "Parent geo", "kind": "geological"},
    )
    assert parent.status_code == 201, parent.text
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={
            "name": "Model",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": parent.json()["id"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_contact(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    model_id: str,
    formation_id: str,
    borehole_id,  # noqa: ANN001
    *,
    depth: float,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{model_id}/contacts",
        json={
            "formation_id": formation_id,
            "borehole_id": str(borehole_id),
            "depth_top_m": depth,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_edge(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    model_id: str,
    contact_a_id: str,
    contact_b_id: str,
    *,
    request_section_id: str,
) -> dict:
    """POST a manual contact-correlation edge.

    Parameters
    ----------
    request_section_id : str
        The section this edge is authored on.  ``CorrelateLithoContacts``
        requires a non-null section_id (section-scoped invariant,
        owner directive 2026-06-08).
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{model_id}/contact-correlations",
        json={
            "contact_a_id": contact_a_id,
            "contact_b_id": contact_b_id,
            "request_section_id": request_section_id,
        },
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


async def _create_section(client: AsyncClient, project_id) -> str:  # noqa: ANN001
    """Create a minimal section via the API and return its id as a string.

    Used to satisfy the ``request_section_id`` NOT NULL invariant added in
    Task 3 of the section-scoped correlations feature (owner directive
    2026-06-08).
    """
    resp = await client.post(
        f"/projects/{project_id}/sections",
        json={
            "name": "Sec-test",
            "start_x": 149900.0,
            "start_y": 200000.0,
            "end_x": 150500.0,
            "end_y": 200000.0,
            "epsg": 31370,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# GET /contact-correlations — user_approved field present
# ---------------------------------------------------------------------------


async def test_list_contact_correlations_includes_user_approved(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """Each item returned by GET must carry the user_approved field (#133 Phase 2)."""
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    formation = await _create_formation(async_client, pid)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    sid = await _create_section(async_client, pid)
    c1 = await _create_contact(async_client, pid, mid, formation["id"], bh1.id, depth=2.0)
    c2 = await _create_contact(async_client, pid, mid, formation["id"], bh2.id, depth=2.0)
    await _create_edge(async_client, pid, mid, c1["id"], c2["id"], request_section_id=sid)

    resp = await async_client.get(f"/projects/{pid}/geology/models/{mid}/contact-correlations")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert "user_approved" in items[0], "user_approved must be present in list items"
    # Manual edge → implicitly approved
    assert items[0]["user_approved"] is True
    # I1: section_id must be present and equal to the section the edge was authored on.
    assert "section_id" in items[0], (
        "section_id must be present in list items (I1 — TS type LithoContactCorrelationEdge "
        "declares section_id: string; the API must return it)"
    )
    assert items[0]["section_id"] == sid, (
        f"section_id must equal the authored section; got {items[0]['section_id']!r}, "
        f"expected {sid!r}"
    )


# ---------------------------------------------------------------------------
# POST /contact-correlations — request_section_id forwarded without error
# ---------------------------------------------------------------------------


async def test_create_contact_correlation_with_request_section_id(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST with request_section_id in body succeeds when the section exists."""
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    formation = await _create_formation(async_client, pid)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    # section_id must now be a real section (NOT NULL FK, section-scoped invariant
    # owner directive 2026-06-08). Create one via the API.
    real_section_id = await _create_section(async_client, pid)

    c1 = await _create_contact(async_client, pid, mid, formation["id"], bh1.id, depth=3.0)
    c2 = await _create_contact(async_client, pid, mid, formation["id"], bh2.id, depth=3.0)

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations",
        json={
            "contact_a_id": c1["id"],
            "contact_b_id": c2["id"],
            "request_section_id": real_section_id,
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["was_created"] is True


# ---------------------------------------------------------------------------
# DELETE /contact-correlations — request_section_id forwarded without error
# ---------------------------------------------------------------------------


async def test_delete_contact_correlation_with_request_section_id(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """DELETE with request_section_id in body returns 204 (no error on unknown section)."""
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    formation = await _create_formation(async_client, pid)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    sid = await _create_section(async_client, pid)
    c1 = await _create_contact(async_client, pid, mid, formation["id"], bh1.id, depth=4.0)
    c2 = await _create_contact(async_client, pid, mid, formation["id"], bh2.id, depth=4.0)
    await _create_edge(async_client, pid, mid, c1["id"], c2["id"], request_section_id=sid)

    # DELETE with a section_id in the body is allowed (request_section_id is
    # optional on delete and does not affect which row is removed).
    # httpx.AsyncClient.delete() does not accept a JSON body directly —
    # use the generic request() method which does.
    resp = await async_client.request(
        "DELETE",
        f"/projects/{pid}/geology/models/{mid}/contact-correlations",
        json={
            "contact_a_id": c1["id"],
            "contact_b_id": c2["id"],
            "request_section_id": sid,
        },
    )
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# POST /contact-correlations/auto — 200 + count shape
# ---------------------------------------------------------------------------


async def test_auto_correlate_returns_200_with_count_shape(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /auto on a model with no contacts returns 200 + the four expected fields."""
    project, _bh1, _bh2 = project_with_two_boreholes
    pid = str(project.id)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    # section_id is required (section-scoped invariant, owner directive 2026-06-08).
    sid = await _create_section(async_client, pid)

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/auto",
        json={"section_id": sid},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "edges_created" in body
    assert "edges_skipped_existing" in body
    assert isinstance(body["edges_created"], int)
    assert isinstance(body["edges_skipped_existing"], int)


async def test_auto_correlate_404_on_unknown_model(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /auto with an unknown model_id returns 404."""
    project, _bh1, _bh2 = project_with_two_boreholes
    pid = str(project.id)
    unknown_mid = str(uuid7())

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{unknown_mid}/contact-correlations/auto"
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /contact-correlations/accept — 200 + count shape
# ---------------------------------------------------------------------------


async def test_accept_returns_200_with_count_shape(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /accept with no unapproved edges returns 200 + all four counters."""
    project, _bh1, _bh2 = project_with_two_boreholes
    pid = str(project.id)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/accept",
        json={},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for field in ("edges_accepted", "bodies_created", "bodies_removed", "ordinals_changed"):
        assert field in body, f"Missing field: {field}"
        assert isinstance(body[field], int)


async def test_accept_with_section_id_returns_200(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /accept with a section_id that exists on the project returns 200."""
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    # Create a section so section_id is valid.
    sec_resp = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "S1",
            "start_x": 150000.0,
            "start_y": 200000.0,
            "end_x": 150100.0,
            "end_y": 200000.0,
            "epsg": 31370,
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    sid = sec_resp.json()["id"]

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/accept",
        json={"section_id": sid},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["edges_accepted"] == 0  # nothing unapproved yet


async def test_accept_404_on_unknown_model(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /accept with an unknown model_id returns 404."""
    project, _bh1, _bh2 = project_with_two_boreholes
    pid = str(project.id)
    unknown_mid = str(uuid7())

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{unknown_mid}/contact-correlations/accept",
        json={},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /lens-companions/materialise — 200 + count shape
# ---------------------------------------------------------------------------


async def test_materialise_returns_200_with_count_shape(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /lens-companions/materialise on an empty model returns 200 + four counters."""
    project, _bh1, _bh2 = project_with_two_boreholes
    pid = str(project.id)
    model = await _create_model(async_client, pid)
    mid = model["id"]

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/lens-companions/materialise"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for field in (
        "companion_sections_created",
        "skipped_no_primary",
        "skipped_unfinished_section",
        "errored",
    ):
        assert field in body, f"Missing field: {field}"
        assert isinstance(body[field], int)


async def test_materialise_404_on_unknown_model(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """POST /lens-companions/materialise with an unknown model_id returns 404."""
    project, _bh1, _bh2 = project_with_two_boreholes
    pid = str(project.id)
    unknown_mid = str(uuid7())

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{unknown_mid}/lens-companions/materialise"
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /contact-correlations/auto — "Clear suggestions" (#179)
# ---------------------------------------------------------------------------


async def test_clear_suggestions_removes_unapproved_and_can_re_run(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """Clear-suggestions deletes the unapproved auto edges; re-running
    auto-correlate recreates them (proving they were truly cleared, #179)."""
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    mid = (await _create_model(async_client, pid))["id"]
    f = await _create_formation(async_client, pid)
    c1 = await _create_contact(async_client, pid, mid, f["id"], bh1.id, depth=3.0)
    c2 = await _create_contact(async_client, pid, mid, f["id"], bh2.id, depth=3.0)
    assert c1 and c2

    # section_id is required for auto-correlate (section-scoped invariant, 2026-06-08).
    sid = await _create_section(async_client, pid)

    auto = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/auto",
        json={"section_id": sid},
    )
    n = auto.json()["edges_created"]
    assert n >= 1, "setup: auto-correlate should have created a suggestion"

    cleared = await async_client.delete(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/auto"
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted"] == n

    listed = await async_client.get(f"/projects/{pid}/geology/models/{mid}/contact-correlations")
    assert listed.json() == [], "all edges were unapproved → none remain"

    auto2 = await async_client.post(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/auto",
        json={"section_id": sid},
    )
    assert auto2.json()["edges_created"] == n, "cleared edges regenerate on re-run"


async def test_clear_suggestions_keeps_approved_manual_edge(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """Clear-suggestions leaves approved (manual) correlations intact (#179)."""
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    mid = (await _create_model(async_client, pid))["id"]
    f = await _create_formation(async_client, pid)
    c1 = await _create_contact(async_client, pid, mid, f["id"], bh1.id, depth=4.0)
    c2 = await _create_contact(async_client, pid, mid, f["id"], bh2.id, depth=4.0)
    sid = await _create_section(async_client, pid)
    await _create_edge(
        async_client, pid, mid, c1["id"], c2["id"], request_section_id=sid
    )  # manual → approved

    cleared = await async_client.delete(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/auto"
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted"] == 0

    listed = await async_client.get(f"/projects/{pid}/geology/models/{mid}/contact-correlations")
    assert len(listed.json()) == 1, "the approved manual edge must survive"


async def test_clear_suggestions_404_on_unknown_model(
    async_client: AsyncClient,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """DELETE /contact-correlations/auto with an unknown model returns 404."""
    project, _bh1, _bh2 = project_with_two_boreholes
    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{uuid7()}/contact-correlations/auto"
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Section-scoped list + clear-suggestions.  ``?section_id=`` restricts BOTH the
# list and the auto-delete to edges AUTHORED on that section
# (``edge.section_id == section_id``), so re-correlating one section never
# reports or wipes another section's auto edges (section-scoped correlations,
# owner directive 2026-06-08).
# ---------------------------------------------------------------------------


async def test_section_scoped_list_and_clear_preserves_off_section_edges(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_two_boreholes: tuple[ProjectOrm, BoreholeOrm, BoreholeOrm],
) -> None:
    """``?section_id=`` scopes list + delete by the edge's OWN section_id column.

    Owner directive 2026-06-08: an edge belongs to the section it was AUTHORED
    on, not "any section that projects both endpoints".  Filtering is a direct
    equality check on ``litho_contact_correlation_edge.section_id``.

    Setup
    -----
    * Two sections S1 and S2.  bh1 and bh2 lie in BOTH corridors (they are
      close enough that either section would project them — so the OLD
      projection-based filter would return both edges for S2 too).
    * Edge E1 (c1 ↔ c2) is authored on S1   → section_id = S1.
    * Edge E2 (c2 ↔ c3) is authored on S2   → section_id = S2.

    Assertions
    ----------
    * GET ?section_id=S1 returns E1 only (not E2).
    * GET ?section_id=S2 returns E2 only (not E1).
    * DELETE /auto?section_id=S1 removes E1 (count=1); E2 survives.
    * Model-wide list after delete shows only E2.
    """
    project, bh1, bh2 = project_with_two_boreholes
    pid = str(project.id)
    f = await _create_formation(async_client, pid)
    mid = (await _create_model(async_client, pid))["id"]

    # Third borehole: same corridor as bh1/bh2 (y=200000) so projection-based
    # logic would include it on BOTH sections.  Its edge is authored on S2.
    bh3 = BoreholeOrm(
        id=uuid7(),
        name="BH-3",
        app_project_id=project.id,
        project_id="TEST",
        test_id="BH-003",
        location_x=150075.0,
        location_y=200000.0,  # same y → in both section corridors
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(bh3)
    await db_session.commit()

    c1 = await _create_contact(async_client, pid, mid, f["id"], bh1.id, depth=3.0)
    c2 = await _create_contact(async_client, pid, mid, f["id"], bh2.id, depth=3.0)
    c3 = await _create_contact(async_client, pid, mid, f["id"], bh3.id, depth=3.0)

    # Both sections run along y=200000 and include all three boreholes in their
    # corridors — ensuring the OLD projection-based filter would return BOTH edges
    # for either section (true RED against the pre-Task-5 code).
    sec1 = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec S1",
        start_x=149900.0,
        start_y=200000.0,
        end_x=150200.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=5.0,
    )
    sec2 = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec S2",
        start_x=149900.0,
        start_y=200000.0,
        end_x=150200.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=5.0,
    )
    db_session.add_all([sec1, sec2])
    await db_session.flush()
    sid1 = str(sec1.id)
    sid2 = str(sec2.id)

    # E1 authored on S1; E2 authored on S2.  canonical-ordered.
    def _edge(a: str, b: str, section: CrossSectionOrm) -> LithoContactCorrelationEdgeOrm:
        lo, hi = sorted((UUID(a), UUID(b)))
        return LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=UUID(mid),
            contact_a_id=lo,
            contact_b_id=hi,
            source="auto",
            user_approved=False,
            section_id=section.id,
        )

    e1 = _edge(c1["id"], c2["id"], sec1)
    e2 = _edge(c2["id"], c3["id"], sec2)
    db_session.add_all([e1, e2])
    await db_session.commit()
    e1_id = str(e1.id)
    e2_id = str(e2.id)

    # Model-wide: both edges present.
    all_edges = (
        await async_client.get(f"/projects/{pid}/geology/models/{mid}/contact-correlations")
    ).json()
    assert len(all_edges) == 2

    # Section-scoped list: S1 → only E1 (authored on S1).
    s1_edges = (
        await async_client.get(
            f"/projects/{pid}/geology/models/{mid}/contact-correlations?section_id={sid1}"
        )
    ).json()
    assert len(s1_edges) == 1, "S1 list must contain only the edge authored on S1"
    assert s1_edges[0]["id"] == e1_id, "the returned edge must be E1 (authored on S1)"

    # Section-scoped list: S2 → only E2 (authored on S2), NOT E1.
    s2_edges = (
        await async_client.get(
            f"/projects/{pid}/geology/models/{mid}/contact-correlations?section_id={sid2}"
        )
    ).json()
    assert len(s2_edges) == 1, "S2 list must contain only the edge authored on S2"
    assert s2_edges[0]["id"] == e2_id, "S2 list must contain exactly E2 (authored on S2)"
    assert s2_edges[0]["id"] != e1_id, "E1 must NOT appear in the S2-scoped list"

    # Section-scoped delete on S1 removes E1 only (count=1); E2 survives.
    cleared = await async_client.delete(
        f"/projects/{pid}/geology/models/{mid}/contact-correlations/auto?section_id={sid1}"
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted"] == 1

    remaining = (
        await async_client.get(f"/projects/{pid}/geology/models/{mid}/contact-correlations")
    ).json()
    assert len(remaining) == 1, "E2 (authored on S2) must survive the S1-scoped clear"
    assert remaining[0]["id"] != e1_id, "the surviving edge must be E2, not E1"
