# Integration tests — operating rules

> Extracted from `CLAUDE.md` 2026-09-05 to keep the always-loaded file under its 40 KB budget. The rules are unchanged; the pointer in CLAUDE.md carries the short form.

**Integration tests run against a sibling DB, never the dev DB.**
``tests/integration/conftest.py`` TRUNCATEs every project-scoped
table at the start and end of every test, so running it against
``groundmodel`` (the dev DB) wipes whatever is imported. The repo
ships a separate ``groundmodel_integration`` DB on the same
dockerised Postgres instance + a wrapper script at
``scripts/run-integration-tests.ps1`` that points ``DATABASE_URL``
at it and runs ``alembic upgrade head`` first. A
``pytest_collection_modifyitems`` guard in the integration conftest
refuses to run if ``DATABASE_URL`` does not end in ``_integration``
or ``_test``, so a forgotten env var fails loudly instead of
silently destroying state.

**Only ONE integration run at a time.** The same per-test TRUNCATE
means two concurrent runs wipe each other's rows mid-test, and the
resulting failures look like logic bugs, not a race (FK violation on
a row just created; ``StaleDataError: expected to update 1 row(s); 0
were matched``; a 422 for a model the log shows being created 201).
The wrapper takes a lock at ``.integration-test.lock`` (repo root,
gitignored) and **ABORTS** — never waits, never kills — naming the
holder's pid, its liveness, and the ``Remove-Item`` line for a lock
left behind by a crash. Usage:

```
.\scripts\run-integration-tests.ps1                     # full suite
.\scripts\run-integration-tests.ps1 -q                  # quiet
.\scripts\run-integration-tests.ps1 tests/integration/api/test_cross_section.py
```

One-time bootstrap (already done; recreate after a docker volume
wipe with these three commands):

```
docker exec strix-db-1 psql -U groundmodel -d groundmodel `
  -c "CREATE DATABASE groundmodel_integration;"
docker exec strix-db-1 psql -U groundmodel -d groundmodel_integration `
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
.\scripts\run-integration-tests.ps1 --collect-only       # triggers migrations
```

Alembic honours ``DATABASE_URL`` when set (see
``src/groundmodel/infrastructure/db/migrations/env.py``), so the
wrapper script's env override carries through to migrations cleanly.

**The migration-parity test and the `CI` variable.**
``tests/integration/db/test_migration_upgrade_from_empty.py`` builds a
throwaway ``groundmodel_migration_test`` DB, runs ``alembic upgrade head``
on it and compares the schema with the ORM. It takes host, port, user,
password and its maintenance database from ``DATABASE_URL`` when that is
set (``tests/integration/db/scratch_db_dsn.py``) and falls back to the
docker-compose server (127.0.0.1:5433, groundmodel/groundmodel, maintenance
DB ``groundmodel``) otherwise. When PostgreSQL does not answer, the test
SKIPS on a developer machine but FAILS when the environment variable ``CI``
is set (GitHub Actions sets it), so a misconfigured CI database service
never passes silently. Do not export ``CI`` in a local shell unless you want
that strictness.
