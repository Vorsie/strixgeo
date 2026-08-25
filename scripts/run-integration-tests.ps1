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
#   $env:DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel_integration"
#   uv run alembic upgrade head
#
# Per-run flow:
#   0. Take the single-runner lock (ABORTS if another run holds it).
#   1. Point DATABASE_URL at the integration DB.
#   2. ``alembic upgrade head`` (idempotent -- no-op when already current).
#   3. Run pytest with whatever args the caller passed through.
#   4. Always release the lock on the way out.
#
# The conftest's pytest_collection_modifyitems guard refuses to run
# unless DATABASE_URL ends in "_integration" or "_test", so a forgotten
# env var fails loudly instead of silently TRUNCATE'ing the dev DB.

# NOTE: do NOT set $ErrorActionPreference = "Stop". Native exes (alembic,
# pytest) write progress to stderr; with Stop set, every stderr line gets
# wrapped as an ErrorRecord and aborts the script. Check $LASTEXITCODE
# explicitly instead -- that's the real native-program success signal.

# Capture the caller's arguments under a NAMED variable, at top scope, before
# anything else runs -- same lesson as run-e2e.ps1: the automatic ``$args`` does
# not survive nesting, and everything below now runs inside a try block.
$CallerArgs = $args

# ---------------------------------------------------------------------------
# Single-runner lock
# ---------------------------------------------------------------------------
# Two integration runs against one database destroy each other. The conftest
# TRUNCATEs every project-scoped table at the START and END of EVERY test, so a
# second run wipes the first one's rows mid-test. The failures that produces
# look nothing like a race: they surface as ForeignKeyViolationError on a parent
# row that was just created, StaleDataError ("expected to update 1 row(s); 0
# were matched"), or a 422 saying a model the log shows being created 201 does
# not exist. Diagnosed 2026-08-25 after exactly that pair of runs collided and
# cost two rounds of chasing a non-existent fixture bug.
#
# The DATABASE_URL guard in the conftest catches the wrong DATABASE -- nothing
# caught the wrong CONCURRENCY. This does.
#
# ABORT, never kill and never wait: the holder may be a colleague's run, a
# background job, or an agent session, and none of those are ours to terminate.
# Same stance as run-e2e.ps1's :8765 check.
$LockPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.integration-test.lock"))
$LockOwned = $false

function Read-LockRecord {
    <#
    .SYNOPSIS
        Parse the key=value lock file into a hashtable, or $null when unreadable.
    #>
    param([string] $Path)

    try {
        $lines = Get-Content -LiteralPath $Path -ErrorAction Stop
    } catch {
        return $null
    }
    $record = @{}
    foreach ($line in $lines) {
        $split = $line.IndexOf('=')
        if ($split -gt 0) {
            $record[$line.Substring(0, $split)] = $line.Substring($split + 1)
        }
    }
    return $record
}

function Get-LockHolderState {
    <#
    .SYNOPSIS
        Describe the recorded holder: running, stale, or unknown.
    .DESCRIPTION
        The start time is compared as well as the pid, because Windows recycles
        pids: an unrelated process that happens to hold the old number would
        otherwise read as "still running" and send someone hunting a run that
        finished hours ago.
    #>
    param($Record)

    if ($null -eq $Record -or -not $Record.ContainsKey('pid')) {
        # Publication is atomic (see below), so a lock file without a pid was
        # never written by this script -- most likely hand-created.
        return "the lock file is not in the expected format (hand-created?)"
    }
    $holderPid = 0
    if (-not [int]::TryParse($Record['pid'], [ref] $holderPid)) {
        return "the lock file records an unparseable pid"
    }
    $holder = $null
    try { $holder = Get-Process -Id $holderPid -ErrorAction Stop } catch { $holder = $null }
    if ($null -eq $holder) {
        return "that process is GONE -- the lock is STALE and safe to remove"
    }
    if ($Record.ContainsKey('started')) {
        $holderStart = ""
        try { $holderStart = $holder.StartTime.ToString('o') } catch { $holderStart = "" }
        if ($holderStart -ne "" -and $holderStart -ne $Record['started']) {
            return "pid $holderPid now belongs to a DIFFERENT process ($($holder.ProcessName)) -- the lock is STALE and safe to remove"
        }
    }
    return "that process is STILL RUNNING -- wait for it to finish"
}

# Build the record BEFORE anything is published. The first Get-Process call in a
# fresh PowerShell costs ~100 ms, and that cost has to be paid where nobody can
# observe it.
$ownStart = ""
try { $ownStart = (Get-Process -Id $PID).StartTime.ToString('o') } catch { $ownStart = "" }
$record = @(
    "pid=$PID",
    "started=$ownStart",
    "acquired=$((Get-Date).ToString('o'))",
    "user=$env:USERNAME",
    "args=$($CallerArgs -join ' ')"
) -join "`n"

