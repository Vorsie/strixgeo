"""HTTP-integration test fixtures (debt #22).

Mounts the real FastAPI app via ``httpx.ASGITransport`` and overrides
``get_session`` so the request-scope session shares the test engine
with the ``db_session`` fixture inherited from
``tests/integration/conftest.py``.

Tests built on this client assert status codes + JSON shape only —
the existing per-repository tests under ``tests/integration/db/``
already pin the underlying CRUD semantics, so the API layer's
contribution is the routing, scope guards, error mapping, and
serialisation contract.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from groundmodel.api.main import app
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.config import settings


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Yield an ``httpx.AsyncClient`` bound to the FastAPI app.

    The ``db_session`` fixture has already truncated and re-opened
    the database for this test. The ``get_session`` override below
    creates a fresh engine + sessionmaker (same NullPool pattern so
    asyncio loops don't cross connections) so each request runs in
    its own transaction — exactly mirroring production semantics
    where every request goes through ``Depends(get_session)``.

    Assertions can either:

    * inspect the response JSON returned by the API, or
    * SELECT through ``db_session`` to verify side effects.

    Both see the same Postgres database; PostgreSQL's read-committed
    isolation makes committed work visible across sessions
    immediately.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        transport = ASGITransport(app=app)
        # ``localhost`` (not ``testserver``) because the API's
        # TrustedHostMiddleware (see ``api/main.py``) only accepts
        # 127.0.0.1 / localhost. Using "testserver" makes every
        # request 400 with "Invalid host header" before the route
        # body runs.
        async with AsyncClient(transport=transport, base_url="http://localhost") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        await engine.dispose()
