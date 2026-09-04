"""Engine-side database migration, run in-process at the start of the lifespan.

Why this exists
---------------
The packaged desktop app used to bring the schema to head with a SEPARATE
``python -m groundmodel.infrastructure.db.migrate`` child, spawned by the
Electron launcher AFTER the embedded Postgres finished booting and BEFORE the
API engine process was started. Measured on a cold first launch (owner report,
installer #13) that serialised three independent cold-start costs: ~60 s to boot
Postgres, then ~17 s for a whole second Python interpreter to start + import
SQLAlchemy/Alembic just to answer "already at head", then ~48 s for the engine's
own cold import — over a minute of it avoidable.

Folding the migration into the engine removes the second interpreter entirely
(its imports are a subset of the engine's) and lets the engine's ~48 s cold
import OVERLAP the embedded Postgres boot: the launcher now spawns the engine
concurrently with the database coming up, the engine imports everything first,
and only then — here — waits for Postgres and migrates.

What it does
------------
Delegates to the SAME :class:`~groundmodel.infrastructure.db.database_migrator.DatabaseMigrator`
the ``migrate.py`` CLI used, so the behaviour is unchanged: bounded wait for the
server to accept connections, create-database, ``CREATE EXTENSION postgis``, the
``HEAD_REVISION`` fast path, the pre-migration ``pg_dump`` checkpoint (via the
``STRIX_PG_DUMP_PATH`` / ``STRIX_BACKUP_DIR`` env the launcher already sets), and
the newer-database guard.

It is GATED on the packaged env flag
:data:`~groundmodel.api.boot_migration_constants.ENGINE_MIGRATE_ENV`: absent
(dev / CI / the e2e harness) it is a no-op, so those keep running migrations
externally.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from groundmodel.api.boot_migration_constants import ENGINE_MIGRATE_ENV
from groundmodel.infrastructure.db.database_migrator import DatabaseMigrator
from groundmodel.infrastructure.db.database_migrator_constants import (
    DEFAULT_READY_POLL_INTERVAL_SECONDS,
    DEFAULT_READY_TIMEOUT_SECONDS,
)
from groundmodel.shared.config import settings
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


def _engine_migration_requested(env: Mapping[str, str]) -> bool:
    """Return whether the packaged launcher asked the engine to migrate.

    Parameters
    ----------
    env : Mapping[str, str]
        Environment lookup (``os.environ`` in production; an explicit mapping in
        tests).

    Returns
    -------
    bool
        ``True`` only when :data:`ENGINE_MIGRATE_ENV` is set to a truthy value.
    """
    value = env.get(ENGINE_MIGRATE_ENV, "")
    return value.strip().lower() in {"1", "true", "yes", "on"}


async def run_boot_migration(
    *,
    env: Mapping[str, str] | None = None,
    database_url: str | None = None,
    migrator: DatabaseMigrator | None = None,
    timeout_seconds: float = DEFAULT_READY_TIMEOUT_SECONDS,
    poll_interval_seconds: float = DEFAULT_READY_POLL_INTERVAL_SECONDS,
) -> bool:
    """Bring the database to schema head in this process, if the launcher asked.

    Waits (bounded) for Postgres to accept connections, then runs the migration
    in-process. A no-op — returning ``False`` — when the packaged env flag is
    absent, so dev / CI / e2e keep running migrations externally.

    Parameters
    ----------
    env : Mapping[str, str] | None, optional
        Environment lookup. Defaults to ``os.environ``.
    database_url : str | None, optional
        SQLAlchemy-form DSN. Defaults to the resolved ``settings.database_url``
        — the same DSN the launcher hands the engine via ``DATABASE_URL``.
    migrator : DatabaseMigrator | None, optional
        The migrator to run. Defaults to a fresh :class:`DatabaseMigrator` (which
        reads ``STRIX_PG_DUMP_PATH`` / ``STRIX_BACKUP_DIR`` from ``os.environ``).
        Injected in tests.
    timeout_seconds : float, optional
        Bounded wait for the server to accept connections. Defaults to
        :data:`DEFAULT_READY_TIMEOUT_SECONDS` — the same timeout ``migrate.py``
        used.
    poll_interval_seconds : float, optional
        Delay between connection attempts while waiting. Defaults to
        :data:`DEFAULT_READY_POLL_INTERVAL_SECONDS`.

    Returns
    -------
    bool
        ``True`` when a migration was run, ``False`` when skipped (dev/external).

    Raises
    ------
    DatabaseMigratorError
        A migration stage failed (waiting for the server, create-database,
        postgis, the pre-migration backup, or the Alembic upgrade). Propagated
        so the lifespan startup fails loudly rather than serving against an
        unmigrated database; the migrator has already logged the failing stage.
    NewerDatabaseError
        The store was written by a newer StrixGeo; the migrator raised its own
        self-contained "install the current version" message.
    """
    resolved_env: Mapping[str, str] = env if env is not None else os.environ
    if not _engine_migration_requested(resolved_env):
        logger.info(
            f"engine-side migration not requested (no {ENGINE_MIGRATE_ENV}) — "
            "leaving migrations to the external path (dev/CI/e2e)"
        )
        return False

    dsn = database_url if database_url is not None else settings.database_url
    active_migrator = migrator if migrator is not None else DatabaseMigrator()
    logger.info(
        "engine-side migration requested — bringing the database to head "
        f"(timeout={timeout_seconds}s)"
    )
    await active_migrator.migrate(
        dsn,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )
    return True
