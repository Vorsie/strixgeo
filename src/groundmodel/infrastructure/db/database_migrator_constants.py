"""Constants for :class:`DatabaseMigrator` and its CLI shim ``migrate.py``.

Grouped here per the project convention (module-level constants never live at
the top of a class file) so a value change — a longer boot timeout, a renamed
stage — touches one place.
"""

from __future__ import annotations

from typing import Final

# Every Postgres cluster ships this database. It is used both as the probe
# target while waiting for the server to come up (a fresh `initdb` cluster has
# only `postgres` / `template0` / `template1` — the application database does
# not exist yet) and as the connection `CREATE DATABASE` runs from, since a
# database cannot be created while connected to itself.
MAINTENANCE_DATABASE_NAME: Final = "postgres"

# Extension installed into the target (application) database, never into the
# maintenance database.
POSTGIS_EXTENSION_NAME: Final = "postgis"

# Bounded wait for `postgres.exe` to start accepting connections after
# Electron spawns it. A cold start is typically 1-2s; 30s leaves headroom on a
# loaded machine without hanging app startup indefinitely on a genuine failure
# (wrong port, crashed process, antivirus quarantine — see
# docs/distribution-db-decision.md Fork A failure-mode table).
DEFAULT_READY_TIMEOUT_SECONDS: Final = 30.0

# Poll interval while waiting for the server to accept connections. Fine
# enough that the typical fast start is not held up by a coarse sleep, coarse
# enough not to spam connection attempts.
DEFAULT_READY_POLL_INTERVAL_SECONDS: Final = 0.25

# Directory name, sibling to `database_migrator.py` on disk, that Alembic's
# `script_location` resolves to. Resolved from `Path(__file__)`, never from
# `cwd` or `alembic.ini` — the packaged app ships no `alembic.ini` and runs
# with an arbitrary working directory.
MIGRATIONS_DIR_NAME: Final = "migrations"

# Alembic upgrade target — always the tip of the migration chain.
ALEMBIC_UPGRADE_TARGET: Final = "head"

# SQLAlchemy async driver marker. `DATABASE_URL` / `Settings.database_url` are
# expressed as `postgresql+asyncpg://...` (the form SQLAlchemy's async engine
# and Alembic's `env.py` expect); raw `asyncpg.connect()` wants a plain
# `postgresql://...` DSN and errors on an unrecognised scheme.
SQLALCHEMY_ASYNCPG_DRIVER_MARKER: Final = "+asyncpg"

# Stage names a migration failure is attributed to. Used both in the
# `DatabaseMigratorError.stage` attribute and the CLI's failure message, so a
# non-technical tester's error dialog names the step that broke instead of a
# generic "migration failed".
STAGE_WAITING_FOR_SERVER: Final = "waiting"
STAGE_CREATE_DATABASE: Final = "create-database"
STAGE_POSTGIS: Final = "postgis"
STAGE_ALEMBIC: Final = "alembic"

# Process exit codes `migrate.py` returns, keyed by stage. Distinct codes let
# the Electron main process (or a support script) distinguish failure classes
# without parsing the log text. 0 (success) is never in this map.
EXIT_CODE_BY_STAGE: Final[dict[str, int]] = {
    STAGE_WAITING_FOR_SERVER: 1,
    STAGE_CREATE_DATABASE: 2,
    STAGE_POSTGIS: 3,
    STAGE_ALEMBIC: 4,
}

# Fallback exit code for a failure this module did not itself name a stage
# for (a bug, not one of the four expected failure classes).
EXIT_CODE_UNEXPECTED: Final = 10