# Write-then-rename, NOT open-with-CreateNew.
#
# CreateNew is atomic for the NAME but not for the CONTENT: it publishes an
# empty file, and the record lands a moment later. Measured 2026-08-25, a reader
# polling every 100 ms caught the file at length 0 before it reached 157. A run
# starting in that window read no pid and was told the holder's lock looked like
# "a crash mid-write ... safe to remove" -- while the holder was very much
# alive. Acting on that advice deletes a live lock and produces exactly the
# concurrent run this whole mechanism exists to prevent, so the empty window is
# not a cosmetic flaw.
#
# File.Move publishes the fully-written file under its final name in one
# filesystem operation, so the lock is never observable without its record. On
# .NET Framework (Windows PowerShell 5.1) the two-argument overload cannot
# overwrite and throws IOException when the destination exists -- which is the
# atomic test-and-set we want, same guarantee CreateNew gave us. The temp file
# MUST sit in the same directory: cross-volume moves are copy-then-delete and
# lose atomicity.
$LockTempPath = "$LockPath.$PID.tmp"
[System.IO.File]::WriteAllText($LockTempPath, $record)
try {
    [System.IO.File]::Move($LockTempPath, $LockPath)
} catch [System.IO.IOException] {
    # Ours, keyed by our own pid, so removing it can never touch the holder's.
    Remove-Item -LiteralPath $LockTempPath -Force -ErrorAction SilentlyContinue
    $heldRecord = Read-LockRecord -Path $LockPath
    $state = Get-LockHolderState -Record $heldRecord
    $heldPid = "unknown"
    $heldSince = "unknown"
    $heldArgs = "unknown"
    if ($null -ne $heldRecord) {
        if ($heldRecord.ContainsKey('pid')) { $heldPid = $heldRecord['pid'] }
        if ($heldRecord.ContainsKey('acquired')) { $heldSince = $heldRecord['acquired'] }
        if ($heldRecord.ContainsKey('args')) { $heldArgs = $heldRecord['args'] }
    }
    Write-Error (
        "Another integration run holds the lock (pid $heldPid, since $heldSince, args: $heldArgs).`n" +
        "  Status: $state.`n" +
        "  Lock file: $LockPath`n" +
        "Two runs against groundmodel_integration TRUNCATE each other's rows mid-test, " +
        "so this script will NOT wait and will NOT kill the holder.`n" +
        "If the lock is stale, remove it by hand:`n" +
        "  Remove-Item '$LockPath'"
    )
    exit 1
}
$LockOwned = $true

$exitCode = 1
try {
    # 127.0.0.1, NOT localhost: docker publishes 5433 on IPv4 only; a localhost
    # resolution can pick ::1 first and asyncpg's connect then wedges in SynSent
    # with no timeout (hung the 2026-07-12 suite for hours). Keep it IPv4-pinned.
    $env:DATABASE_URL = "postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel_integration"

    Write-Host "==> alembic upgrade head (integration DB)"
    uv run alembic upgrade head
    if ($LASTEXITCODE -eq 0) {
        # Default the path to tests/integration, then append whatever flags
        # the caller passed. Lets you do ``run-integration-tests.ps1 -q`` for
        # the full suite quiet, or ``run-integration-tests.ps1 tests/integration/api/test_cross_section.py``
        # for a narrow target. (Path args override the default; flag args extend it.)
        #
        # The caller's arguments are passed through IN ORDER. Sorting them into paths and
        # flags looked harmless and quietly broke every option that takes a separate value:
        # ``-k gb20`` became ``-k`` in one bucket and ``gb20`` in the other, so pytest saw a
        # ``-k`` with no argument and a test path named "gb20".
        $hasTarget = $false
        foreach ($a in $CallerArgs) {
            if ($a -like '-*') { continue }
            # A target names a file or a directory. Anything else is some flag's value.
            if ($a -like '*/*' -or $a -like '*\*' -or $a -like '*.py' -or $a -like 'tests*') {
                $hasTarget = $true
            }
        }
        # The @( ) wrapper is load-bearing. PowerShell unrolls a ONE-element array on
        # assignment, so a single-argument call (`run-integration-tests.ps1 tests/x.py`)
        # left $pytestArgs holding a plain string -- and splatting a string with @ spreads
        # it one CHARACTER per argument, so pytest was handed "t", "e", "s", ... and
        # reported `file or directory not found: t`. Two-or-more-argument calls stayed an
        # array and worked, which is why this survived the earlier -k fix.
        $pytestArgs = @(if ($hasTarget) { $CallerArgs } else { @("tests/integration") + $CallerArgs })

        Write-Host "==> pytest $pytestArgs"
        uv run pytest @pytestArgs
    }
    $exitCode = $LASTEXITCODE
} finally {
    # Release on EVERY path -- success, pytest failure, or Ctrl-C. Guarded on
    # $LockOwned so an aborted run can never delete the lock it just refused to
    # take: that would hand the DB to a second runner while the first is live.
    if ($LockOwned) {
        Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
