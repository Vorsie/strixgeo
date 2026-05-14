#!/usr/bin/env pwsh
# Runs the integration suite against a throwaway DB so the dev DB
# (``groundmodel``) keeps its imported state. See CLAUDE.md
# "Development Workflow" for context.
#
# One-time setup (already done; here for documentation):
#   docker exec strix-db-1 psql -U groundmodel -d groundmodel `
#     -c "CREATE DATABASE groundmodel_integration;"
#   docker exec strix-db-1 psql -U groundmodel -d groundmodel_integration `
#     -c "CREATE EXTENSION IF NOT EXISTS postgis;"
#   $env:DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel_integration"
#   uv run alembic upgrade head
#
# Per-run flow:
#   1. Point DATABASE_URL at the integration DB.
#   2. ``alembic upgrade head`` (idempotent — no-op when already current).
#   3. Run pytest with whatever args the caller passed through.
#
# The conftest's pytest_collection_modifyitems guard refuses to run
# unless DATABASE_URL ends in "_integration" or "_test", so a forgotten
# env var fails loudly instead of silently TRUNCATE'ing the dev DB.

# NOTE: do NOT set $ErrorActionPreference = "Stop". Native exes (alembic,
# pytest) write progress to stderr; with Stop set, every stderr line gets
# wrapped as an ErrorRecord and aborts the script. Check $LASTEXITCODE
# explicitly instead — that's the real native-program success signal.

$env:DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel_integration"

Write-Host "==> alembic upgrade head (integration DB)"
uv run alembic upgrade head
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Default the path to tests/integration, then append whatever flags
# the caller passed. Lets you do ``run-integration-tests.ps1 -q`` for
# the full suite quiet, or ``run-integration-tests.ps1 tests/integration/api/test_cross_section.py``
# for a narrow target. (Path args override the default; flag args extend it.)
$pathArgs = @()
$flagArgs = @()
foreach ($a in $args) {
    if ($a.StartsWith("-")) { $flagArgs += $a } else { $pathArgs += $a }
}
if ($pathArgs.Count -eq 0) { $pathArgs = @("tests/integration") }
$pytestArgs = $pathArgs + $flagArgs

Write-Host "==> pytest $pytestArgs"
uv run pytest @pytestArgs
exit $LASTEXITCODE
