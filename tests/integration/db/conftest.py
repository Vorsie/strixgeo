"""Fixtures for DB integration tests."""

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.config import settings

# Tables that get wiped before AND after every test.
#
# Order matters because PostgreSQL's TRUNCATE … CASCADE only follows
# real FOREIGN KEY edges. Several project-scoped tables intentionally
# carry plain ``app_project_id`` UUIDs (no FK to project) so a CASCADE
# on ``project`` does NOT reach them. List them explicitly here:
#
#  * investigation_review — UNIQUE (target_kind, target_id) would
#    block target-uuid reuse across tests if rows survived.
#  * cross_section, geological_formation, geological_model — also
#    app_project_id-scoped without FK; rows would otherwise accumulate
#    across tests in this session.
#
# ``cpt`` / ``borehole`` / ``project`` carry the real child FKs
# (cpt_series, drill_segment, observation, sample, …), so CASCADE
# flushes those automatically.
_TRUNCATE_SQL = text(
    "TRUNCATE TABLE "
    "investigation_review, cross_section, geological_model, "
    "geological_formation, cpt, borehole, project "
    "CASCADE"
)


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Yield a session for one test, then truncate every project-scoped table.

    A fresh engine with NullPool is created per test so that connections are
    never reused across pytest-asyncio's per-function event loops.  Without
    this, the module-level pool hands out connections bound to a previous loop
    and asyncpg raises ``asyncpg.exceptions._base.InterfaceError``.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as pre:
        await pre.execute(_TRUNCATE_SQL)
        await pre.commit()

    async with factory() as session:
        yield session

    async with factory() as cleanup:
        await cleanup.execute(_TRUNCATE_SQL)
        await cleanup.commit()

    await engine.dispose()


async def make_project(
    db_session: AsyncSession, *, name: str = "Integration project"
) -> ProjectOrm:
    """Insert a minimal active project + commit; returns the row.

    Shared by every integration test that needs a project shell to
    hang its rows from. Previously duplicated as ``_make_project`` in
    each test module — promoted here on the third copy.

    Tests can override ``name`` when they want to distinguish two
    projects in the same test (scope-leak checks).
    """
    project = ProjectOrm(id=uuid7(), name=name, status="active")
    db_session.add(project)
    await db_session.commit()
    return project
