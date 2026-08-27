"""CLI entrypoint — bring the configured database to Alembic schema head.

Invoked by the Electron main process on every launch of the bundled-Postgres
distribution path (debt #2), after it has ``initdb``'d a per-user data
directory and started ``postgres.exe`` on a dynamically chosen free port, and
before the FastAPI backend starts. Also safe to run by hand against the dev
Docker Postgres — it is idempotent on an already-migrated cluster.

Modelled on ``groundmodel.api.serve`` (the existing ``python -m`` entrypoint
precedent in this codebase): a thin ``argparse`` shim around one class, no
business logic here.

Exit code contract
-------------------
``0``  — the cluster is at schema head.
``1``  — the server never accepted a connection within the timeout.
``2``  — the target database could not be created.
``3``  — the PostGIS extension could not be ensured.
``4``  — the Alembic upgrade itself failed.
``10`` — an unexpected error outside the four named stages.

On any non-zero exit, exactly one human-readable line naming the failed stage
is printed to stderr — this text is read by a non-technical tester, in a
dialog, with no terminal and no stack trace available.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from groundmodel.infrastructure.db.database_migrator import (
    DatabaseMigrator,
    DatabaseMigratorError,
)
from groundmodel.infrastructure.db.database_migrator_constants import (
    DEFAULT_READY_TIMEOUT_SECONDS,
    EXIT_CODE_BY_STAGE,
    EXIT_CODE_UNEXPECTED,
)
from groundmodel.shared.config import settings
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the arguments the Electron launcher passes.

    Parameters
    ----------
    argv : list[str] | None, optional
        Argument vector; defaults to ``sys.argv[1:]``.

    Returns
    -------
    argparse.Namespace
        Parsed ``database_url`` / ``timeout``.
    """
    parser = argparse.ArgumentParser(
        description="Bring the configured Postgres cluster to Alembic schema head."
    )
    parser.add_argument(
        "--database-url",
        default=settings.database_url,
        help="SQLAlchemy-form DSN (postgresql+asyncpg://user:pass@host:port/db). "
        "Defaults to the resolved DATABASE_URL / Settings.database_url.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_READY_TIMEOUT_SECONDS,
        help="Seconds to wait for the server to accept connections before failing.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run the migrator once and return the process exit code.

    Parameters
    ----------
    argv : list[str] | None, optional
        Argument vector; defaults to ``sys.argv[1:]``.

    Returns
    -------
    int
        ``0`` on success; see the module docstring for the failure codes.
    """
    args = _parse_args(argv)
    logger.info(f"migrate.py starting — timeout={args.timeout}s")
    migrator = DatabaseMigrator()
    try:
        asyncio.run(migrator.migrate(args.database_url, timeout_seconds=args.timeout))
    except DatabaseMigratorError as exc:
        exit_code = EXIT_CODE_BY_STAGE.get(exc.stage, EXIT_CODE_UNEXPECTED)
        logger.error(f"Database migration failed during {exc.stage}: {exc}")
        print(f"Database migration failed during {exc.stage}: {exc}", file=sys.stderr)
        return exit_code
    except Exception as exc:  # noqa: BLE001 - last-resort guard for a non-technical error dialog
        logger.exception("Database migration failed with an unexpected error")
        print(f"Database migration failed unexpectedly: {exc}", file=sys.stderr)
        return EXIT_CODE_UNEXPECTED
    logger.success("migrate.py finished — database is at schema head")
    return 0


if __name__ == "__main__":
    sys.exit(main())
