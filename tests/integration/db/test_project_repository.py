"""Integration tests for ``ProjectRepository`` — CRUD + soft archive lifecycle.

Requires Docker DB on localhost:5433 (``docker compose up -d``). No data
fixtures needed — all rows are synthetic ORM instances.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)


def _project(*, name: str = "Test Project", **overrides: object) -> ProjectOrm:
    """Build a minimal ProjectOrm with sensible defaults."""
    return ProjectOrm(
        id=uuid7(),
        name=name,
        status="active",
        **overrides,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Smoke — round-trip
# ---------------------------------------------------------------------------


async def test_save_and_get_by_id(db_session: AsyncSession) -> None:
    """Saving a project then reading it back returns equal field values."""
    repo = ProjectRepository(db_session)
    project = _project(
        name="Site investigation A",
        client="ACME",
        site_label="Antwerp port",
        description="Foundation study for new quay",
        tags=["foundation", "marine"],
        default_horizontal_epsg=31370,
        default_vertical_epsg=5710,
        phase="design",
    )
    await repo.save(project)
    await db_session.commit()

    got = await repo.get_by_id(project.id)
    assert got is not None
    assert got.name == "Site investigation A"
    assert got.client == "ACME"
    assert got.tags == ["foundation", "marine"]
    assert got.default_horizontal_epsg == 31370
    assert got.phase == "design"
    assert got.status == "active"
    assert got.archived_at is None


async def test_get_by_id_returns_none_for_missing(db_session: AsyncSession) -> None:
    repo = ProjectRepository(db_session)
    assert await repo.get_by_id(uuid7()) is None


# ---------------------------------------------------------------------------
# Listing — active vs archived partitioning
# ---------------------------------------------------------------------------


async def test_list_all_hides_archived_by_default(db_session: AsyncSession) -> None:
    """``list_all()`` excludes rows where ``archived_at`` is set."""
    repo = ProjectRepository(db_session)
    active = _project(name="Active project")
    archived = _project(name="Archived project")
    await repo.save(active)
    await repo.save(archived)
    await db_session.commit()
    await repo.archive(archived.id)
    await db_session.commit()

    rows = await repo.list_all()
    names = {r.name for r in rows}
    assert "Active project" in names
    assert "Archived project" not in names


async def test_list_all_includes_archived_when_requested(
    db_session: AsyncSession,
) -> None:
    """``include_archived=True`` returns both active and archived rows."""
    repo = ProjectRepository(db_session)
    active = _project(name="Active for include")
    archived = _project(name="Archived for include")
    await repo.save(active)
    await repo.save(archived)
    await db_session.commit()
    await repo.archive(archived.id)
    await db_session.commit()

    rows = await repo.list_all(include_archived=True)
    names = {r.name for r in rows}
    assert {"Active for include", "Archived for include"} <= names


async def test_list_archived_returns_only_archived(db_session: AsyncSession) -> None:
    """``list_archived`` is the inverse view of the default list."""
    repo = ProjectRepository(db_session)
    active = _project(name="Active for archived-view")
    archived = _project(name="Archived for archived-view")
    await repo.save(active)
    await repo.save(archived)
    await db_session.commit()
    await repo.archive(archived.id)
    await db_session.commit()

    rows = await repo.list_archived()
    names = {r.name for r in rows}
    assert "Archived for archived-view" in names
    assert "Active for archived-view" not in names


# ---------------------------------------------------------------------------
# Archive / unarchive lifecycle
# ---------------------------------------------------------------------------


async def test_archive_sets_archived_at(db_session: AsyncSession) -> None:
    repo = ProjectRepository(db_session)
    project = _project(name="To archive")
    await repo.save(project)
    await db_session.commit()
    assert project.archived_at is None

    updated = await repo.archive(project.id)
    await db_session.commit()
    assert updated is not None
    assert updated.archived_at is not None
    # archived_at is timezone-aware UTC.
    assert updated.archived_at.tzinfo is not None


async def test_unarchive_clears_archived_at(db_session: AsyncSession) -> None:
    repo = ProjectRepository(db_session)
    project = _project(name="To unarchive")
    await repo.save(project)
    await db_session.commit()
    await repo.archive(project.id)
    await db_session.commit()
    assert project.archived_at is not None

    updated = await repo.unarchive(project.id)
    await db_session.commit()
    assert updated is not None
    assert updated.archived_at is None


async def test_archive_returns_none_for_missing_id(db_session: AsyncSession) -> None:
    """Archiving a non-existent id returns None — handler maps to 404."""
    repo = ProjectRepository(db_session)
    assert await repo.archive(uuid7()) is None


async def test_unarchive_returns_none_for_missing_id(db_session: AsyncSession) -> None:
    """Unarchiving a non-existent id returns None — handler maps to 404."""
    repo = ProjectRepository(db_session)
    assert await repo.unarchive(uuid7()) is None
