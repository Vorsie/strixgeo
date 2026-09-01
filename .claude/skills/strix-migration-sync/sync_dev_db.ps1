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

# ⚠ OWNER-GATED MIGRATION GUARD (debt #278 R3, 2026-09-01). Revision
# a4b5c6d7e8f9 (merge_geo_label_twin_formations) is a ONE-TIME DESTRUCTIVE
# data repair that lives on branch `pending-278-twins-migration` and must only
# run against the dev DB after the owner's explicit go (pg_dump backup + the
# scripts/dry_run_twins_migration.sql preview first). If that revision is
# present in versions/ (the branch was merged), STOP and confirm with the
# owner before syncing. Remove this guard once the migration has been run.
$twinsMigration = Get-ChildItem "$PSScriptRoot\..\..\..\src\groundmodel\infrastructure\db\migrations\versions" -Filter "a4b5c6d7e8f9_*.py" -ErrorAction SilentlyContinue
if ($twinsMigration) {
    Write-Host "ABORT: the owner-gated twins-merge migration (a4b5c6d7e8f9) is in versions/." -ForegroundColor Red
    Write-Host "Run scripts/dry_run_twins_migration.sql, take a pg_dump backup, and get the owner's" -ForegroundColor Red
    Write-Host "explicit go before syncing the dev DB. See docs/debt.md #278 R3." -ForegroundColor Red
    exit 1
}

Write-Host "Dev DB revision BEFORE:" -ForegroundColor Cyan
uv run alembic current
Write-Host "`nUpgrading dev DB to head..." -ForegroundColor Cyan
uv run alembic upgrade head
Write-Host "`nDev DB revision AFTER:" -ForegroundColor Green
uv run alembic current
