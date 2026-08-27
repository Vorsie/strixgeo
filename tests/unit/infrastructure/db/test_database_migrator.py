"""Unit tests for DatabaseMigrator — the bundled-Postgres bring-up service.

Everything here runs against injected fakes: no real socket, no real
Postgres, no real database connection through Alembic's `env.py`.
`upgrade_to_head` does read the REAL migrations directory on disk to resolve
the head revision (a pure filesystem read, no DB) but the upgrade command
itself is always faked, so no migration ever reaches a live database.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable

import asyncpg
import pytest
from alembic.config import Config

from groundmodel.infrastructure.db.database_migrator import (
    DatabaseMigrator,
    DatabaseMigratorError,
    strip_asyncpg_driver_marker,
)
from groundmodel.infrastructure.db.database_migrator_constants import (
    STAGE_ALEMBIC,
    STAGE_CREATE_DATABASE,
    STAGE_POSTGIS,
    STAGE_WAITING_FOR_SERVER,
)

_DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel"


class FakeConnection:
    """In-memory stand-in for an `asyncpg.Connection`.

    Records every `execute` / `fetchval` call so tests can assert on exactly
    what SQL was (or was not) issued, and answers canned responses keyed by a
    substring of the query — enough for the handful of statements
    `DatabaseMigrator` issues.
    """

    def __init__(
        self,
        *,
        database_exists: bool = True,
        postgis_version: str = "3.6.2",
        stamped_revision_before: str | None = None,
        stamped_revision_after: str | None = "e7f8a9b0c1d2",
    ) -> None:
        self.execute_calls: list[str] = []
        self.fetchval_calls: list[str] = []
        self.closed = False
        self._database_exists = database_exists
        self._postgis_version = postgis_version
        self._stamped_revision_before = stamped_revision_before
        self._stamped_revision_after = stamped_revision_after
        self._alembic_version_query_count = 0

    async def execute(self, query: str, *args: object) -> None:
        """Record an executed statement."""
        self.execute_calls.append(query)

    async def fetchval(self, query: str, *args: object) -> object:
        """Answer a scalar query from the canned responses, keyed by substring."""
        self.fetchval_calls.append(query)
        if "pg_database" in query:
            return 1 if self._database_exists else None
        if "pg_extension" in query:
            return self._postgis_version
        if "alembic_version" in query:
            self._alembic_version_query_count += 1
            value = (
                self._stamped_revision_before
                if self._alembic_version_query_count == 1
                else self._stamped_revision_after
            )
            if value is None:
                raise asyncpg.UndefinedTableError('relation "alembic_version" does not exist')
            return value
        raise AssertionError(f"unexpected fetchval query: {query!r}")

    async def close(self) -> None:
        """Mark the connection closed."""
        self.closed = True


def _fake_connector(
    connection: FakeConnection, dial_calls: list[str]
) -> Callable[..., Awaitable[FakeConnection]]:
    """Build a fake `connect(dsn)` that always returns `connection` and records the DSN dialed."""

    async def connect(dsn: str, *args: object, **kwargs: object) -> FakeConnection:
        dial_calls.append(dsn)
        return connection

    return connect


def _fake_upgrade_runner(recorded: list[Config]) -> Callable[[Config], None]:
    """Build a fake `AlembicUpgradeRunner` that records the Config it received.

    The fake also asserts the invariant that the real runner depends on: it
    must be called from a thread with NO running event loop.  See
    :func:`test_upgrade_runs_where_alembic_can_start_its_own_event_loop`.
    """

    def run_upgrade(config: Config) -> None:
        assert not _has_running_event_loop(), (
            "the Alembic upgrade was invoked on a thread that already has a "
            "running event loop; migrations/env.py calls asyncio.run() and "
            "would raise"
        )
        recorded.append(config)

    return run_upgrade


def _has_running_event_loop() -> bool:
    """Return whether the calling thread currently has a running event loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


# ---------------------------------------------------------------------------
# DSN translation — pure function, no I/O
# ---------------------------------------------------------------------------


