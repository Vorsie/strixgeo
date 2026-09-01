# Sync the DEV database to head after a migration-bearing change.
#
# The integration wrapper (run-integration-tests.ps1) only migrates the SIBLING
# groundmodel_integration DB. The dev DB (groundmodel) lags, and a lagging dev DB
# surfaces in the desktop app as a generic 500 that the frontend reports as a
# misleading CORS error. See memory feedback_migrate_dev_db_after_migration_fix.
#
# This runs alembic with NO DATABASE_URL override, so it targets the dev DB from
# .env. Forward-only (`upgrade head`). Prints the revision before and after.

$ErrorActionPreference = "Stop"
Write-Host "Dev DB revision BEFORE:" -ForegroundColor Cyan
uv run alembic current
Write-Host "`nUpgrading dev DB to head..." -ForegroundColor Cyan
uv run alembic upgrade head
Write-Host "`nDev DB revision AFTER:" -ForegroundColor Green
uv run alembic current
