"""A section change stales the built surfaces ONLY when the set of drawn tests changes.

Owner ruling 2026-09-23 (on the first version, which staled on every geometry
change): "if i change the buffer and no new tests are added to a CS or none are
not on the section anymore, e.g. we only widen the buffer without the actual
tests on the section changing, then the model shouldn't become stale."

Membership is the set of tests that at least one cross-section draws. Every
route that can move a test on or off a section compares that set before and
after; only a different set flags the surfaces.

Scene: bh1, bh2, bh3 on section A; bh1 ALSO on section B; bh4 on no section
(its pick exists but feeds nothing). Surfaces built and fresh.

SC1   POST a section that draws bh4              → stale
SC1b  POST a section that draws only bh1          → NOT stale (bh1 was drawn already)
SC2   PATCH A's corridor so it reaches bh4        → stale
SC2b  PATCH A's corridor wider, still short of bh4 → NOT stale
SC3   PATCH name / exaggeration                   → NOT stale
SC4   DELETE B (bh1 stays drawn by A)             → NOT stale
SC4b  DELETE A (bh2 and bh3 lose their only section) → stale
SC5   POST /batch with a section that draws bh4   → stale
SC6   PATCH A excluding bh2 (drawn nowhere else)  → stale
SC6b  PATCH A excluding bh1 (still drawn by B)    → NOT stale
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
from tests.integration._section_builders import section_through

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class Scene:
    """Ids of the scene (plain ids: the routes commit on their own session)."""

    project_id: UUID
    model_id: UUID
    section_a_id: UUID
    section_b_id: UUID
    bh1_id: UUID
    bh2_id: UUID


# Section A draws bh1, bh2, bh3 (lateral 100 m in a 150 m corridor); bh4 sits
# 300 m off its line. Section B is a short line 50 m south of bh1 only.
A_START, A_END, A_BUFFER = (149_900.0, 200_100.0), (150_300.0, 200_100.0), 150.0
B_START, B_END, B_BUFFER = (149_950.0, 199_950.0), (150_050.0, 199_950.0), 60.0


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
    """The ``is_stale`` flag of every surface of the model, read fresh from the DB."""
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
    """bh1..bh3 on section A, bh1 also on B, bh4 on none; surfaces built and fresh."""
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
    bh4 = _borehole(project.id, suffix="4", x=150_100.0, y=200_400.0)
    section_a = section_through(project.id, name="A", start=A_START, end=A_END, buffer_m=A_BUFFER)
    section_b = section_through(project.id, name="B", start=B_START, end=B_END, buffer_m=B_BUFFER)
    db_session.add_all([model, formation, bh1, bh2, bh3, bh4, section_a, section_b])
    await db_session.flush()
    db_session.add_all(
        [
            contact(model, formation, bh1, depth=3.0),
            contact(model, formation, bh2, depth=3.5),
            contact(model, formation, bh3, depth=3.2),
            contact(model, formation, bh4, depth=3.4),
        ]
    )
    await db_session.commit()
    await RebuildModelSurfaces(db_session).execute(model.id)
    await db_session.commit()
    assert await _stale_flags(db_session, model.id) == [False], "fixture: surface must be fresh"
    return Scene(
        project_id=project.id,
        model_id=model.id,
        section_a_id=section_a.id,
        section_b_id=section_b.id,
        bh1_id=bh1.id,
        bh2_id=bh2.id,
    )


def _section_payload(
    name: str, start: tuple[float, float], end: tuple[float, float], buffer_m: float
) -> dict:
    return {
        "name": name,
        "start_x": start[0],
        "start_y": start[1],
        "end_x": end[0],
        "end_y": end[1],
        "epsg": 31370,
        "projection_buffer_m": buffer_m,
    }


# A line through bh4 that draws nobody else.
BH4_SECTION = _section_payload("through bh4", (150_000.0, 200_400.0), (150_200.0, 200_400.0), 50.0)
# A second copy of B: draws bh1, already drawn.
BH1_AGAIN = _section_payload("bh1 again", B_START, B_END, B_BUFFER)


async def test_sc1_a_section_that_draws_a_new_test_stales(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC1: a section that draws a new test stales."""
    resp = await async_client.post(f"/projects/{scene.project_id}/sections", json=BH4_SECTION)
    assert resp.status_code == 201, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc1b_a_section_that_draws_only_already_drawn_tests_does_not_stale(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC1B: a section that draws only already drawn tests does not stale."""
    resp = await async_client.post(f"/projects/{scene.project_id}/sections", json=BH1_AGAIN)
    assert resp.status_code == 201, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [False]


async def test_sc2_widening_a_corridor_onto_a_new_test_stales(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC2: widening a corridor onto a new test stales."""
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_a_id}",
        json={"projection_buffer_m": 350.0},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc2b_widening_a_corridor_that_reaches_nobody_new_does_not_stale(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC2B: widening a corridor that reaches nobody new does not stale."""
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_a_id}",
        json={"projection_buffer_m": 200.0},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [False]


async def test_sc3_a_rename_does_not_stale(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC3: a rename does not stale."""
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_a_id}",
        json={"name": "Renamed", "vertical_exaggeration": 2.0},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [False]


async def test_sc4_deleting_a_section_whose_tests_stay_drawn_does_not_stale(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC4: deleting a section whose tests stay drawn does not stale."""
    resp = await async_client.delete(f"/projects/{scene.project_id}/sections/{scene.section_b_id}")
    assert resp.status_code == 204, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [False]


async def test_sc4b_deleting_the_only_section_of_a_test_stales(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC4B: deleting the only section of a test stales."""
    resp = await async_client.delete(f"/projects/{scene.project_id}/sections/{scene.section_a_id}")
    assert resp.status_code == 204, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc5_a_batch_that_draws_a_new_test_stales(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC5: a batch that draws a new test stales."""
    resp = await async_client.post(
        f"/projects/{scene.project_id}/sections/batch",
        json={"sections": [BH1_AGAIN, BH4_SECTION]},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc6_excluding_a_test_drawn_nowhere_else_stales(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC6: excluding a test drawn nowhere else stales."""
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_a_id}",
        json={"excluded_borehole_ids": [str(scene.bh2_id)]},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [True]


async def test_sc6b_excluding_a_test_still_drawn_elsewhere_does_not_stale(
    async_client: AsyncClient, db_session: AsyncSession, scene: Scene
) -> None:
    """SC6B: excluding a test still drawn elsewhere does not stale."""
    resp = await async_client.patch(
        f"/projects/{scene.project_id}/sections/{scene.section_a_id}",
        json={"excluded_borehole_ids": [str(scene.bh1_id)]},
    )
    assert resp.status_code == 200, resp.text
    assert await _stale_flags(db_session, scene.model_id) == [False]
