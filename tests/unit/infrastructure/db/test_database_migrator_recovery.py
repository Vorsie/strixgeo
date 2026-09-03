"""Unit tests for the pre-migration backup + newer-database guard.

Production-readiness audit H2b / Codex row 8 (backup before a destructive
migration) and H2c / M8 (an older build over a newer database must fail with a
named cause, never brick boot). Everything runs against injected fakes: no real
socket, no real Postgres, no ``pg_dump`` subprocess. ``upgrade_to_head`` reads
the REAL migrations directory on disk to resolve the head/pending revisions (a
pure filesystem read, no DB); the upgrade and the dump are always faked.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

import asyncpg
import pytest
from alembic.config import Config

from groundmodel.infrastructure.db.database_migrator import (
    DatabaseMigrator,
    DatabaseMigratorError,
    NewerDatabaseError,
    _prune_old_backups,
)
from groundmodel.infrastructure.db.database_migrator_constants import (
    BACKUP_RETENTION_COUNT,
    STAGE_BACKUP,
    STRIX_BACKUP_DIR_ENV,
    STRIX_PG_DUMP_PATH_ENV,
)

_DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel"

# A real revision several steps behind head — used as the "database currently
# stamped here" value so the pending range (head..this) is non-empty and
# includes the ``c6d7e8f9a0b1`` sample-FK migration, which declares
# ``DATA_REWRITE = True``.
_KNOWN_OLD_REVISION = "a4b5c6d7e8f9"


class FakeConnection:
    """In-memory stand-in for an ``asyncpg.Connection`` (revision-focused)."""

    def __init__(self, *, stamped_revision_before: str | None) -> None:
        self._stamped_before = stamped_revision_before
        self._alembic_query_count = 0
        self.closed = False

    async def execute(self, query: str, *args: object) -> None:
        """No-op — this suite never issues DDL."""

    async def fetchval(self, query: str, *args: object) -> object:
        """Answer the alembic_version read; first call = before, later = head."""
        if "alembic_version" in query:
            self._alembic_query_count += 1
            value = self._stamped_before if self._alembic_query_count == 1 else "head-after"
            if value is None:
                raise asyncpg.UndefinedTableError('relation "alembic_version" does not exist')
            return value
        raise AssertionError(f"unexpected fetchval query: {query!r}")

    async def close(self) -> None:
        """Mark closed."""
        self.closed = True


def _fake_connector(connection: FakeConnection) -> Callable[..., Awaitable[FakeConnection]]:
    """Build a ``connect(dsn)`` that always returns ``connection``."""

    async def connect(dsn: str, *args: object, **kwargs: object) -> FakeConnection:
        return connection

    return connect


_FIXED_NOW = datetime(2026, 9, 2, 17, 10, 45, tzinfo=UTC)


def _migrator(
    *,
    stamped_before: str | None,
    order: list[str],
    dump_error: Exception | None = None,
    env: dict[str, str] | None = None,
    recorded_dumps: list[Path] | None = None,
) -> DatabaseMigrator:
    """Build a migrator whose dump + upgrade record their call order."""

    def run_dump(pg_dump_path: str, dsn: str, out_file: Path) -> None:
        order.append("dump")
        if recorded_dumps is not None:
            recorded_dumps.append(out_file)
        if dump_error is not None:
            raise dump_error

    def run_upgrade(config: Config) -> None:
        order.append("upgrade")

    return DatabaseMigrator(
        connect=_fake_connector(FakeConnection(stamped_revision_before=stamped_before)),
        run_upgrade=run_upgrade,
        run_dump=run_dump,
        env=env or {},
        now=lambda: _FIXED_NOW,
    )


# ---------------------------------------------------------------------------
# H2b — a pg_dump checkpoint is written BEFORE a pending upgrade
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_migrations_dump_before_the_upgrade(tmp_path: pytest.TempPathFactory):
    """With pending migrations and a backup dir, the dump runs BEFORE the upgrade."""
    order: list[str] = []
    dumps: list[Path] = []
    migrator = _migrator(
        stamped_before=_KNOWN_OLD_REVISION,
        order=order,
        env={
            STRIX_PG_DUMP_PATH_ENV: "pg_dump.exe",
            STRIX_BACKUP_DIR_ENV: str(tmp_path),
        },
        recorded_dumps=dumps,
    )

    await migrator.upgrade_to_head(_DATABASE_URL)

    assert order == ["dump", "upgrade"], "the checkpoint must precede the migration"
    assert len(dumps) == 1
    # <userData>/backups/pre-<from>-<to>-<timestamp>.dump
    assert dumps[0].name.startswith(f"pre-{_KNOWN_OLD_REVISION}-")
    assert dumps[0].suffix == ".dump"


@pytest.mark.asyncio
async def test_dump_failure_aborts_the_upgrade_and_names_the_backup_stage(
    tmp_path: pytest.TempPathFactory,
):
    """A dump failure never migrates without the checkpoint — it raises stage='backup'."""
    order: list[str] = []
    migrator = _migrator(
        stamped_before=_KNOWN_OLD_REVISION,
        order=order,
        dump_error=RuntimeError("pg_dump: connection refused"),
        env={
            STRIX_PG_DUMP_PATH_ENV: "pg_dump.exe",
            STRIX_BACKUP_DIR_ENV: str(tmp_path),
        },
    )

    with pytest.raises(DatabaseMigratorError) as exc_info:
        await migrator.upgrade_to_head(_DATABASE_URL)

    assert exc_info.value.stage == STAGE_BACKUP
    assert "upgrade" not in order, "the upgrade must NOT run when the checkpoint fails"


@pytest.mark.asyncio
async def test_no_pending_migrations_skips_the_dump(tmp_path: pytest.TempPathFactory):
    """A fresh/unmigrated cluster (nothing stamped) has no data to back up — no dump."""
    order: list[str] = []
    migrator = _migrator(
        stamped_before=None,  # fresh cluster
        order=order,
        env={
            STRIX_PG_DUMP_PATH_ENV: "pg_dump.exe",
            STRIX_BACKUP_DIR_ENV: str(tmp_path),
        },
    )

    await migrator.upgrade_to_head(_DATABASE_URL)

    assert order == ["upgrade"], "no pending user data → no dump, upgrade still runs"


@pytest.mark.asyncio
async def test_dev_without_env_skips_the_dump(tmp_path: pytest.TempPathFactory):
    """In dev (no STRIX_PG_DUMP_PATH / STRIX_BACKUP_DIR) the dump is skipped, upgrade runs."""
    order: list[str] = []
    migrator = _migrator(stamped_before=_KNOWN_OLD_REVISION, order=order, env={})

    await migrator.upgrade_to_head(_DATABASE_URL)

    assert order == ["upgrade"], "no backup env → skip the dump, still migrate"


# ---------------------------------------------------------------------------
# Retention — the five newest dumps are kept
# ---------------------------------------------------------------------------


def test_prune_old_backups_keeps_the_five_newest(tmp_path):
    """``_prune_old_backups`` keeps only the newest ``keep`` pre-*.dump files."""
    # Seven dumps with sortable timestamps in their names (oldest → newest).
    names = [
        f"pre-r0-r1-2026090{i}T000000Z.dump"
        for i in range(1, 8)  # 20260901..20260907
    ]
    for name in names:
        (tmp_path / name).write_bytes(b"x")
    # A non-backup file must be left untouched.
    (tmp_path / "unrelated.txt").write_text("keep me")

    _prune_old_backups(tmp_path, BACKUP_RETENTION_COUNT)

    remaining = sorted(p.name for p in tmp_path.glob("pre-*.dump"))
    assert remaining == names[-BACKUP_RETENTION_COUNT:]  # the 5 newest
    assert (tmp_path / "unrelated.txt").exists()


# ---------------------------------------------------------------------------
# H2c — an older build over a newer database fails with a named cause
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_stamped_revision_raises_newer_database_error():
    """A revision this build does not know = written by a newer StrixGeo — data intact."""
    migrator = _migrator(stamped_before="zz99notarealrevision", order=[])

    with pytest.raises(NewerDatabaseError) as exc_info:
        await migrator.upgrade_to_head(_DATABASE_URL)

    assert "newer version of StrixGeo" in str(exc_info.value)
    assert "intact" in str(exc_info.value)
    assert exc_info.value.stamped_revision == "zz99notarealrevision"


@pytest.mark.asyncio
async def test_a_known_stamped_revision_is_not_treated_as_newer(
    tmp_path: pytest.TempPathFactory,
):
    """A revision this build DOES know migrates normally (never NewerDatabaseError)."""
    order: list[str] = []
    migrator = _migrator(
        stamped_before=_KNOWN_OLD_REVISION,
        order=order,
        env={},  # dev: skip the dump, but the upgrade must still run
    )

    await migrator.upgrade_to_head(_DATABASE_URL)

    assert order == ["upgrade"]
