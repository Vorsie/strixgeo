"""Integration tests: bed-override CRUD + .strix bundle round-trip.

Owner ruling 2026-09-06: a bed override is a polygon drawn on the map with one
constant bed elevation; inside it the ground surface takes that level. These
tests exercise:

* BO1 — the migration + CRUD: create / list / delete a bed override through the
  API (the ``bed_override`` table exists only because the Alembic migration ran,
  which the wrapper does via ``alembic upgrade head`` before the suite).
* BO2 — the .strix round-trip: a bed override is carried into the project bundle
  and restored after a project wipe (new optional bundle section; old files
  without it restore cleanly, proven by the empty-collection default).
* BO3 — project-scope guard: a bed override cannot be deleted through another
  project's URL (404).

Run via ``scripts\\run-integration-tests.ps1`` ONLY (it points DATABASE_URL at
the sibling ``_integration`` DB and runs the migration first).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.bed_override_orm import BedOverrideOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

pytestmark = pytest.mark.asyncio


_CANAL_VERTICES = [[40.0, 40.0], [60.0, 40.0], [60.0, 60.0], [40.0, 60.0]]


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Minimal active project for bed-override tests."""
    proj = ProjectOrm(id=uuid7(), name="bed override test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


async def test_bo1_create_list_delete_bed_override(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """BO1 — create / list / delete a bed override end-to-end (proves the migration ran)."""
    create = await async_client.post(
        f"/projects/{project.id}/bed-overrides",
        json={
            "label": "Canal bed",
            "level_m": -4.0,
            "epsg": 31370,
            "vertices": _CANAL_VERTICES,
        },
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["label"] == "Canal bed"
    assert body["level_m"] == -4.0
    assert body["vertices"] == [[40.0, 40.0], [60.0, 40.0], [60.0, 60.0], [40.0, 60.0]]
    override_id = body["id"]

    listed = await async_client.get(f"/projects/{project.id}/bed-overrides")
    assert listed.status_code == 200, listed.text
    assert [o["id"] for o in listed.json()] == [override_id]

    deleted = await async_client.delete(f"/projects/{project.id}/bed-overrides/{override_id}")
    assert deleted.status_code == 204, deleted.text

    listed_again = await async_client.get(f"/projects/{project.id}/bed-overrides")
    assert listed_again.json() == []


async def test_bo2_bed_override_round_trips_through_the_bundle(
    db_session: AsyncSession, async_client: AsyncClient, project: ProjectOrm
) -> None:
    """BO2 — a bed override is carried into the bundle and restored after a wipe."""
    create = await async_client.post(
        f"/projects/{project.id}/bed-overrides",
        json={
            "label": "Canal bed",
            "level_m": -4.0,
            "epsg": 31370,
            "vertices": _CANAL_VERTICES,
        },
    )
    assert create.status_code == 201, create.text
    override_id = create.json()["id"]

    bundle_resp = await async_client.get(f"/projects/{project.id}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    assert [o["id"] for o in bundle["bed_overrides"]] == [override_id]

    # Wipe the project, then restore from the bundle.
    proj = await db_session.get(ProjectOrm, project.id)
    assert proj is not None
    await db_session.delete(proj)
    await db_session.commit()

    restore = await async_client.post(f"/projects/{project.id}/restore", json=bundle)
    assert restore.status_code == 200, restore.text

    db_session.expire_all()
    rows = list(
        (
            await db_session.execute(
                select(BedOverrideOrm).where(BedOverrideOrm.app_project_id == project.id)
            )
        ).scalars()
    )
    assert len(rows) == 1
    restored = rows[0]
    assert str(restored.id) == override_id
    assert restored.label == "Canal bed"
    assert restored.level_m == -4.0
    assert restored.vertices == _CANAL_VERTICES


async def test_bo3_delete_is_scoped_to_the_owning_project(
    db_session: AsyncSession, async_client: AsyncClient, project: ProjectOrm
) -> None:
    """BO3 — a bed override cannot be deleted through another project's URL."""
    other = ProjectOrm(id=uuid7(), name="other project", status="active")
    db_session.add(other)
    await db_session.commit()

    create = await async_client.post(
        f"/projects/{project.id}/bed-overrides",
        json={"label": "Canal bed", "level_m": -4.0, "epsg": 31370, "vertices": _CANAL_VERTICES},
    )
    assert create.status_code == 201, create.text
    override_id = create.json()["id"]

    cross = await async_client.delete(f"/projects/{other.id}/bed-overrides/{override_id}")
    assert cross.status_code == 404, cross.text

    # The override still exists under its real project.
    listed = await async_client.get(f"/projects/{project.id}/bed-overrides")
    assert [o["id"] for o in listed.json()] == [override_id]
