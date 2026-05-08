"""Fixtures for DB integration tests."""

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from groundmodel.shared.config import settings


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Yield a session for one test, then truncate cpt for isolation.

    A fresh engine with NullPool is created per test so that connections are
    never reused across pytest-asyncio's per-function event loops.  Without
    this, the module-level pool hands out connections bound to a previous loop
    and asyncpg raises ``asyncpg.exceptions._base.InterfaceError``.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    # Truncate every parent table — CASCADE flushes the child tables too
    # (cpt_series via FK, drill_segment + field_log_interval via FK).
    # Keeps the per-test reset to one round-trip while staying complete.
    async with factory() as pre:
        await pre.execute(text("TRUNCATE TABLE cpt, borehole CASCADE"))
        await pre.commit()

    async with factory() as session:
        yield session

    async with factory() as cleanup:
        await cleanup.execute(text("TRUNCATE TABLE cpt, borehole CASCADE"))
        await cleanup.commit()

    await engine.dispose()
