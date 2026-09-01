# Compile the engine + parsers to native .pyd inside a STAGED backend tree.
#
# WHY THIS EXISTS
# ---------------
# The packaged app ships the backend as source (build-embedded-python.ps1) so
# alembic, the codelist data files and numba's cache all resolve exactly as they
# do under pytest. Readable source is also a leak: owner ruling 2026-08-31 -- "the
# underlying codebase should also be protected and not leak at all times ...
# otherwise someone else could just duplicate". This script closes that leak for
# the two areas the owner named (rulings 5-6): the ENGINE (voxel litho builder,
# NAD classifier, representative statistic) and the PARSERS (GEF + DOV). Each
# listed module is translated to C by Nuitka into a
# ``<name>.cp311-win_amd64.pyd`` placed beside its package ``__init__.py``, and
# its ``.py`` is DELETED from the staged tree. The API, repositories and
# application layer stay source.
#
# The compiled set is defined once, in scripts/native_compile_manifest.py, and
# read from there. Two carve-outs are deliberate and enforced by that manifest:
# ``voxel_litho/greedy_mesh.py`` (a Numba @njit(cache=True) kernel that needs its
# .py + __code__) and every ``__init__.py``.
#
# WHAT IT DOES NOT DO
# -------------------
# It never touches the repo ``src/`` tree -- it operates only on the STAGED copy
# handed to ``-StagedBackendSrc``. The dev workflow keeps running all-source.
#
# Usage (normally invoked by build-embedded-python.ps1, not by hand):
#   .\scripts\compile-backend-natives.ps1 -StagedBackendSrc <path>\backend\src
#   .\scripts\compile-backend-natives.ps1 -StagedBackendSrc <path> -Compiler msvc
#   .\scripts\compile-backend-natives.ps1 -StagedBackendSrc <path> -Jobs 8
#   .\scripts\compile-backend-natives.ps1 -StagedBackendSrc <path> -SkipCompile

[CmdletBinding()]
param(
    # The staged ``backend/src`` directory -- the one that CONTAINS ``groundmodel/``.
    [Parameter(Mandatory = $true)]
    [string]$StagedBackendSrc,

    # Backend C compiler Nuitka drives. mingw64 is the spike-proven default;
    # msvc is parameterised pending owner decision C2. (Nuitka flags: --mingw64
    # vs --msvc=latest.)
    [ValidateSet('mingw64', 'msvc')]
    [string]$Compiler = 'mingw64',

    # Parallel compile jobs. 0 => auto. Capped low by default: this box has
    # documented RAM corruption under load+heat (CLAUDE.local.md "Machine
    # health"), and N parallel gcc processes multiply memory + thermal pressure.
    [int]$Jobs = 0,

    # Scratch directory for per-module Nuitka output + logs. Defaults under TEMP.
    [string]$ScratchDir,

    # Stage WITHOUT compiling -- leaves the backend all-source. For iterating on
    # the packaging steps only; the output is NOT a shippable tree.
    [switch]$SkipCompile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Manifest = Join-Path $PSScriptRoot 'native_compile_manifest.py'

function Write-Step($message) {
    Write-Host "[compile-natives] $message"
}

# Run a scriptblock with native-stderr handling relaxed. PowerShell 5.1 under
# 'Stop' turns ANY stderr line from a native exe into a terminating error, so
# uv/nuitka progress on stderr would fail the build. The real gate is the exit
# code, checked by the caller via $LASTEXITCODE.
function Invoke-WithNativeErrors {
    param([scriptblock]$Script)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Script } finally { $ErrorActionPreference = $saved }
}

# ---------------------------------------------------------------------------
# -SkipCompile: loud banner, leave the tree alone.
# ---------------------------------------------------------------------------
if ($SkipCompile) {
    Write-Host ''
    Write-Host '  ############################################################'
    Write-Host '  ##                                                        ##'
    Write-Host '  ##   -SkipCompile: BACKEND SHIPS AS READABLE SOURCE.      ##'
    Write-Host '  ##   THIS TREE IS NOT FOR RELEASE. The engine + parsers   ##'
    Write-Host '  ##   are UNPROTECTED. Rebuild without -SkipCompile before ##'
    Write-Host '  ##   any binary leaves this machine (owner ruling 7).     ##'
    Write-Host '  ##                                                        ##'
    Write-Host '  ############################################################'
    Write-Host ''
    return
}

if (-not (Test-Path (Join-Path $StagedBackendSrc 'groundmodel'))) {
    throw "no 'groundmodel' package under -StagedBackendSrc: $StagedBackendSrc"
}

