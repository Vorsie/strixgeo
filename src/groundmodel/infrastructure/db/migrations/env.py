"""Alembic migration environment — online (asyncio) and offline migration modes."""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

# Import all ORM models so their tables are registered on Base.metadata before autogenerate.
import groundmodel.infrastructure.db.models  # noqa: F401
from groundmodel.infrastructure.db.alembic_config_helpers import set_config_option
from groundmodel.infrastructure.db.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Honour DATABASE_URL when present — matches groundmodel.shared.config.Settings
# precedence so `DATABASE_URL=... alembic upgrade head` migrates the DB the
# rest of the stack is talking to (notably the integration-test DB, which has
# a different name from the dev DB on the same Postgres instance).
_url_override = os.environ.get("DATABASE_URL")
if _url_override:
    # Goes through the shared helper for the `%`-escaping ConfigParser needs —
    # see alembic_config_helpers.set_config_option for why a raw `%` here is a
    # ValueError rather than a cosmetic issue.
    set_config_option(config, "sqlalchemy.url", _url_override)

target_metadata = Base.metadata

# Importing the models above registers each ORM class on Base.metadata.
# target_metadata.tables is a dict of {table_name: Table object}.
# We extract just the names so the include_name callback below can compare them.
# This prevents Alembic from treating the PostGIS Tiger geocoder tables
# (which live in the 'tiger' schema but are visible to autogenerate) as
# "tables we need to drop".
_our_tables = {t.name for t in target_metadata.tables.values()}


def include_name(name: str | None, type_: str, parent_names: object) -> bool:
    """Restrict autogenerate to application tables; skip PostGIS system tables."""
    if type_ == "table":
        return name in _our_tables
    return True


def run_migrations_offline() -> None:
    """Generate SQL without a live DB connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_name=include_name,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection):  # type: ignore[no-untyped-def]
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_name=include_name,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    url = config.get_main_option("sqlalchemy.url")
    if url is None:
        # alembic.ini or DATABASE_URL sets it; without one there is nothing to connect to.
        raise RuntimeError("alembic: sqlalchemy.url is not configured")
    engine = create_async_engine(url)
    async with engine.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    """Run Alembic migrations against a live DB using asyncpg."""
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
