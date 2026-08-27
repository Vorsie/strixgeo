"""Bring a freshly-``initdb``'d, empty Postgres cluster to the Alembic schema head.

Why this module exists
-----------------------
Today ``alembic upgrade head`` is only ever run by a human, from the repo
root, with ``alembic.ini`` on disk. None of that holds for the bundled-Postgres
distribution path (debt #2, "Fork A" — see
``docs/distribution-db-decision.md``): the packaged Electron app ships no
repo checkout and no ``alembic.ini``, runs ``initdb`` into a brand-new per-user
data directory, and starts ``postgres.exe`` on a dynamically chosen free port.
Something has to take that empty cluster to schema head before the FastAPI
backend can talk to it — on *every* launch, not just the first, since the app
does not track whether it already migrated.

:class:`DatabaseMigrator` is that something, run as a CLI subprocess from the
Electron main process via ``migrate.py``. Four ordered steps:

1. :meth:`DatabaseMigrator.wait_for_server_ready`
2. :meth:`DatabaseMigrator.ensure_database_exists`
3. :meth:`DatabaseMigrator.ensure_postgis`
4. :meth:`DatabaseMigrator.upgrade_to_head`

All four are idempotent, so calling :meth:`DatabaseMigrator.migrate` again on
an already-migrated cluster is a fast no-op chain of existence checks.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import cast
from urllib.parse import SplitResult, urlsplit, urlunsplit

import asyncpg
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from groundmodel.infrastructure.db.alembic_config_helpers import set_config_option
from groundmodel.infrastructure.db.database_migrator_constants import (
    ALEMBIC_UPGRADE_TARGET,
    DEFAULT_READY_POLL_INTERVAL_SECONDS,
    DEFAULT_READY_TIMEOUT_SECONDS,
    MAINTENANCE_DATABASE_NAME,
    MIGRATIONS_DIR_NAME,
    POSTGIS_EXTENSION_NAME,
    STAGE_ALEMBIC,
    STAGE_CREATE_DATABASE,
    STAGE_POSTGIS,
    STAGE_WAITING_FOR_SERVER,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Injectable seam: opens an asyncpg connection given a raw (non-SQLAlchemy)
# DSN. Defaults to ``asyncpg.connect`` in production; unit tests inject a fake
# so no real socket or database is ever touched.
AsyncpgConnector = Callable[..., Awaitable[asyncpg.Connection]]

# Injectable seam: runs `alembic upgrade head` against a built Config. Defaults
# to the module-level wrapper below; unit tests inject a no-op fake so the
# happy path exercises the class's own logic without Alembic opening a real
# database connection through ``migrations/env.py``.
AlembicUpgradeRunner = Callable[[Config], None]


def _run_alembic_upgrade(config: Config) -> None:
    """Default `AlembicUpgradeRunner` — a plain callable wrapping `command.upgrade`."""
    command.upgrade(config, ALEMBIC_UPGRADE_TARGET)


class DatabaseMigratorError(RuntimeError):
    """Raised when a migration stage fails, naming which one.

    Co-located with :class:`DatabaseMigrator` rather than in
    ``shared/exceptions.py`` — it is meaningless outside this one caller,
    mirroring the existing ``VirtueleBoringFetchError`` /
    ``VirtueleBoringClient`` precedent (``virtuele_boring_client.py``).

    Parameters
    ----------
    stage : str
        One of the ``STAGE_*`` constants in ``database_migrator_constants.py``
        (``"waiting"`` / ``"create-database"`` / ``"postgis"`` /
        ``"alembic"``). ``migrate.py`` maps this to a distinct process exit
        code.
    message : str
        Human-readable failure description. This text is surfaced verbatim in
        a dialog a non-technical tester reads, so it must be self-contained —
        no "see logs for details".
    """

    def __init__(self, stage: str, message: str) -> None:
        """Initialise with the failed stage and a self-contained message."""
        super().__init__(message)
        self.stage = stage


def strip_asyncpg_driver_marker(sqlalchemy_url: str) -> str:
    """Convert a SQLAlchemy async DSN into a raw DSN `asyncpg.connect` accepts.

    Parameters
    ----------
    sqlalchemy_url : str
        A ``DATABASE_URL`` in SQLAlchemy async form, e.g.
        ``postgresql+asyncpg://user:pass@host:port/dbname``. The password
        segment may contain percent-encoded URL-special characters — the
        packaged app generates a random per-install password — and is never
        decoded or re-encoded here, only carried through unchanged.

    Returns
    -------
    str
        The same URL with the SQLAlchemy driver marker removed from the
        scheme (``postgresql+asyncpg`` -> ``postgresql``), which is the form
        ``asyncpg.connect`` (and libpq generally) accepts as a DSN.
    """
    parts = urlsplit(sqlalchemy_url)
    driver_free_scheme = parts.scheme.split("+", 1)[0]
    return urlunsplit((driver_free_scheme, parts.netloc, parts.path, parts.query, parts.fragment))


def _with_database_name(dsn: str, database_name: str) -> str:
    """Return `dsn` with its path replaced by `/database_name` (pure helper)."""
    parts = urlsplit(dsn)
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


class DatabaseMigrator(GroundModelLogger):
    """Takes a freshly-`initdb`'d, empty Postgres cluster to Alembic schema head.

    Every step logs the host/port/database/migrations-directory/revision it
    resolved, at INFO — on a coworker's machine with no terminal, the log file
    is the only debugging surface. Safe to call repeatedly: each step is an
    existence check before it acts.

    Parameters
    ----------
    connect : AsyncpgConnector, optional
        Opens an asyncpg connection given a raw DSN. Defaults to
        ``asyncpg.connect``. Overridden in tests so no real socket is opened.
    run_upgrade : AlembicUpgradeRunner, optional
        Runs `alembic upgrade head` against a built `Config`. Defaults to a
        thin wrapper around `alembic.command.upgrade`. Overridden in tests so
        no real database connection is opened through `migrations/env.py`.
    """

    def __init__(
        self,
        *,
        connect: AsyncpgConnector = asyncpg.connect,
        run_upgrade: AlembicUpgradeRunner = _run_alembic_upgrade,
    ) -> None:
        """Initialise with the (usually default) asyncpg connector and upgrade runner."""
        super().__init__(__name__)
        self._connect = connect
        self._run_upgrade = run_upgrade

    async def migrate(
        self,
        database_url: str,
        *,
        timeout_seconds: float = DEFAULT_READY_TIMEOUT_SECONDS,
        poll_interval_seconds: float = DEFAULT_READY_POLL_INTERVAL_SECONDS,
    ) -> None:
        """Run all four steps in order against a freshly started cluster.

        Parameters
        ----------
        database_url : str
            SQLAlchemy-form DSN (``postgresql+asyncpg://user:pass@host:port/db``)
            for the target application database — the same value
            ``groundmodel.shared.config.Settings.database_url`` resolves.
        timeout_seconds : float, optional
            Bounded wait for the server to accept connections. Defaults to
            :data:`DEFAULT_READY_TIMEOUT_SECONDS`.
        poll_interval_seconds : float, optional
            Delay between connection attempts while waiting. Defaults to
            :data:`DEFAULT_READY_POLL_INTERVAL_SECONDS`.

        Raises
        ------
        DatabaseMigratorError
            If any of the four steps fails, naming the stage.
        """
        target_dsn = strip_asyncpg_driver_marker(database_url)
        parts: SplitResult = urlsplit(target_dsn)
        database_name = parts.path.lstrip("/")
        host = parts.hostname or ""
        port = parts.port
        admin_dsn = _with_database_name(target_dsn, MAINTENANCE_DATABASE_NAME)

        self.info(
            f"Starting database migration — host={host} port={port} database={database_name!r}"
        )
        await self.wait_for_server_ready(
            admin_dsn,
            host=host,
            port=port,
            timeout_seconds=timeout_seconds,
            poll_interval_seconds=poll_interval_seconds,
        )
        await self.ensure_database_exists(admin_dsn, database_name)
        await self.ensure_postgis(target_dsn)
        await self.upgrade_to_head(database_url)
        self.success(
            f"Database migration complete — {database_name!r} at {host}:{port} is at schema head"
        )

    async def wait_for_server_ready(
        self,
        admin_dsn: str,
        *,
        host: str,
        port: int | None,
        timeout_seconds: float = DEFAULT_READY_TIMEOUT_SECONDS,
        poll_interval_seconds: float = DEFAULT_READY_POLL_INTERVAL_SECONDS,
    ) -> None:
        """Wait, bounded, for the server to accept connections.

        Electron spawns ``postgres.exe`` and calls this immediately; the
        server can need a second or two to start listening. Polls the
        maintenance database (``postgres`` — see
        :data:`~groundmodel.infrastructure.db.database_migrator_constants.MAINTENANCE_DATABASE_NAME`)
        because the target application database may not exist yet.

        Parameters
        ----------
        admin_dsn : str
            Raw asyncpg DSN pointed at the maintenance database.
        host : str
            Resolved host, used only for the log message and the timeout
            error (so it names where it looked).
        port : int | None
            Resolved port, used only for the log message and the timeout
            error.
        timeout_seconds : float, optional
            Total bounded wait. Defaults to :data:`DEFAULT_READY_TIMEOUT_SECONDS`.
        poll_interval_seconds : float, optional
            Delay between attempts. Defaults to
            :data:`DEFAULT_READY_POLL_INTERVAL_SECONDS`.

        Raises
        ------
        DatabaseMigratorError
            Stage ``"waiting"`` — the server never accepted a connection
            within `timeout_seconds`. The message names the host/port
            actually tried plus the last connection error.
        """
        self.info(
            f"Waiting for Postgres to accept connections at {host}:{port} "
            f"(timeout={timeout_seconds}s)"
        )
        deadline = time.monotonic() + timeout_seconds
        attempt = 0
        last_error: BaseException | None = None
        while time.monotonic() < deadline:
            attempt += 1
            try:
                conn = await self._connect(admin_dsn)
            except Exception as exc:  # noqa: BLE001 - startup errors vary by platform/driver
                last_error = exc
                self.debug(f"[attempt {attempt}] Postgres not ready yet at {host}:{port}: {exc}")
                await asyncio.sleep(poll_interval_seconds)
                continue
            await conn.close()
            self.success(
                f"Postgres accepting connections at {host}:{port} after {attempt} attempt(s)"
            )
            return
        raise DatabaseMigratorError(
            STAGE_WAITING_FOR_SERVER,
            f"Postgres never accepted connections at {host}:{port} within "
            f"{timeout_seconds}s ({attempt} attempts; last error: {last_error})",
        )

    async def ensure_database_exists(self, admin_dsn: str, database_name: str) -> None:
        """Create the target database if a fresh cluster does not have it yet.

        A fresh `initdb -U <user>` cluster has only `postgres` / `template0` /
        `template1`. `CREATE DATABASE` cannot run inside a transaction block —
        a single `asyncpg.Connection.execute()` call is not itself wrapped in
        one, so this is safe to issue directly.

        Parameters
        ----------
        admin_dsn : str
            Raw asyncpg DSN pointed at the maintenance database.
        database_name : str
            Name of the target application database.

        Raises
        ------
        DatabaseMigratorError
            Stage ``"create-database"`` — the existence check or the
            `CREATE DATABASE` statement failed.
        """
        self.info(f"Checking whether database {database_name!r} exists")
        conn = await self._connect(admin_dsn)
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", database_name
            )
            if exists:
                self.debug(f"Database {database_name!r} already exists — skipping CREATE DATABASE")
                return
            # Identifiers cannot be bound as query parameters; `database_name`
            # is our own configured app database name (not untrusted user
            # input), but the embedded quote is still doubled defensively.
            quoted_name = database_name.replace('"', '""')
            self.info(f"Database {database_name!r} does not exist — creating it")
            await conn.execute(f'CREATE DATABASE "{quoted_name}"')
            self.success(f"Database {database_name!r} created")
        except Exception as exc:
            raise DatabaseMigratorError(
                STAGE_CREATE_DATABASE, f"failed to ensure database {database_name!r} exists: {exc}"
            ) from exc
        finally:
            await conn.close()

    async def ensure_postgis(self, target_dsn: str) -> None:
        """Ensure the PostGIS extension is installed in the target database.

        Parameters
        ----------
        target_dsn : str
            Raw asyncpg DSN pointed at the target application database.

        Raises
        ------
        DatabaseMigratorError
            Stage ``"postgis"`` — `CREATE EXTENSION` or the version read-back
            failed.
        """
        self.info("Ensuring PostGIS extension is installed")
        conn = await self._connect(target_dsn)
        try:
            await conn.execute(f"CREATE EXTENSION IF NOT EXISTS {POSTGIS_EXTENSION_NAME}")
            version = await conn.fetchval(
                "SELECT extversion FROM pg_extension WHERE extname = $1", POSTGIS_EXTENSION_NAME
            )
            self.success(f"PostGIS extension ready — version {version}")
        except Exception as exc:
            raise DatabaseMigratorError(
                STAGE_POSTGIS, f"failed to ensure PostGIS extension: {exc}"
            ) from exc
        finally:
            await conn.close()

    async def upgrade_to_head(self, database_url: str) -> None:
        """Run `alembic upgrade head` with a programmatically built `Config`.

        `script_location` is resolved from this module's own location on
        disk (`Path(__file__).parent / "migrations"`) — never from `cwd` and
        never from `alembic.ini` — because the packaged app ships no
        `alembic.ini` and runs with an arbitrary working directory.

        Parameters
        ----------
        database_url : str
            SQLAlchemy-form DSN, set as the Config's `sqlalchemy.url` — this
            is what `migrations/env.py` reads to build its own async engine.

        Raises
        ------
        DatabaseMigratorError
            Stage ``"alembic"`` — building the script directory, reading the
            current revision, or running the upgrade itself failed.
        """
        self.info("Preparing Alembic upgrade to head")
        target_dsn = strip_asyncpg_driver_marker(database_url)
        migrations_dir = Path(__file__).resolve().parent / MIGRATIONS_DIR_NAME
        config = Config()
        set_config_option(config, "script_location", str(migrations_dir))
        set_config_option(config, "sqlalchemy.url", database_url)
        try:
            script = ScriptDirectory.from_config(config)
            head_revision = script.get_current_head()
            before_revision = await self._current_stamped_revision(target_dsn)
            self.info(
                f"Migrations directory: {migrations_dir} | head revision: {head_revision} | "
                f"database currently stamped at: {before_revision or '(unmigrated)'}"
            )
            # Off-thread on purpose. ``alembic.command.upgrade`` is
            # synchronous, but this project's ``migrations/env.py`` drives an
            # ASYNC engine and so calls ``asyncio.run`` itself — which raises
            # "cannot be called from a running event loop" when the caller is
            # already inside one, as it is here. A worker thread has no running
            # loop of its own, so env.py gets to make the fresh one it expects.
            await asyncio.to_thread(self._run_upgrade, config)
            after_revision = await self._current_stamped_revision(target_dsn)
            self.success(
                f"Alembic upgrade to head complete — database now stamped at: {after_revision}"
            )
        except Exception as exc:
            raise DatabaseMigratorError(
                STAGE_ALEMBIC, f"alembic upgrade to head failed: {exc}"
            ) from exc

    async def _current_stamped_revision(self, target_dsn: str) -> str | None:
        """Return the revision stamped in `alembic_version`, or None on a fresh database."""
        conn = await self._connect(target_dsn)
        try:
            result = await conn.fetchval("SELECT version_num FROM alembic_version LIMIT 1")
            return cast(str | None, result)
        except asyncpg.UndefinedTableError:
            return None
        finally:
            await conn.close()
