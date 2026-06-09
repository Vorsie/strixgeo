"""Integration test: POST /projects/{id}/sections/batch creates N sections in one commit.

BS1  Three distinct sections created in one call → all three persisted, names
     match, the list endpoint confirms all three survive.
BS2  Empty sections list → 200 with an empty sections array (no-op path).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Minimal active project for batch-create-sections tests."""
    proj = ProjectOrm(id=uuid7(), name="batch sections test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


async def test_batch_create_sections_creates_all(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """BS1 — three sections submitted → three rows persisted, names match."""
    payload = {
        "sections": [
            {
                "name": f"Tie-section {i}",
                "start_x": 100.0 + i,
                "start_y": 200.0,
                "end_x": 300.0 + i,
                "end_y": 400.0,
                "epsg": 31370,
                "projection_buffer_m": 10.0,
                "vertical_exaggeration": 1.0,
                "display_order": i,
            }
            for i in range(1, 4)
        ]
    }
    resp = await async_client.post(f"/projects/{project.id}/sections/batch", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["sections"]) == 3
    assert {s["name"] for s in body["sections"]} == {
        "Tie-section 1",
        "Tie-section 2",
        "Tie-section 3",
    }

    listed = await async_client.get(f"/projects/{project.id}/sections")
    assert listed.status_code == 200, listed.text
    assert {"Tie-section 1", "Tie-section 2", "Tie-section 3"} <= {s["name"] for s in listed.json()}


async def test_batch_create_sections_empty_list(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """BS2 — empty list is a no-op; returns 200 with an empty sections array."""
    resp = await async_client.post(f"/projects/{project.id}/sections/batch", json={"sections": []})
    assert resp.status_code == 200, resp.text
    assert resp.json()["sections"] == []
