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
        json={"view_state": {"snap_to_stratigraphy": False}},
    )
    assert first.status_code == 200
    # Sibling cpt_channels from the create call must still be present.
    assert first.json()["view_state"] == {
        "cpt_channels": {"qc": True},
        "snap_to_stratigraphy": False,
    }


async def test_patch_view_state_null_inside_dict_removes_key(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Passing ``null`` for a top-level key drops it from the bag."""
    section = await _create_section(
        async_client,
        project.id,
        view_state={"cpt_channels": {"qc": True}, "snap_to_stratigraphy": True},
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"view_state": {"snap_to_stratigraphy": None}},
    )
    assert resp.status_code == 200
    state = resp.json()["view_state"]
    assert "snap_to_stratigraphy" not in state
    assert state["cpt_channels"] == {"qc": True}


async def test_patch_view_state_unknown_top_level_key_is_422(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Unknown view_state keys are rejected at the HTTP boundary (debt #24).

    Sister to the unit-level pin in
    ``tests/unit/api/test_section_view_state.py``; this one walks the
    full request path so a future relaxation of the router schema
    surfaces here too. Use a real schema key (e.g.
    ``snap_to_stratigraphy``) when verifying merge semantics.
    """
    section = await _create_section(async_client, project.id)
    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"view_state": {"not_a_real_key": True}},
    )
    assert resp.status_code == 422


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


async def test_patch_excluded_ids_persists_through_round_trip(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Right-click → remove from section path: PATCH appends to the
    excluded arrays, GET returns them unchanged.

    The frontend (SectionPanel.handleRemoveFromSection) reads the
    current arrays, appends the new id, and PATCHes the whole array.
    This test pins that the round-trip preserves what the caller sent.
    """
    section = await _create_section(async_client, project.id)
    # Initial state: empty arrays.
    assert section["excluded_cpt_ids"] == []
    assert section["excluded_borehole_ids"] == []

    cpt_id = str(uuid7())
    bh_id_a = str(uuid7())
    bh_id_b = str(uuid7())

    # First patch: hide a CPT + a borehole.
    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={
            "excluded_cpt_ids": [cpt_id],
            "excluded_borehole_ids": [bh_id_a],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["excluded_cpt_ids"] == [cpt_id]
    assert body["excluded_borehole_ids"] == [bh_id_a]

    # Second patch: extend borehole list (caller appends client-side).
    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"excluded_borehole_ids": [bh_id_a, bh_id_b]},
    )
    assert resp.status_code == 200
    body = resp.json()
    # CPT list untouched (we didn't send it); borehole list expanded.
    assert body["excluded_cpt_ids"] == [cpt_id]
    assert body["excluded_borehole_ids"] == [bh_id_a, bh_id_b]


async def test_patch_excluded_ids_empty_array_clears_the_list(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """ "Restore all" footer path: PATCH with an empty array clears
    every previously-excluded id. The frontend's footer button sends
    both arrays as ``[]`` in one PATCH.
    """
    section = await _create_section(async_client, project.id)
    cpt_id = str(uuid7())
    bh_id = str(uuid7())

    # Seed the section with one hidden of each kind.
    await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={
            "excluded_cpt_ids": [cpt_id],
            "excluded_borehole_ids": [bh_id],
        },
    )

    # Clear both via the footer's PATCH shape.
    resp = await async_client.patch(
        f"/projects/{project.id}/sections/{section['id']}",
        json={"excluded_cpt_ids": [], "excluded_borehole_ids": []},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["excluded_cpt_ids"] == []
    assert body["excluded_borehole_ids"] == []
