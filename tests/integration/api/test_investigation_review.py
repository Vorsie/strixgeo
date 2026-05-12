"""HTTP-level tests for the investigation_review router (debt #22).

Covers the two specific gaps the debt note called out, plus the
view-state shallow-merge contract that lives in the same module:

* ``_target_exists_in_project`` 404 path on PUT.
* DELETE silent-204 on a wrong-project hit (deliberate asymmetry
  with PUT, designed not to leak review-id existence across
  project boundaries).
* PATCH /view-state: shallow-merge keeps siblings untouched;
  ``null`` removes a key.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def two_projects_with_boreholes(
    db_session: AsyncSession,
) -> tuple[tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]]:
    """Set up two projects, each owning one borehole.

    Returned as ``(A, B)`` where each tuple is ``(project, borehole)``.
    Used by the cross-project tampering checks.
    """
    project_a = ProjectOrm(id=uuid7(), name="Project A", status="active")
    project_b = ProjectOrm(id=uuid7(), name="Project B", status="active")
    db_session.add_all([project_a, project_b])
    await db_session.flush()

    bh_a = BoreholeOrm(
        id=uuid7(),
        name="A-BH",
        app_project_id=project_a.id,
        project_id="DOV",
        test_id="A-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    bh_b = BoreholeOrm(
        id=uuid7(),
        name="B-BH",
        app_project_id=project_b.id,
        project_id="DOV",
        test_id="B-001",
        location_x=151000.0,
        location_y=201000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add_all([bh_a, bh_b])
    await db_session.commit()
    return (project_a, bh_a), (project_b, bh_b)


# ---------------------------------------------------------------------------
# PUT — target-in-project 404
# ---------------------------------------------------------------------------


async def test_put_review_against_unknown_target_returns_404(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """A target id with no matching row in the project gets rejected."""
    (project_a, _), _ = two_projects_with_boreholes
    bogus_target = uuid7()

    resp = await async_client.put(
        f"/projects/{project_a.id}/reviews/borehole/{bogus_target}",
        json={"review_status": "reviewed"},
    )

    assert resp.status_code == 404
    assert "borehole" in resp.json()["detail"]


async def test_put_review_against_wrong_project_target_returns_404(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """A real borehole id from project B can't be reviewed under project A's URL."""
    (project_a, _), (_, bh_b) = two_projects_with_boreholes

    resp = await async_client.put(
        f"/projects/{project_a.id}/reviews/borehole/{bh_b.id}",
        json={"review_status": "reviewed"},
    )

    assert resp.status_code == 404


async def test_put_review_in_correct_project_creates_and_then_updates(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """PUT is idempotent — second call updates the row instead of duplicating."""
    (project_a, bh_a), _ = two_projects_with_boreholes
    url = f"/projects/{project_a.id}/reviews/borehole/{bh_a.id}"

    first = await async_client.put(url, json={"review_status": "in_progress"})
    assert first.status_code == 200
    assert first.json()["review_status"] == "in_progress"
    assert first.json()["reviewed_at"] is None

    second = await async_client.put(
        url, json={"review_status": "reviewed", "review_notes": "Looks fine"}
    )
    assert second.status_code == 200
    body = second.json()
    assert body["id"] == first.json()["id"]
    assert body["review_status"] == "reviewed"
    assert body["review_notes"] == "Looks fine"
    # Transitioning into 'reviewed' stamps reviewed_at server-side.
    assert body["reviewed_at"] is not None


# ---------------------------------------------------------------------------
# DELETE — silent-204 on wrong-project hit
# ---------------------------------------------------------------------------


async def test_delete_review_returns_204_when_row_absent(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """Delete is idempotent — no row → 204, no error."""
    (project_a, bh_a), _ = two_projects_with_boreholes
    resp = await async_client.delete(
        f"/projects/{project_a.id}/reviews/borehole/{bh_a.id}",
    )
    assert resp.status_code == 204


async def test_delete_review_silently_ignores_wrong_project_hit(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """DELETE on a review that belongs to project B, called via project A's URL,
    returns 204 silently (asymmetric with PUT — see router docstring).
    The actual review row must survive the DELETE attempt."""
    (project_a, _), (project_b, bh_b) = two_projects_with_boreholes

    # Create a real review under project B.
    create_resp = await async_client.put(
        f"/projects/{project_b.id}/reviews/borehole/{bh_b.id}",
        json={"review_status": "reviewed"},
    )
    assert create_resp.status_code == 200

    # Call DELETE via project A's URL pointing at project B's target.
    cross = await async_client.delete(
        f"/projects/{project_a.id}/reviews/borehole/{bh_b.id}",
    )
    assert cross.status_code == 204

    # The legitimate review row in project B must still exist.
    still_there = await async_client.get(
        f"/projects/{project_b.id}/reviews/borehole/{bh_b.id}",
    )
    assert still_there.status_code == 200
    assert still_there.json()["target_id"] == str(bh_b.id)


# ---------------------------------------------------------------------------
# PATCH /view-state — shallow merge + null-removes-key
# ---------------------------------------------------------------------------


async def test_view_state_patch_shallow_merges_top_level_keys(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """Two sequential patches keep sibling keys untouched."""
    (project_a, _), _ = two_projects_with_boreholes
    url = f"/projects/{project_a.id}/view-state"

    first = await async_client.patch(url, json={"patch": {"dem_overlay": {"opacity": 0.5}}})
    assert first.status_code == 200
    assert first.json()["view_state"] == {"dem_overlay": {"opacity": 0.5}}

    second = await async_client.patch(url, json={"patch": {"hidden_cpt_types": ["CPTM"]}})
    assert second.status_code == 200
    # Sibling key from the first patch must survive.
    assert second.json()["view_state"] == {
        "dem_overlay": {"opacity": 0.5},
        "hidden_cpt_types": ["CPTM"],
    }


async def test_view_state_patch_null_removes_key(
    async_client: AsyncClient,
    two_projects_with_boreholes: tuple[
        tuple[ProjectOrm, BoreholeOrm], tuple[ProjectOrm, BoreholeOrm]
    ],
) -> None:
    """Passing ``null`` for a key drops it from the bag entirely."""
    (project_a, _), _ = two_projects_with_boreholes
    url = f"/projects/{project_a.id}/view-state"

    await async_client.patch(url, json={"patch": {"dem_overlay": True, "section_axis": "level"}})

    nulled = await async_client.patch(url, json={"patch": {"dem_overlay": None}})
    assert nulled.status_code == 200
    state = nulled.json()["view_state"]
    assert "dem_overlay" not in state
    assert state["section_axis"] == "level"


async def test_view_state_patch_unknown_project_returns_404(
    async_client: AsyncClient,
) -> None:
    """A patch against a non-existent project surfaces as 404, not 500."""
    resp = await async_client.patch(
        f"/projects/{uuid7()}/view-state", json={"patch": {"any": True}}
    )
    assert resp.status_code == 404
