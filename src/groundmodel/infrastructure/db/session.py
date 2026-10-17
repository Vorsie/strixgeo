"""Async database engine and session factory."""

from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from groundmodel.infrastructure.db.session_constants import DB_SERVER_SETTINGS
from groundmodel.shared.config import settings

if TYPE_CHECKING:
    from groundmodel.application.synchronous_queue import SynchronousQueue

# echo is gated on the dedicated `sqlalchemy_echo` flag, NOT `debug`: SQLAlchemy
# echo prints every statement together with the engine DSN, leaking the DB
# password into the log on a debug run (audit #6). Off unless SQLALCHEMY_ECHO=true.
#
# connect_args.server_settings applies lock_timeout / statement_timeout /
# idle_in_transaction_session_timeout to every connection (see
# session_constants.py) so a request fails loudly (55P03 -> 409) instead of
# hanging on a contended body-partition lock, and an abandoned transaction is
# reaped rather than pinning a connection + its locks forever (audit M3).
engine = create_async_engine(
    settings.database_url,
    echo=settings.sqlalchemy_echo,
    connect_args={"server_settings": DB_SERVER_SETTINGS},
    # A pooled connection whose transport died (embedded Postgres restarted, a
    # backend terminated, a background job's connection gone stale) is replaced
    # on checkout instead of failing the next statement with a dead protocol.
    pool_pre_ping=True,
)

AsyncSessionFactory = async_sessionmaker(engine, expire_on_commit=False)


def get_queue() -> "SynchronousQueue":
    """Return a ``SynchronousQueue`` wired to the module-level session factory.

    Imported lazily to avoid a circular import between session ↔ queue.
    Provided as a FastAPI dependency via ``Depends(get_queue)``.
    """
    from groundmodel.application.synchronous_queue import SynchronousQueue  # noqa: PLC0415

    return SynchronousQueue(AsyncSessionFactory)


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
