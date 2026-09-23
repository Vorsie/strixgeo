"""A section change stales every built surface of the project.

Owner ruling 2026-09-23: "you don't need to drop subdivision on tests, only
don't use tests not on sections for the model". Which tests a section draws is
therefore model membership, and every route that can change it must flag the
built surfaces so the next Build re-filters:

SC1  POST   /sections            → every surface of the project is_stale
SC2  PATCH  projection_buffer_m  → stale
SC3  PATCH  name only            → NOT stale (nothing moved on or off)
SC4  DELETE /sections/{id}       → stale
SC5  POST   /sections/batch      → stale
SC6  PATCH  excluded_borehole_ids → stale
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.rebuild_model_surfaces import RebuildModelSurfaces
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._litho_builders import contact, geo_model
from tests.integration._section_builders import covering_section

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class Scene:
    """Ids of a project with one fresh (built, not stale) surface and one section.

    Plain ids, not ORM rows: the routes commit on their own session, and an
    expired ORM attribute read in the test body would lazy-load outside an
    ``await`` (``MissingGreenlet``).
    """

    project_id: UUID
    model_id: UUID
    section_id: UUID
    borehole_id: UUID


def _borehole(project_id: UUID, *, suffix: str, x: float, y: float) -> BoreholeOrm:
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="SC_TESTS",
        test_id=f"BH-SC-{suffix}",
        location_x=x,
        location_y=y,
        elevation_m=5.0,
        epsg=31370,
        total_depth_m=20.0,
    )


async def _stale_flags(db_session: AsyncSession, model_id: UUID) -> list[bool]:
    """The ``is_stale`` flag of every surface of the model, read fresh from the DB.

    A column select bypasses the identity map, so the value is what the route
    committed, not what this session cached.
    """
    rows = (
        (
            await db_session.execute(
                select(FormationSurfaceOrm.is_stale).where(FormationSurfaceOrm.model_id == model_id)
            )
        )
        .scalars()
        .all()
    )
    return [bool(r) for r in rows]


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> Scene:
    """Three boreholes on a covering section, one formation, surfaces BUILT."""
    project = ProjectOrm(id=uuid7(), name="section change stales surfaces", status="active")
    db_session.add(project)
    await db_session.flush()
    model = geo_model(project)
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="SC-Formation",
        color="#aabbcc",
        display_order=0,
        pinned_order=False,
    )
    bh1 = _borehole(project.id, suffix="1", x=150_000.0, y=200_000.0)
    bh2 = _borehole(project.id, suffix="2", x=150_200.0, y=200_000.0)
    bh3 = _borehole(project.id, suffix="3", x=150_100.0, y=200_200.0)
    section = covering_section(project.id)
    db_session.add_all([model, formation, bh1, bh2, bh3, section])
    await db_session.flush()
    db_session.add_all(
        [
            contact(model, formation, bh1, depth=3.0),
            contact(model, formation, bh2, depth=3.5),
            contact(model, formation, bh3, depth=3.2),
        ]
    )
    await db_session.commit()
    await RebuildModelSurfaces(db_session).execute(model.id)
    await db_session.commit()
    assert await _stale_flags(db_session, model.id) == [False], "fixture: surface must be fresh"
    return Scene(
        project_id=project.id, model_id=model.id, section_id=section.id, borehole_id=bh1.id
    )


def _section_payload(name: str) -> dict:
    return {
        "name": name,
        "start_x": 149_000.0,
        "start_y": 200_100.0,
        "end_x": 151_000.0,
        "end_y": 200_100.0,
        "epsg": 31370,
        "projection_buffer_m": 300.0,
    }


async def test_sc1_creating_a_section_stales_the_surfaces(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    resp = await async_client.post(
        f"/projects/{scene.project_id}/sections", json=_section_payload("SC1")
    )
    assert resp.status_code == 201, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc2_widening_the_corridor_stales_the_surfaces(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_id}",
        json={"projection_buffer_m": 10.0},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc3_a_rename_does_not_stale_the_surfaces(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_id}",
        json={"name": "Renamed", "vertical_exaggeration": 2.0},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [False]


async def test_sc4_deleting_a_section_stales_the_surfaces(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    resp = await async_client.delete(f"/projects/{scene.project_id}/sections/{scene.section_id}")
    assert resp.status_code == 204, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc5_batch_creating_sections_stales_the_surfaces(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    resp = await async_client.post(
        f"/projects/{scene.project_id}/sections/batch",
        json={"sections": [_section_payload("SC5-a"), _section_payload("SC5-b")]},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc6_excluding_a_test_from_a_section_stales_the_surfaces(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_id}",
        json={"excluded_borehole_ids": [str(scene.borehole_id)]},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]
