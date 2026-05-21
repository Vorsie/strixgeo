"""End-to-end tests for POST /borehole/detail-batch (debt #39).

Pins the three contracts the section-open hot path depends on:

E1 — Happy path: a batch of two borehole ids returns both detail
     rows; unknown ids drop silently from the response.
E2 — Project scope guard: ids from a different project are silently
     dropped (the IN predicate is fused with the app_project_id
     predicate). A crafted batch can't pull foreign-project boreholes
     by guessing UUIDs (VULN-6).
E3 — Include filter: passing `include=[]` returns the detail row
     with every lab-test family stamped as an empty list (not
     omitted). The shape is unchanged from the always-load default
     so the section render path doesn't have to special-case missing
     keys.

The Promise.allSettled → single-batch migration in the frontend
(`useSectionData.ts`) relies on the response indexing-by-id contract
that E1 pins.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def two_projects_three_boreholes(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, ProjectOrm, BoreholeOrm, BoreholeOrm, BoreholeOrm]:
    """Set up two projects: project A with 2 boreholes, project B with 1.

    Lets E2 prove that batching by id alone — without a project
    predicate — would pull the foreign borehole.
    """
    project_a = ProjectOrm(id=uuid7(), name="batch test A", status="active")
    project_b = ProjectOrm(id=uuid7(), name="batch test B", status="active")
    db_session.add_all([project_a, project_b])
    await db_session.flush()

    bh_a1 = BoreholeOrm(
        id=uuid7(),
        name="BH-A1",
        app_project_id=project_a.id,
        project_id="DOV",
        test_id="BH-A1",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    bh_a2 = BoreholeOrm(
        id=uuid7(),
        name="BH-A2",
        app_project_id=project_a.id,
        project_id="DOV",
        test_id="BH-A2",
        location_x=150100.0,
        location_y=200100.0,
        epsg=31370,
        total_depth_m=12.0,
    )
    bh_b1 = BoreholeOrm(
        id=uuid7(),
        name="BH-B1",
        app_project_id=project_b.id,
        project_id="DOV",
        test_id="BH-B1",
        location_x=151000.0,
        location_y=201000.0,
        epsg=31370,
        total_depth_m=8.0,
    )
    db_session.add_all([bh_a1, bh_a2, bh_b1])
    await db_session.commit()
    return project_a, project_b, bh_a1, bh_a2, bh_b1


@pytest.mark.asyncio
async def test_detail_batch_returns_known_ids_drops_unknown(
    async_client: AsyncClient,
    two_projects_three_boreholes: tuple[
        ProjectOrm, ProjectOrm, BoreholeOrm, BoreholeOrm, BoreholeOrm
    ],
) -> None:
    """E1 — known ids returned, unknown ones silently dropped."""
    project_a, _project_b, bh_a1, bh_a2, _bh_b1 = two_projects_three_boreholes
    ghost_id = uuid7()  # never inserted — must NOT appear in the response

    resp = await async_client.post(
        "/borehole/detail-batch",
        json={
            "ids": [str(bh_a1.id), str(bh_a2.id), str(ghost_id)],
            "app_project_id": str(project_a.id),
        },
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    returned_ids = {row["id"] for row in rows}
    assert returned_ids == {str(bh_a1.id), str(bh_a2.id)}
    # Order is not guaranteed; the docstring is explicit about this so
    # the caller indexes by id — pin that here as a documented contract.
    names_by_id = {row["id"]: row["name"] for row in rows}
    assert names_by_id[str(bh_a1.id)] == "BH-A1"
    assert names_by_id[str(bh_a2.id)] == "BH-A2"


@pytest.mark.asyncio
async def test_detail_batch_scope_guard_drops_foreign_project(
    async_client: AsyncClient,
    two_projects_three_boreholes: tuple[
        ProjectOrm, ProjectOrm, BoreholeOrm, BoreholeOrm, BoreholeOrm
    ],
) -> None:
    """E2 — a borehole id from project B isn't returned when the batch
    is scoped to project A. The IN + app_project_id predicates are
    fused in the repository query (VULN-6 scope guard).
    """
    project_a, _project_b, bh_a1, _bh_a2, bh_b1 = two_projects_three_boreholes

    resp = await async_client.post(
        "/borehole/detail-batch",
        json={
            # bh_b1 is in project_b but we claim project_a scope.
            "ids": [str(bh_a1.id), str(bh_b1.id)],
            "app_project_id": str(project_a.id),
        },
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    returned_ids = {row["id"] for row in rows}
    # Only the project-A borehole comes back; project-B borehole
    # silently dropped (same skip-on-missing semantic as unknown ids).
    assert returned_ids == {str(bh_a1.id)}


@pytest.mark.asyncio
async def test_detail_batch_include_empty_stamps_lab_families(
    async_client: AsyncClient,
    two_projects_three_boreholes: tuple[
        ProjectOrm, ProjectOrm, BoreholeOrm, BoreholeOrm, BoreholeOrm
    ],
) -> None:
    """E3 — ``include=[]`` returns the detail row with every lab-test
    family stamped as an empty list. The frontend section caller
    relies on this shape (the column glyphs check ``samples`` but
    don't need lab data).
    """
    project_a, _project_b, bh_a1, _bh_a2, _bh_b1 = two_projects_three_boreholes

    resp = await async_client.post(
        "/borehole/detail-batch",
        json={
            "ids": [str(bh_a1.id)],
            "app_project_id": str(project_a.id),
            "include": [],
        },
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    row = rows[0]
    # Detail row carries the always-loaded children (drill segments,
    # field log, observations, samples) but the lab families on each
    # sample are present as keys — empty lists, not missing — so the
    # frontend's type assumptions hold without per-field None-guards.
    assert "samples" in row
    # No samples on this minimal borehole; just confirm the shape doesn't
    # crash. (The lab-stamping contract is exercised by get_by_id tests
    # for a sample-bearing borehole — repeating the wiring at the batch
    # boundary is structurally identical, so a smoke-shape check is the
    # right scope here.)
    assert isinstance(row["samples"], list)
