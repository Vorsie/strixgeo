#!/usr/bin/env pwsh
# Runs the Playwright Electron e2e suite end-to-end, self-contained.
#
# The suite needs a live FastAPI backend on :8765 serving the seeded
# synthetic fixture: spec ``beforeAll`` hooks + DB helpers talk to it, and
# each test's ``launchApp`` Electron ALSO tries to spawn its own uvicorn —
# which simply loses the port race to this standalone one (the renderer
# talks to whichever backend holds :8765). Running a single standalone
# backend here is the intended mode (see desktop/tests/e2e/helpers/
# electron_launch.ts) and is faster than a per-test spawn.
#
# Per-run flow:
#   1. Point DATABASE_URL at the integration DB.
#   2. ``alembic upgrade head`` (idempotent).
#   3. Start a standalone uvicorn on :8765 in the background.
#   4. Wait for readiness, then seed the synthetic fixture (prints the
#      deterministic project id on stdout; logs go to stderr).
#   5. Run ``npx playwright test`` with whatever args the caller passed.
#   6. Always stop the backend + free :8765 on the way out.
#
# Prerequisites: ``npm run build`` in desktop/ (the Electron main entry must
# exist) and Docker Postgres on :5433.
#
# Usage:
#   .\scripts\run-e2e.ps1                                  # full suite
#   .\scripts\run-e2e.ps1 flow_auto_correlate              # one spec
#   .\scripts\run-e2e.ps1 --reporter=list                  # pass-through flags
#
# NOTE: do NOT set $ErrorActionPreference = "Stop". Native exes (alembic,
# uvicorn, npx) write progress to stderr; with Stop set, every stderr line
# gets wrapped as an ErrorRecord and aborts the script. Check $LASTEXITCODE
# explicitly instead.

$env:DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel_integration"

# node-postgres (the e2e db_helper) tolerates the +asyncpg suffix; the
# backend REQUIRES it. One value serves both — see the e2e specs' DATABASE_URL
# default and helpers/electron_launch.ts.

function Get-PortListener {
    return Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

# SAFETY: never kill a backend we did not start. The dev desktop app spawns
# its own uvicorn on :8765 with the DEV DB (``groundmodel``); silently killing
# it and substituting an integration-DB backend would point a live dogfeed
# session at the wrong database. If :8765 is already busy, abort and let the
# user close their app (or stop that backend) themselves.
$existing = Get-PortListener
if ($existing) {
    Write-Error (
        "Port 8765 is already in use (pid $($existing.OwningProcess)). " +
        "Close the dev desktop app (or stop whatever backend holds :8765) " +
        "before running the e2e suite — this script will NOT kill it, because " +
        "it may be your dev backend pointed at the dev DB."
    )
    exit 1
}

Write-Host "==> alembic upgrade head (integration DB)"
uv run alembic upgrade head
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> starting uvicorn on :8765"
$uvicorn = Start-Process -FilePath "uv" `
    -ArgumentList @(
        "run", "uvicorn", "groundmodel.api.main:app",
        "--host", "127.0.0.1", "--port", "8765", "--log-level", "warning"
    ) `
    -PassThru -NoNewWindow

try {
    # Wait for readiness (max ~15 s).
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:8765/docs" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) {
        Write-Error "backend did not become ready on :8765"
        exit 1
    }
    Write-Host "==> backend ready"

    Write-Host "==> seeding synthetic fixture"
    # The builder prints the project id (a bare UUID) on stdout; all its log
    # lines go to stderr. Grab the last UUID-shaped stdout line.
    $seedOut = uv run python desktop/tests/e2e/fixtures/build_synthetic_fixture.py
    if ($LASTEXITCODE -ne 0) {
        Write-Error "fixture seeding failed"
        exit $LASTEXITCODE
    }
    $uuidLine = $seedOut |
        Select-String -Pattern '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' |
        Select-Object -Last 1
    if (-not $uuidLine) {
        Write-Error "fixture seeding produced no project id"
        exit 1
    }
    $env:E2E_FIXTURE_PROJECT_ID = $uuidLine.ToString().Trim()
    Write-Host "==> fixture project: $($env:E2E_FIXTURE_PROJECT_ID)"

    Push-Location desktop
    try {
        Write-Host "==> npx playwright test $args"
        npx playwright test @args
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    exit $code
} finally {
    Write-Host "==> stopping backend"
    if ($uvicorn -and -not $uvicorn.HasExited) {
        Stop-Process -Id $uvicorn.Id -Force -ErrorAction SilentlyContinue
    }
    # Safe to free :8765 here: we aborted up-front if anything was already on
    # it, so any listener now is the backend WE started (uv may spawn uvicorn
    # as a child, so kill by port to catch the worker too).
    $listener = Get-PortListener
    if ($listener) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
