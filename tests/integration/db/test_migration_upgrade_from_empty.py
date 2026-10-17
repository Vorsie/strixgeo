"""Upgrade-from-empty schema-parity gate (TEST-08).

The old migration *round-trip* test (upgrade → downgrade → upgrade) is
dead: two migrations deliberately ``raise NotImplementedError`` on
downgrade under the pre-ship backwards-compat suspension (owner
directive 2026-05-16). Downgrade is no longer a supported path, so a
round-trip assertion tests a contract we've abandoned.

This is the honest replacement. It answers the question that still
matters: **does ``alembic upgrade head`` against an empty database
produce a schema that matches the ORM ``Base.metadata``?** If a
migration and its ORM model drift apart (a column the migration forgot,
a NOT-NULL the migration never tightened, a UniqueConstraint the ORM
declares but no migration creates), the next ``from_attributes`` read or
INSERT fails in production — and nothing else in the suite catches it,
because every other integration test runs against a DB that was already
migrated by the wrapper script.

How it works
------------
1. Create a throwaway scratch DB (``groundmodel_migration_test``; the
   ``_test`` suffix satisfies the integration-conftest DB-name guard) on
   the server ``DATABASE_URL`` names (the docker-compose server when it is
   unset, see ``scratch_db_dsn.py``), add the PostGIS extension. An
   unreachable server skips the test locally and FAILS it when ``CI`` is
   set, so a misconfigured CI service never passes silently.
2. ``alembic upgrade head`` against it via a subprocess with a
   ``DATABASE_URL`` override — the same override path
   ``run-integration-tests.ps1`` uses, exercising the real
   ``migrations/env.py`` async upgrade.
3. Reflect the live schema and run Alembic's
   ``compare_metadata(MigrationContext, Base.metadata)``. An empty
   *structural* diff = parity.
4. Drop the scratch DB in teardown (``WITH (FORCE)`` to evict the
   subprocess's lingering connections).

The scratch DB is created and dropped by THIS test alone. It never
touches ``groundmodel_integration`` (another task owns that) or the dev
``groundmodel`` DB beyond the maintenance ``CREATE``/``DROP DATABASE``
statements issued on the maintenance connection (the database named in
``DATABASE_URL``, or ``groundmodel`` when it is unset).

The allowlist — why the assertion is on *structural* diffs, not "empty"
----------------------------------------------------------------------
``compare_metadata`` cannot round-trip every object Alembic itself
emitted. Two whole classes of diff are pure representation noise and are
filtered EXPLICITLY (see ``_is_allowlisted_noise``), each justified:

* **Migration-only / partial indexes** — objects that live only in the
  DB because the ORM intentionally does not (and often cannot) declare
  them in metadata. Every ``*_dov_permkey`` unique index and the
  ``uq_cpt_*`` / ``uq_borehole_*`` / ``uq_geological_model_one_active_per_kind``
  constraints are **partial** indexes (``postgresql_where=...``), which
  are not expressible as an ORM ``UniqueConstraint``; a handful of plain
  perf indexes (e.g. ``ix_geological_model_parent_id``) were likewise
  created in migrations without a metadata declaration. Autogenerate
  sees them in the DB, not in ``Base.metadata``, and reports
  ``remove_index`` / ``remove_constraint``. Dropping them would be wrong,
  so they are noise, not drift.

* **Same-column rename pairs** — a ``remove_*`` + ``add_*`` couple that
  cover the *identical column set* under two different names (the ORM's
  default ``ix_<table>_<col>`` vs a migration's hand-picked
  ``idx_...``). The index/constraint exists and is correct; only the
  name differs. Both halves are noise.

Crucially, the allowlist is **kind-scoped**: it only ever forgives
``add_index`` / ``remove_index`` / ``add_constraint`` /
``remove_constraint``. Any *structural* diff — ``add_column`` /
``remove_column`` / ``modify_nullable`` / ``modify_type`` /
``modify_default`` / ``add_table`` / ``remove_table`` — is NEVER
allowlisted and fails the test. That is exactly the drift class that
bites at runtime, and exactly what a parity gate must guard. (This gate
caught, and a companion migration ``z0a1b2c3d4e5`` fixed, four genuine
``body_boundary_shape`` drifts: a never-tightened ``body_id`` nullable,
a missing ``uq_body_boundary_shape_body_id``, and two orphaned timestamp
columns.)

Every filtered diff is printed to stdout under ``-s`` so the noise is
auditable, never silently swallowed.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator
from typing import NoReturn

import pytest

from tests.integration.db.scratch_db_dsn import (
    scratch_server_from_env,
    unreachable_server_is_fatal,
)

# psycopg2 (sync) drives the maintenance CREATE/DROP DATABASE — asyncpg
# is the app driver, but CREATE DATABASE cannot run inside a transaction,
# and psycopg2's autocommit mode is the simplest way to issue it.
try:
    import psycopg2
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine
    from sqlalchemy.exc import OperationalError

    import groundmodel.infrastructure.db.models  # noqa: F401 — registers tables on Base.metadata
    from groundmodel.infrastructure.db.base import Base

    _IMPORTS_OK = True
except ImportError:  # pragma: no cover — deps always present in the test env
    _IMPORTS_OK = False

# ---------------------------------------------------------------------------
# Scratch-DB connection strings.
#
# The server comes from ``DATABASE_URL`` when it is set (CI's PostGIS
# service, or the wrapper's integration DB) and falls back to the
# docker-compose server (127.0.0.1:5433, groundmodel/groundmodel). The
# maintenance connection only issues CREATE/DROP DATABASE; it never reads
# or writes any table there.
# ---------------------------------------------------------------------------
_SERVER = scratch_server_from_env(os.environ)
# The ``_test`` suffix is load-bearing: the integration-conftest DB-name
# guard only tolerates ``_integration`` / ``_test`` databases.
_SCRATCH_DB = "groundmodel_migration_test"

_MAINTENANCE_DSN = _SERVER.maintenance_dsn()
_SCRATCH_SYNC_DSN = _SERVER.scratch_sync_dsn(_SCRATCH_DB)
_SCRATCH_ASYNC_DSN = _SERVER.scratch_async_dsn(_SCRATCH_DB)

# Diff operations that are ONLY ever representation noise (index/constraint
# naming that autogenerate cannot round-trip). Everything else — column,
# type, nullability, default, table — is structural and must be empty.
_ALLOWLISTED_OPS = frozenset({"add_index", "remove_index", "add_constraint", "remove_constraint"})


def _run_maintenance(sql: str) -> None:
    """Execute one maintenance statement in autocommit mode.

    Parameters
    ----------
    sql : str
        A single DDL statement (``CREATE DATABASE`` / ``DROP DATABASE``).
        Runs against the always-present maintenance DB, never a test DB.
    """
    conn = psycopg2.connect(_MAINTENANCE_DSN)
    conn.autocommit = True  # CREATE/DROP DATABASE cannot run in a transaction.
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
    finally:
        conn.close()


def _diff_op(diff: object) -> str:
    """Return the Alembic operation name for one ``compare_metadata`` entry.

    Alembic yields either a plain tuple ``(op, obj, ...)`` for table /
    index / constraint / column adds+removes, or a *list* of tuples for
    column alterations (``[('modify_nullable', ...)]``). Normalise both to
    the leading operation string.

    Parameters
    ----------
    diff : object
        One element of the ``compare_metadata`` result list.

    Returns
    -------
    str
        The operation name (e.g. ``"remove_index"``, ``"modify_nullable"``,
        ``"add_column"``), or ``"<unknown>"`` if the shape is unrecognised
        (treated as structural — fail closed).
    """
    if isinstance(diff, list):
        # Column-alteration diffs arrive as a list of (op, ...) tuples.
        if diff and isinstance(diff[0], tuple) and diff[0]:
            return str(diff[0][0])
        return "<unknown>"
    if isinstance(diff, tuple) and diff:
        return str(diff[0])
    return "<unknown>"


def _is_allowlisted_noise(diff: object) -> bool:
    """Is this diff pure index/constraint naming noise (safe to filter)?

    Only index/constraint add/remove operations are ever allowlisted (see
    ``_ALLOWLISTED_OPS``). Structural diffs (columns, types, nullability,
    defaults, tables) always return ``False`` and therefore fail the gate.

    Parameters
    ----------
    diff : object
        One ``compare_metadata`` entry.

    Returns
    -------
    bool
        ``True`` when the diff is an allowlisted index/constraint op.
    """
    return _diff_op(diff) in _ALLOWLISTED_OPS


def _skip_or_fail(reason: str) -> NoReturn:
    """Skip the test on a developer machine, fail it when ``CI`` is set.

    Parameters
    ----------
    reason : str
        Why the server could not be used; shown in the skip or failure.

    Raises
    ------
    pytest.fail.Exception
        Always when ``CI`` is set: the test fails.
    pytest.skip.Exception
        Always otherwise: the test is skipped.
    """
    if unreachable_server_is_fatal(os.environ):
        pytest.fail(f"CI is set, so an unusable PostgreSQL fails the test: {reason}")
    pytest.skip(reason)


@pytest.fixture
def scratch_db() -> Iterator[None]:
    """Create + migrate a throwaway DB, yield, then drop it.

    Skips cleanly if Postgres is unreachable on a developer machine
    (container down) so the suite stays green offline. When ``CI`` is set
    the same failure FAILS the test: there the PostGIS service belongs to
    the job, and a silent skip would hide a misconfigured service.

    Yields
    ------
    None
        The fixture's only job is lifecycle; the test reads the module's
        DSN constants directly.
    """
    # Reachability probe: skip locally, fail under CI.
    try:
        _run_maintenance("SELECT 1")
    except psycopg2.OperationalError as exc:  # pragma: no cover - env-dependent
        _skip_or_fail(f"Postgres unreachable at {_SERVER.host}:{_SERVER.port}: {exc}")

    # Clean any leftover from an aborted prior run, then create fresh.
    _run_maintenance(f"DROP DATABASE IF EXISTS {_SCRATCH_DB} WITH (FORCE)")
    _run_maintenance(f"CREATE DATABASE {_SCRATCH_DB}")
    try:
        # PostGIS must exist before the geometry-bearing migrations run.
        ext_conn = psycopg2.connect(_SCRATCH_SYNC_DSN)
        ext_conn.autocommit = True
        try:
            with ext_conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        finally:
            ext_conn.close()

        # Real upgrade through migrations/env.py's async path. Subprocess
        # (not command.upgrade in-process) so the env.py ``asyncio.run``
        # never nests inside pytest-asyncio's event loop.
        env = dict(os.environ, DATABASE_URL=_SCRATCH_ASYNC_DSN)
        result = subprocess.run(
            ["uv", "run", "alembic", "upgrade", "head"],
            env=env,
            cwd=os.getcwd(),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise AssertionError(
                "alembic upgrade head failed on the scratch DB "
                f"(rc={result.returncode}).\nstdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )
        yield
    finally:
        _run_maintenance(f"DROP DATABASE IF EXISTS {_SCRATCH_DB} WITH (FORCE)")


@pytest.mark.skipif(not _IMPORTS_OK, reason="psycopg2 / alembic / sqlalchemy not importable")
def test_upgrade_head_matches_orm_metadata(scratch_db: None) -> None:
    """``upgrade head`` on an empty DB must produce ORM-parity structure.

    After a full ``alembic upgrade head`` the live schema must match
    ``Base.metadata`` with ZERO structural diffs. Index/constraint naming
    noise (partial indexes the ORM can't declare; same-column rename
    pairs) is filtered explicitly and reported — everything else fails.
    """
    our_tables = {t.name for t in Base.metadata.tables.values()}

    def include_name(name: str | None, type_: str, parent_names: object) -> bool:
        """Restrict autogenerate to application tables (mirror env.py).

        Skips PostGIS-owned system tables (``spatial_ref_sys`` etc.) that
        live in the DB but are not part of ``Base.metadata`` — identical
        to the ``include_name`` callback in ``migrations/env.py``.
        """
        if type_ == "table":
            return name in our_tables
        return True

    engine = create_engine(_SCRATCH_SYNC_DSN)
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "include_name": include_name,
                    # env.py does not enable type / server-default comparison;
                    # match it so the gate flags STRUCTURE, not cosmetic
                    # server-default text representation.
                    "compare_type": False,
                    "compare_server_default": False,
                },
            )
            diffs = compare_metadata(context, Base.metadata)
    except OperationalError as exc:  # pragma: no cover - env-dependent
        _skip_or_fail(f"Could not reflect scratch schema: {exc}")
    finally:
        engine.dispose()

    allowlisted = [d for d in diffs if _is_allowlisted_noise(d)]
    structural = [d for d in diffs if not _is_allowlisted_noise(d)]

    # Report the filtered noise so it is auditable, never silently dropped.
    print(
        f"\n[migration-parity] filtered {len(allowlisted)} allowlisted "
        f"index/constraint-naming diff(s):"
    )
    for d in allowlisted:
        print(f"  - {_diff_op(d)}: {d!r}")

    assert not structural, (
        f"{len(structural)} STRUCTURAL schema diff(s) between `upgrade head` "
        "and Base.metadata — the migration chain drifted from the ORM. Each "
        "is a column / type / nullability / default / table mismatch that "
        "will fail at runtime; author a migration to reconcile:\n"
        + "\n".join(f"  - {_diff_op(d)}: {d!r}" for d in structural)
    )
