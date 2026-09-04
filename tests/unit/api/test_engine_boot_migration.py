"""Unit tests for the engine-side boot migration hook.

The packaged app no longer runs a separate ``migrate.py`` child before the
engine starts; the engine imports everything first (overlapping the embedded
Postgres boot) and then, inside its own process, waits for Postgres and brings
the schema to head. These tests pin that hook in the rule's own words:

* the engine **waits for Postgres to accept connections with a deadline** and
  **fails clearly on timeout**;
* it **runs the migration in-process exactly once** when the packaged env flag
  requests it;
* it **runs the migrator BEFORE any lifespan DB connect** (the boot probe);
* it is **skipped entirely when the packaged env flag is absent** — dev keeps
  external migrations (``alembic upgrade head`` by hand / the wrapper script).
"""

from __future__ import annotations

import types
from typing import Any

import pytest

from groundmodel.api import main as api_main
from groundmodel.api.boot_migration import run_boot_migration
from groundmodel.api.boot_migration_constants import ENGINE_MIGRATE_ENV
from groundmodel.infrastructure.db.database_migrator import (
    DatabaseMigrator,
    DatabaseMigratorError,
)
from groundmodel.infrastructure.db.database_migrator_constants import (
    STAGE_WAITING_FOR_SERVER,
)


class _RecordingMigrator:
    """Stand-in for ``DatabaseMigrator`` — records the ``migrate`` call only."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, float]] = []

    async def migrate(
        self,
        database_url: str,
        *,
        timeout_seconds: float,
        poll_interval_seconds: float = 0.25,
    ) -> None:
        """Record the DSN + timeout the hook handed the migrator."""
        self.calls.append((database_url, timeout_seconds))


async def test_migration_is_skipped_when_the_packaged_flag_is_absent() -> None:
    """No packaged env flag → dev keeps external migrations → migrator never called."""
    migrator = _RecordingMigrator()

    ran = await run_boot_migration(
        env={},
        database_url="postgresql+asyncpg://u:p@h:1/db",
        migrator=migrator,
    )

    assert ran is False
    assert migrator.calls == []


async def test_migration_runs_in_process_exactly_once_when_the_flag_is_set() -> None:
    """The packaged env flag present → the migrator runs once with the same DSN."""
    migrator = _RecordingMigrator()

    ran = await run_boot_migration(
        env={ENGINE_MIGRATE_ENV: "1"},
        database_url="postgresql+asyncpg://u:p@h:1/db",
        migrator=migrator,
        timeout_seconds=3.0,
    )

    assert ran is True
    assert migrator.calls == [("postgresql+asyncpg://u:p@h:1/db", 3.0)]


async def test_engine_waits_for_accepting_connections_and_fails_clearly_on_timeout() -> None:
    """A server that never accepts a connection fails clearly (the waiting stage).

    Drives the REAL migrator with a connector that always refuses, so the hook
    exercises the bounded wait-for-server loop and surfaces the ``waiting``
    stage rather than hanging.
    """

    async def always_refuses(dsn: str, *args: object, **kwargs: object) -> Any:
        raise ConnectionRefusedError("nobody is listening yet")

    migrator = DatabaseMigrator(connect=always_refuses)

    with pytest.raises(DatabaseMigratorError) as exc_info:
        await run_boot_migration(
            env={ENGINE_MIGRATE_ENV: "1"},
            database_url="postgresql+asyncpg://u:p@127.0.0.1:1/db",
            migrator=migrator,
            timeout_seconds=0.05,
            poll_interval_seconds=0.01,
        )

    assert exc_info.value.stage == STAGE_WAITING_FOR_SERVER


async def test_migration_runs_before_the_first_lifespan_db_connect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In the lifespan the engine migrates BEFORE the first DB connect (the probe).

    Rule, in its own words: the migrator runs before any lifespan DB connect.
    The lifespan's first DB connect is the boot ``_probe_database`` (``SELECT
    1``); the migration must come first so the schema is at head before anything
    touches it.
    """
    order: list[str] = []

    async def fake_migration(*_a: object, **_k: object) -> bool:
        order.append("migrate")
        return True

    async def fake_probe() -> None:
        order.append("probe")

    async def fake_sweep() -> None:
        order.append("sweep")

    monkeypatch.setattr(api_main, "run_boot_migration", fake_migration)
    monkeypatch.setattr(api_main, "_probe_database", fake_probe)
    monkeypatch.setattr(api_main, "_sweep_stale_bodies", fake_sweep)

    app = types.SimpleNamespace(state=types.SimpleNamespace())
    async with api_main.lifespan(app):  # type: ignore[arg-type]
        pass

    assert "migrate" in order and "probe" in order
    assert order.index("migrate") < order.index("probe")
