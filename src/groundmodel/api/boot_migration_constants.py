"""Constants for the engine-side boot migration hook (:mod:`boot_migration`).

Grouped here per the project convention (module-level constants never live at
the top of a class/function file) so the env-var spelling the packaged launcher
writes and the engine reads lives in one place.
"""

from __future__ import annotations

from typing import Final

# The packaged Electron launcher sets this to ``"1"`` in the backend child's
# environment (``buildBackendEnv``) to request that the engine bring the
# database to schema head IN ITS OWN PROCESS, at the start of the FastAPI
# lifespan, before serving. It is DELIBERATELY absent in dev / CI / the e2e
# harness — those keep running migrations externally (``alembic upgrade head``
# by hand, ``scripts/run-integration-tests.ps1``), so the engine boot must be a
# no-op there. Named here (not a literal in the class) so the TS launcher and
# the Python engine agree on one spelling, the same pattern as
# ``STRIX_PG_DUMP_PATH`` / ``STRIX_BACKUP_DIR``.
ENGINE_MIGRATE_ENV: Final = "STRIX_ENGINE_MIGRATE"