def test_strip_asyncpg_driver_marker_removes_driver_only():
    """`+asyncpg` is removed from the scheme; host/port/db pass through unchanged."""
    result = strip_asyncpg_driver_marker(
        "postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel"
    )
    assert result == "postgresql://groundmodel:groundmodel@127.0.0.1:5433/groundmodel"


def test_strip_asyncpg_driver_marker_preserves_percent_encoded_password():
    """A password containing URL-special characters round-trips byte-for-byte.

    The packaged app generates a random per-install password; if it contains
    `@`, `:`, `%`, etc. it arrives already percent-encoded in the URL, and
    this function must not decode/re-encode it — only rewrite the scheme.
    """
    url = "postgresql+asyncpg://groundmodel:p%40ss%3Aw%25rd@localhost:55432/groundmodel"
    result = strip_asyncpg_driver_marker(url)
    assert result == "postgresql://groundmodel:p%40ss%3Aw%25rd@localhost:55432/groundmodel"


def test_strip_asyncpg_driver_marker_is_a_noop_on_already_raw_scheme():
    """A DSN with no driver marker (already raw) is returned unchanged."""
    url = "postgresql://groundmodel:groundmodel@localhost:5433/groundmodel"
    assert strip_asyncpg_driver_marker(url) == url


# ---------------------------------------------------------------------------
# Happy path — all four steps, injected fakes only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_migrate_happy_path_runs_all_four_steps_in_order():
    """A fresh cluster: database missing -> created, PostGIS ensured, upgrade run."""
    connection = FakeConnection(database_exists=False)
    dial_calls: list[str] = []
    upgrade_calls: list[Config] = []
    migrator = DatabaseMigrator(
        connect=_fake_connector(connection, dial_calls),
        run_upgrade=_fake_upgrade_runner(upgrade_calls),
    )

    await migrator.migrate(_DATABASE_URL, timeout_seconds=1.0, poll_interval_seconds=0.01)

    assert any("CREATE DATABASE" in call for call in connection.execute_calls)
    assert any(
        "CREATE EXTENSION IF NOT EXISTS postgis" in call for call in connection.execute_calls
    )
    assert len(upgrade_calls) == 1
    config = upgrade_calls[0]
    assert config.get_main_option("sqlalchemy.url") == _DATABASE_URL
    assert config.get_main_option("script_location").endswith("migrations")
    # Every dial used the raw (non-SQLAlchemy) DSN, never the +asyncpg form.
    assert all("+asyncpg" not in dsn for dsn in dial_calls)
    assert connection.closed is True


@pytest.mark.asyncio
async def test_migrate_happy_path_carries_a_percent_encoded_password_through_alembic():
    """A generated password with percent-encoded characters survives the Config round-trip.

    Regression guard for the ConfigParser interpolation trap: `Config.set_main_option`
    raises `ValueError` on a bare `%` unless it is escaped first (see
    `_set_config_option` in `database_migrator.py`) — this DSN shape is exactly
    what the packaged app's generated per-install password produces.
    """
    connection = FakeConnection(database_exists=True)
    dial_calls: list[str] = []
    upgrade_calls: list[Config] = []
    migrator = DatabaseMigrator(
        connect=_fake_connector(connection, dial_calls),
        run_upgrade=_fake_upgrade_runner(upgrade_calls),
    )
    url = "postgresql+asyncpg://groundmodel:p%40ss%3Aw%25rd@127.0.0.1:5433/groundmodel"

    await migrator.migrate(url, timeout_seconds=1.0, poll_interval_seconds=0.01)

    assert upgrade_calls[0].get_main_option("sqlalchemy.url") == url


# ---------------------------------------------------------------------------
# Structural error path — the server never comes up
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wait_for_server_ready_times_out_without_hanging():
    """A server that never accepts connections raises within the bound — not forever."""

    async def always_refuses(dsn: str, *args: object, **kwargs: object) -> FakeConnection:
        raise ConnectionRefusedError("nobody is listening yet")

    migrator = DatabaseMigrator(connect=always_refuses)

    with pytest.raises(DatabaseMigratorError) as exc_info:
        await migrator.wait_for_server_ready(
            "postgresql://groundmodel:groundmodel@127.0.0.1:5433/postgres",
            host="127.0.0.1",
            port=5433,
            timeout_seconds=0.05,
            poll_interval_seconds=0.01,
        )

    assert exc_info.value.stage == STAGE_WAITING_FOR_SERVER
    assert "127.0.0.1:5433" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Idempotency — database already exists
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_database_exists_skips_create_when_already_present():
    """An existing database is left alone — no CREATE DATABASE is issued."""
    connection = FakeConnection(database_exists=True)
    migrator = DatabaseMigrator(connect=_fake_connector(connection, []))

    await migrator.ensure_database_exists(
        "postgresql://groundmodel:groundmodel@127.0.0.1:5433/postgres", "groundmodel"
    )

    assert connection.execute_calls == []
    assert connection.closed is True


