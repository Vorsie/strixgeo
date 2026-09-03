"""Shared integration-test fixtures.

The ``db_session`` fixture + ``make_project`` helper live here (not
inside ``db/conftest.py``) so both the database-direct tests under
``tests/integration/db/`` and the HTTP-level tests under
``tests/integration/api/`` consume the same engine + same
truncate-between-tests behaviour. Promoted to this level on the
second copy (debt #22) per the project's "extract on second use"
rule.

Safety guard
------------
The ``db_session`` fixture TRUNCATEs every project-scoped table at
the start AND end of every test. Pointing it at the dev DB
(``groundmodel``) destroys whatever the user has imported.
``pytest_collection_modifyitems`` below refuses to collect any
integration test unless ``DATABASE_URL`` points at a DB whose name
ends in ``_integration`` or ``_test``. To run the integration suite,
either set ``DATABASE_URL`` in the shell or use
``scripts/run-integration-tests.ps1`` which sets it for you.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.session import engine as module_engine
from groundmodel.shared.config import settings

# DB-name suffixes that mark a throwaway test database. The guard below
# rejects collection if settings.database_url ends in anything else, so
# a stray ``uv run pytest tests/integration`` against the dev DB never
# silently TRUNCATEs the user's work.
_ALLOWED_DB_SUFFIXES = ("_integration", "_test")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Refuse to collect integration tests against a non-test DB.

    Raised here (not in a fixture) so the failure is visible BEFORE
    any test body runs — fixture-level guards trip only once the
    truncate has already executed on the first test.
    """
    url = settings.database_url
    # Strip the optional ``?param=value`` suffix some env strings carry.
    db_name = url.rsplit("/", 1)[-1].split("?", 1)[0]
    if not db_name.endswith(_ALLOWED_DB_SUFFIXES):
        pytest.exit(
            "Integration tests refuse to run against DB "
            f"{db_name!r} — it does not end in {_ALLOWED_DB_SUFFIXES}. "
            "Set DATABASE_URL to a throwaway test database before "
            "running integration tests (see "
            "scripts/run-integration-tests.ps1 + CLAUDE.md "
            "'Development Workflow').",
            returncode=2,
        )


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


@pytest_asyncio.fixture(autouse=True)
async def _dispose_module_engine() -> AsyncIterator[None]:
    """Dispose the MODULE-LEVEL engine after every test.

    ``db_session`` builds its own NullPool engine per test, but code paths that
    run outside a request — the background jobs (voxel build, DOV / GEF import)
    open ``AsyncSessionFactory()`` themselves — draw from the production pool in
    ``groundmodel.infrastructure.db.session``. An asyncpg connection is bound to
    the event loop that created it, and pytest-asyncio gives every test a fresh
    loop, so the SECOND test that runs a job inherits a connection whose
    transport is gone: ``AttributeError: 'NoneType' object has no attribute
    'send'`` at its first statement (VBJ-2 on 2026-09-03). Disposing the pool
    after each test makes the next checkout open a loop-fresh connection.
    """
    yield
    await module_engine.dispose()


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
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
