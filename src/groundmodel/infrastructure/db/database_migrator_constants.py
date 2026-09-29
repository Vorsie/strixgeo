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

# The Alembic head revision THIS build ships, as a plain constant.
#
# It lets :meth:`DatabaseMigrator.upgrade_to_head` take a FAST PATH: when the
# database is already stamped exactly here, the migrator returns after one cheap
# ``SELECT version_num`` read, WITHOUT building the ScriptDirectory (which loads
# all ~104 migration modules) or spinning up ``env.py``'s async engine to run a
# no-op ``alembic upgrade head``. On the packaged interpreter that machinery
# costs ~30s with nothing to migrate (owner report, installer #12: "Preparing
# Alembic upgrade to head" +10s -> "already at head" +13s -> "upgrade complete"
# +6s), every single launch.
#
# The value MUST equal ``ScriptDirectory.get_current_head()``. Two safety nets
# keep it honest: (1) ``test_head_revision_constant_matches_script_directory``
# turns RED in the pre-commit unit suite if a new migration lands without
# bumping this — so a stale constant is caught at test time, never in a user's
# store; (2) at runtime ANY value other than an exact match (a fresh DB with no
# table, a behind-head revision, an unknown newer one) falls through to the full
# Alembic path, which behaves exactly as before — slow, never wrong. Bump this
# in the SAME commit as any new migration.
HEAD_REVISION: Final = "b7c8d9e0f1a2"

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
# The pre-migration checkpoint (pg_dump) stage. A failure here ABORTS the
# upgrade — we never migrate a store with pending data-rewriting migrations
# without a recovery point first (production-readiness audit H2b).
STAGE_BACKUP: Final = "backup"

# Process exit codes `migrate.py` returns, keyed by stage. Distinct codes let
# the Electron main process (or a support script) distinguish failure classes
# without parsing the log text. 0 (success) is never in this map.
EXIT_CODE_BY_STAGE: Final[dict[str, int]] = {
    STAGE_WAITING_FOR_SERVER: 1,
    STAGE_CREATE_DATABASE: 2,
    STAGE_POSTGIS: 3,
    STAGE_ALEMBIC: 4,
    STAGE_BACKUP: 5,
}

# Exit code for the "database written by a newer StrixGeo" case (an older build
# opened over a store a newer build already migrated). Distinct from the stage
# codes because it is raised as its own ``NewerDatabaseError``, not a
# ``DatabaseMigratorError`` — the launcher shows a specific "install the current
# version; your data is intact" message rather than a generic failure
# (production-readiness audit H2c / M8).
EXIT_CODE_NEWER_DATABASE: Final = 6

# Fallback exit code for a failure this module did not itself name a stage
# for (a bug, not one of the four expected failure classes).
EXIT_CODE_UNEXPECTED: Final = 10

# Environment variables the packaged Electron launcher sets so the migrator can
# write a pre-migration ``pg_dump`` checkpoint. Both must be present for a dump
# to happen; in dev neither is set and the dump is skipped (a dev DB is not the
# user's only copy). Named here (not literals in the class) so the launcher and
# the migrator agree on one spelling.
STRIX_PG_DUMP_PATH_ENV: Final = "STRIX_PG_DUMP_PATH"
STRIX_BACKUP_DIR_ENV: Final = "STRIX_BACKUP_DIR"

# How many pre-migration ``pre-*.dump`` checkpoints to keep in the backup
# directory. Five is enough to recover across a run of a few bad upgrades
# without letting the checkpoints grow without bound (a full store dump is not
# tiny). The newest five survive; older ones are pruned after each new dump.
BACKUP_RETENTION_COUNT: Final = 5
