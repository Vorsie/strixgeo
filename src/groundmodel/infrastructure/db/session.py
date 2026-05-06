"""Async database engine and session factory."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from groundmodel.shared.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug)

AsyncSessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an ``AsyncSession`` for use as a FastAPI dependency.

    FastAPI calls this generator before each request and closes it after.
    The ``async with`` block checks out a connection from the pool, yields the
    session to the route handler, then automatically rolls back any uncommitted
    work and returns the connection to the pool — whether the handler succeeded
    or raised an exception.

    Usage in a route::

        @router.post("/cpt")
        async def import_cpt(session: AsyncSession = Depends(get_session)):
            result = await ImportCpt(session).execute(...)
    """
    async with AsyncSessionFactory() as session:
        yield session