# ---------------------------------------------------------------------------
# Variant — a failure in each later step is attributed to its own stage
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_database_exists_wraps_create_failure_with_its_own_stage():
    """A CREATE DATABASE failure surfaces as DatabaseMigratorError(stage='create-database')."""

    class BrokenConnection(FakeConnection):
        async def execute(self, query: str, *args: object) -> None:
            raise RuntimeError("permission denied to create database")

    connection = BrokenConnection(database_exists=False)
    migrator = DatabaseMigrator(connect=_fake_connector(connection, []))

    with pytest.raises(DatabaseMigratorError) as exc_info:
        await migrator.ensure_database_exists(
            "postgresql://groundmodel:groundmodel@127.0.0.1:5433/postgres", "groundmodel"
        )

    assert exc_info.value.stage == STAGE_CREATE_DATABASE
    assert connection.closed is True  # connection is still closed on failure


@pytest.mark.asyncio
async def test_ensure_postgis_wraps_failure_with_its_own_stage():
    """A CREATE EXTENSION failure surfaces as DatabaseMigratorError(stage='postgis')."""

    class BrokenConnection(FakeConnection):
        async def execute(self, query: str, *args: object) -> None:
            raise RuntimeError("permission denied to create extension")

    connection = BrokenConnection()
    migrator = DatabaseMigrator(connect=_fake_connector(connection, []))

    with pytest.raises(DatabaseMigratorError) as exc_info:
        await migrator.ensure_postgis(
            "postgresql://groundmodel:groundmodel@127.0.0.1:5433/groundmodel"
        )

    assert exc_info.value.stage == STAGE_POSTGIS
    assert connection.closed is True


@pytest.mark.asyncio
async def test_upgrade_to_head_wraps_alembic_failure_with_its_own_stage():
    """An upgrade-runner exception surfaces as DatabaseMigratorError(stage='alembic')."""
    connection = FakeConnection()

    def failing_upgrade(config: Config) -> None:
        raise RuntimeError("migration script blew up")

    migrator = DatabaseMigrator(
        connect=_fake_connector(connection, []), run_upgrade=failing_upgrade
    )

    with pytest.raises(DatabaseMigratorError) as exc_info:
        await migrator.upgrade_to_head(_DATABASE_URL)

    assert exc_info.value.stage == STAGE_ALEMBIC


async def test_upgrade_runs_where_alembic_can_start_its_own_event_loop():
    """The Alembic upgrade must not be invoked from a thread that owns a loop.

    `migrations/env.py` drives an ASYNC engine, so it calls `asyncio.run()`
    itself.  Every step before it here is `async`, so the migrator is already
    inside a running loop — and calling the upgrade inline raises
    "asyncio.run() cannot be called from a running event loop", which is
    exactly how the first packaged boot failed: the whole schema was skipped
    and the app came up against an empty database.

    The injected upgrade runner is what made that invisible to the other
    tests, so this asserts the property the real runner needs rather than the
    call itself.
    """
    observed: dict[str, object] = {}

    def run_upgrade(config: Config) -> None:
        observed["had_running_loop"] = _has_running_event_loop()
        observed["thread"] = threading.current_thread().name

    migrator = DatabaseMigrator(
        connect=_fake_connector(FakeConnection(), []), run_upgrade=run_upgrade
    )

    caller_thread = threading.current_thread().name
    await migrator.upgrade_to_head(_DATABASE_URL)

    assert observed["had_running_loop"] is False
    assert observed["thread"] != caller_thread
