"""DB-integration test fixtures.

The shared ``db_session`` fixture + ``make_project`` helper moved
one level up to ``tests/integration/conftest.py`` (debt #22) so the
new API-level tests under ``tests/integration/api/`` can reuse the
same engine + truncate semantics. This file is kept for any future
db-only fixtures and as the import shim — existing tests already
import ``make_project`` from this module by name.
"""

from tests.integration.conftest import make_project  # noqa: F401 — re-export for tests
