"""HTTP-level tests for the cross_section router (debt #22 + #40).

Focus: ``PATCH /projects/{pid}/sections/{sid}`` ``view_state``
merge semantics. The schema docstring has promised shallow-merge
since #25 landed; debt #40 wires the router to honour that
contract instead of clobbering the bag.

Test cases mirror the project-level view-state contract so the two
endpoints stay consistent (callers know one rule, not two):

* absent view_state in body → no change
* explicit ``null`` → "do not touch" sentinel
* explicit ``{}`` → clear the bag
* non-empty dict → shallow merge into existing bag
* null inside the dict → drops that single key
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Set up a project for section tests."""
    project = ProjectOrm(id=uuid7(), name="Sections", status="active")
    db_session.add(project)
    await db_session.commit()
    return project


async def _create_section(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    *,
    view_state: dict | None = None,
) -> dict:
    body = {
        "name": "S1",
        "start_x": 150000.0,
        "start_y": 200000.0,
        "end_x": 150300.0,
        "end_y": 200000.0,
        "epsg": 31370,
    }
    if view_state is not None:
        body["view_state"] = view_state
    resp = await client.post(f"/projects/{project_id}/sections", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_patch_view_state_merges_top_level_keys(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """A second patch keeps the first patch's siblings intact."""
    section = await _create_section(
        async_client, project.id, view_state={"cpt_channels": {"qc": True}}
    )

    first = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"view_state": {"vex_lock": False}},
    )
    assert first.status_code == 200
    # Sibling cpt_channels from the create call must still be present.
    assert first.json()["view_state"] == {
        "cpt_channels": {"qc": True},
        "vex_lock": False,
    }


async def test_patch_view_state_null_inside_dict_removes_key(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Passing ``null`` for a top-level key drops it from the bag."""
    section = await _create_section(
        async_client,
        project.id,
        view_state={"cpt_channels": {"qc": True}, "vex_lock": True},
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"view_state": {"vex_lock": None}},
    )
    assert resp.status_code == 200
    state = resp.json()["view_state"]
    assert "vex_lock" not in state
    assert state["cpt_channels"] == {"qc": True}


async def test_patch_view_state_empty_dict_clears_the_bag(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """``view_state: {}`` clears all keys (the documented contract)."""
    section = await _create_section(
        async_client, project.id, view_state={"cpt_channels": {"qc": True}}
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"view_state": {}},
    )
    assert resp.status_code == 200
    assert resp.json()["view_state"] in (None, {})


async def test_patch_view_state_explicit_null_does_not_touch(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """``view_state: null`` is the documented sentinel for "do not touch"."""
    section = await _create_section(
        async_client, project.id, view_state={"cpt_channels": {"qc": True}}
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"view_state": None, "vertical_exaggeration": 3.0},
    )
    assert resp.status_code == 200
    body = resp.json()
    # Sibling field updated; view_state untouched.
    assert body["vertical_exaggeration"] == 3.0
    assert body["view_state"] == {"cpt_channels": {"qc": True}}


async def test_patch_omitted_view_state_leaves_bag_untouched(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Omitting view_state from the body never touches the column."""
    section = await _create_section(
        async_client, project.id, view_state={"cpt_channels": {"qc": True}}
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"name": "Renamed"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Renamed"
    assert body["view_state"] == {"cpt_channels": {"qc": True}}