# ---------------------------------------------------------------------------
# Resolve the toolchain interpreter (the .venv python that carries Nuitka) and
# the compiled-module list -- both from the single-source manifest.
# ---------------------------------------------------------------------------
Write-Step 'resolving the Nuitka toolchain + compile manifest'
Push-Location $RepoRoot
try {
    $nuitkaPy = (Invoke-WithNativeErrors {
            uv run --group compile python -c 'import sys; print(sys.executable)'
        }) | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0 -or -not $nuitkaPy) {
        throw 'could not resolve the Nuitka interpreter via `uv run --group compile` (run `uv sync --group compile`?)'
    }
    $nuitkaPy = $nuitkaPy.Trim()

    $modules = Invoke-WithNativeErrors { uv run --group compile python $Manifest }
    if ($LASTEXITCODE -ne 0) { throw 'could not read the compile manifest' }
} finally {
    Pop-Location
}
$modules = @($modules | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
if ($modules.Count -eq 0) { throw 'the compile manifest is empty' }
Write-Step "interpreter: $nuitkaPy"
Write-Step "$($modules.Count) modules to compile with $Compiler"

$compilerFlag = if ($Compiler -eq 'msvc') { '--msvc=latest' } else { '--mingw64' }

if ($Jobs -le 0) { $Jobs = [Math]::Min(6, [Environment]::ProcessorCount) }
Write-Step "parallel jobs: $Jobs"

if (-not $ScratchDir) { $ScratchDir = Join-Path $env:TEMP "strix-nuitka-$PID" }
if (Test-Path $ScratchDir) { Remove-Item -Recurse -Force $ScratchDir }
New-Item -ItemType Directory -Force -Path $ScratchDir | Out-Null

# Map a dotted module name to its staged .py path.
function Get-StagedPy([string]$dotted) {
    $rel = ($dotted -replace '\.', '\') + '.py'
    Join-Path $StagedBackendSrc $rel
}

# The Nuitka names the .pyd after the input file's stem, dropping it straight in
# --output-dir (verified in the spike + probe): <outDir>\<name>.cp311-win_amd64.pyd.
function Get-ExpectedPyd([string]$outDir, [string]$name) {
    Join-Path $outDir "$name.cp311-win_amd64.pyd"
}

# The synchronous compile of one module (also warms the toolchain for the pool).
$syncCompile = {
    param($py, $stagedPy, $outDir, $flag, $logFile)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $py -m nuitka --module $stagedPy --output-dir=$outDir --remove-output `
            --no-pyi-file $flag --assume-yes-for-downloads 2>&1 |
            Out-File -FilePath $logFile -Encoding utf8
        $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $saved
    }
}

# The parallel job runs the identical command; kept a separate block so it is
# obvious the two paths issue the SAME Nuitka invocation.
$jobCompile = {
    param($py, $stagedPy, $outDir, $flag, $logFile)
    $ErrorActionPreference = 'Continue'
    & $py -m nuitka --module $stagedPy --output-dir=$outDir --remove-output `
        --no-pyi-file $flag --assume-yes-for-downloads 2>&1 |
        Out-File -FilePath $logFile -Encoding utf8
    $LASTEXITCODE
}

# Move the produced .pyd beside the package __init__.py, delete the .py, and
# hard-assert both post-conditions. Returns the result record.
function Complete-Module {
    param($module, $name, $stagedPy, $outDir, $logFile, $code)

    $producedPyd = Get-ExpectedPyd $outDir $name
    if ($code -ne 0 -or -not (Test-Path $producedPyd)) {
        $tail = if (Test-Path $logFile) { (Get-Content $logFile -Tail 30) -join "`n" } else { '(no log)' }
        throw "nuitka failed for $module (exit=$code)`n--- log tail ---`n$tail"
    }
    $destPyd = Join-Path (Split-Path $stagedPy -Parent) "$name.cp311-win_amd64.pyd"
    Move-Item -Force -Path $producedPyd -Destination $destPyd
    Remove-Item -Force -Path $stagedPy

    # Hard post-conditions: the .pyd is present AND the .py is gone. Either half
    # failing means the staged tree would ship wrong (a source leak, or a broken
    # import); fail the build here rather than let a gate catch it later.
    if (-not (Test-Path $destPyd)) { throw "post-condition failed: .pyd missing for $module" }
    if (Test-Path $stagedPy) { throw "post-condition failed: .py still present for $module" }

    [pscustomobject]@{ Module = $module; Pyd = $destPyd; Size = (Get-Item $destPyd).Length }
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$results = @()
$queue = [System.Collections.Queue]::new()
foreach ($m in $modules) { $queue.Enqueue($m) }

# Warm the toolchain on the first module SYNCHRONOUSLY before fanning out: the
# first-ever Nuitka call can materialise its MinGW download + prime ccache, and
# racing that across parallel jobs is asking for a corrupt shared cache.
if ($queue.Count -gt 0) {
    $m = $queue.Dequeue()
    $stagedPy = Get-StagedPy $m
    if (-not (Test-Path $stagedPy)) { throw "staged source missing for ${m}: $stagedPy (stale stage or manifest drift)" }
    $name = ($m -split '\.')[-1]
    $outDir = Join-Path $ScratchDir $m
    $logFile = Join-Path $ScratchDir "$m.log"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    Write-Step "warming toolchain on $m"
    $code = (& $syncCompile $nuitkaPy $stagedPy $outDir $compilerFlag $logFile) | Select-Object -Last 1
    $results += Complete-Module -module $m -name $name -stagedPy $stagedPy -outDir $outDir -logFile $logFile -code $code
    Write-Step ("  [{0}/{1}] {2}" -f $results.Count, $modules.Count, $m)
}

# Parallel job pool for the rest. Wrapped in try/finally so that if ANY module
# throws (a compile failure surfaced by Complete-Module, or a missing staged
# source), every still-running job is stopped + removed before the exception
# propagates. On this box, orphaned parallel gcc processes left running past a
# failure compound the documented RAM-under-load hazard (CLAUDE.local.md
# "Machine health"); a clean death is a safety property here, not just tidiness.
$active = @{}
try {
    while ($queue.Count -gt 0 -or $active.Count -gt 0) {
        while ($active.Count -lt $Jobs -and $queue.Count -gt 0) {
            $m = $queue.Dequeue()
            $stagedPy = Get-StagedPy $m
            if (-not (Test-Path $stagedPy)) { throw "staged source missing for ${m}: $stagedPy (stale stage or manifest drift)" }
            $name = ($m -split '\.')[-1]
            $outDir = Join-Path $ScratchDir $m
            $logFile = Join-Path $ScratchDir "$m.log"
            New-Item -ItemType Directory -Force -Path $outDir | Out-Null
            $job = Start-Job -ScriptBlock $jobCompile `
                -ArgumentList $nuitkaPy, $stagedPy, $outDir, $compilerFlag, $logFile
            $active[$job.Id] = [pscustomobject]@{
                Module = $m; Name = $name; StagedPy = $stagedPy; OutDir = $outDir; Log = $logFile
            }
        }

        if ($active.Count -eq 0) { continue }
        $jobObjects = Get-Job -Id ([int[]]$active.Keys)
        $finished = Wait-Job -Job $jobObjects -Any
        $meta = $active[$finished.Id]
        $code = (Receive-Job -Job $finished) | Where-Object { $_ -is [int] } | Select-Object -Last 1
        Remove-Job -Job $finished
        [void]$active.Remove($finished.Id)

        $results += Complete-Module -module $meta.Module -name $meta.Name -stagedPy $meta.StagedPy `
            -outDir $meta.OutDir -logFile $meta.Log -code $code
        Write-Step ("  [{0}/{1}] {2}" -f $results.Count, $modules.Count, $meta.Module)
    }
} finally {
    # On success $active is empty here (every job was drained), so this is a
    # no-op. On a throw it holds the jobs still in flight - kill them clean.
    if ($active.Count -gt 0) {
        Write-Step "cleaning up $($active.Count) in-flight compile job(s) after a failure"
        $leftover = Get-Job -Id ([int[]]$active.Keys) -ErrorAction SilentlyContinue
        if ($leftover) {
            $leftover | Stop-Job -ErrorAction SilentlyContinue
            $leftover | Remove-Job -Force -ErrorAction SilentlyContinue
        }
    }
}
$sw.Stop()

# ---------------------------------------------------------------------------
# Sweep any Nuitka strays out of the staged tree (belt-and-braces; --remove-output
# and the scratch output-dir already keep .build out of the staged tree).
# ---------------------------------------------------------------------------
foreach ($stray in @('*.pyi')) {
    Get-ChildItem -Path $StagedBackendSrc -Recurse -File -Filter $stray -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -Force $_.FullName }
}
Get-ChildItem -Path $StagedBackendSrc -Recurse -Directory -Filter '*.build' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName }

# Scratch (per-module output dirs + logs) is disposable once every .pyd landed.
Remove-Item -Recurse -Force $ScratchDir -ErrorAction SilentlyContinue

$totalBytes = ($results | Measure-Object -Property Size -Sum).Sum
Write-Step ("compiled {0} modules -> {1} .pyd, {2} MB total, {3:n0}s wall ({4} jobs)" -f `
        $results.Count, $results.Count, [math]::Round($totalBytes / 1MB, 1), $sw.Elapsed.TotalSeconds, $Jobs)

if ($results.Count -ne $modules.Count) {
    throw "compiled $($results.Count) of $($modules.Count) modules -- incomplete"
}
