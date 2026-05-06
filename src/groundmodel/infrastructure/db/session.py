"""Async database engine and session factory."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from groundmodel.shared.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug)

AsyncSessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an AsyncSession for dependency injection in FastAPI routes."""
    async with AsyncSessionFactory() as session:
        yield session
