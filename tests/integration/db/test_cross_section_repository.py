"""Integration tests for ``CrossSectionRepository`` (CRUD + scoping).

A cross-section is a project-scoped slice the user defines through
their project for viewing / editing the geological model. The repo
is small (no child trees), so these tests are mostly straightforward
CRUD + a scope-leak check.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)


async def _make_project(db_session: AsyncSession, *, name: str = "Sections test") -> ProjectOrm:
    """Insert a bare project and commit. Returns the row."""
    project = ProjectOrm(id=uuid7(), name=name, status="active")
    db_session.add(project)
    await db_session.commit()
    return project


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def test_create_and_list_ordered(db_session: AsyncSession) -> None:
    """Sections come back ordered by display_order then name."""
    project = await _make_project(db_session)
    repo = CrossSectionRepository(db_session)

    await repo.create(
        project.id,
        name="B - Cross",
        start_x=100.0,
        start_y=100.0,
        end_x=200.0,
        end_y=100.0,
        epsg=31370,
        projection_buffer_m=50.0,
        display_order=1,
    )
    await repo.create(
        project.id,
        name="A - East-West",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=75.0,
        display_order=0,
    )
    await db_session.commit()

    sections = await repo.list_all(project.id)
    assert [s.name for s in sections] == ["A - East-West", "B - Cross"]
    # Defaults applied via the create call get persisted verbatim.
    assert sections[0].projection_buffer_m == 75.0
    assert sections[1].projection_buffer_m == 50.0
    assert sections[0].vertical_exaggeration == 1.0
    assert sections[0].excluded_borehole_ids == []
    assert sections[0].excluded_cpt_ids == []


async def test_get_returns_none_for_missing(db_session: AsyncSession) -> None:
    """Unknown id resolves to ``None`` (router maps to 404)."""
    repo = CrossSectionRepository(db_session)
    assert await repo.get(uuid7()) is None


async def test_partial_update_only_changes_specified_fields(
    db_session: AsyncSession,
) -> None:
    """Patch with one key leaves all other columns untouched."""
    project = await _make_project(db_session)
    repo = CrossSectionRepository(db_session)
    section = await repo.create(
        project.id,
        name="Original",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
        vertical_exaggeration=2.0,
        description="Initial",
    )
    await db_session.commit()

    # Update name only.
    updated = await repo.update(section.id, {"name": "Renamed"})
    await db_session.commit()
    assert updated is not None
    assert updated.name == "Renamed"
    assert updated.description == "Initial"
    assert updated.vertical_exaggeration == 2.0
    assert updated.projection_buffer_m == 50.0


async def test_update_can_change_endpoints_and_buffer(
    db_session: AsyncSession,
) -> None:
    """End-to-end update of geometry + view fields persists correctly."""
    project = await _make_project(db_session)
    repo = CrossSectionRepository(db_session)
    section = await repo.create(
        project.id,
        name="Movable",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    await db_session.commit()

    await repo.update(
        section.id,
        {
            "start_x": 10.0,
            "start_y": 20.0,
            "end_x": 200.0,
            "end_y": 50.0,
            "projection_buffer_m": 120.0,
            "min_depth_m": -2.0,
            "max_depth_m": 30.0,
        },
    )
    await db_session.commit()
    reloaded = await repo.get(section.id)
    assert reloaded is not None
    assert reloaded.start_x == 10.0
    assert reloaded.end_y == 50.0
    assert reloaded.projection_buffer_m == 120.0
    assert reloaded.min_depth_m == -2.0
    assert reloaded.max_depth_m == 30.0


async def test_delete_removes_the_row(db_session: AsyncSession) -> None:
    """Delete returns True then the section is gone."""
    project = await _make_project(db_session)
    repo = CrossSectionRepository(db_session)
    section = await repo.create(
        project.id,
        name="Gone",
        start_x=0.0,
        start_y=0.0,
        end_x=1.0,
        end_y=1.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    await db_session.commit()

    ok = await repo.delete(section.id)
    await db_session.commit()
    assert ok is True
    assert await repo.get(section.id) is None


async def test_delete_returns_false_for_missing(db_session: AsyncSession) -> None:
    """Repeated delete is a no-op (idempotent at the boolean level)."""
    repo = CrossSectionRepository(db_session)
    assert await repo.delete(uuid7()) is False


# ---------------------------------------------------------------------------
# Exclusion arrays + view-window depths
# ---------------------------------------------------------------------------


async def test_excluded_arrays_round_trip(db_session: AsyncSession) -> None:
    """Exclusion arrays survive insert + reload."""
    project = await _make_project(db_session)
    repo = CrossSectionRepository(db_session)
    excluded_bh = [uuid7(), uuid7()]
    excluded_cpt = [uuid7()]
    await repo.create(
        project.id,
        name="Excludes",
        start_x=0.0,
        start_y=0.0,
        end_x=1.0,
        end_y=1.0,
        epsg=31370,
        projection_buffer_m=50.0,
        excluded_borehole_ids=excluded_bh,
        excluded_cpt_ids=excluded_cpt,
    )
    await db_session.commit()

    sections = await repo.list_all(project.id)
    assert sections[0].excluded_borehole_ids == excluded_bh
    assert sections[0].excluded_cpt_ids == excluded_cpt


# ---------------------------------------------------------------------------
# Project scoping
# ---------------------------------------------------------------------------


async def test_sections_scoped_to_one_project(db_session: AsyncSession) -> None:
    """Sections in project A don't leak into project B's list."""
    a = await _make_project(db_session, name="A")
    b = await _make_project(db_session, name="B")
    repo = CrossSectionRepository(db_session)
    await repo.create(
        a.id,
        name="In A",
        start_x=0.0,
        start_y=0.0,
        end_x=1.0,
        end_y=1.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    await repo.create(
        b.id,
        name="In B",
        start_x=0.0,
        start_y=0.0,
        end_x=1.0,
        end_y=1.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    await db_session.commit()

    for_a = await repo.list_all(a.id)
    for_b = await repo.list_all(b.id)
    assert {s.name for s in for_a} == {"In A"}
    assert {s.name for s in for_b} == {"In B"}


# ---------------------------------------------------------------------------
# Pin the ORM import — same reason as in the geology repo tests: if
# nothing in this module imported the class, SQLAlchemy's metadata
# wouldn't see it and the integration suite would skip table creation.
# ---------------------------------------------------------------------------


async def test_orm_import_is_pinned() -> None:
    """Sanity check: the ORM class is wired into SQLAlchemy's metadata."""
    assert CrossSectionOrm.__tablename__ == "cross_section"
