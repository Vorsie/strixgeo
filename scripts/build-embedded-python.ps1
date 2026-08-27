# Stage the Python runtime + backend source the packaged app ships.
#
# WHY A RELOCATED INTERPRETER AND NOT PyInstaller
# -----------------------------------------------
# The backend's dependency set is the awkward kind for a freezer: numba +
# llvmlite (runtime code generation), polars and scipy (large native
# extensions), asyncpg, geoalchemy2, shapely, pyproj (each with its own data
# files). Every one of those is a hidden-import or a missing-datas away from an
# ImportError that appears in a coworker's hands rather than at build time.
# Three further things break outright under a frozen single-file build:
#
#   * Alembic needs its migration scripts as real files on disk, and
#     versions/ is not even an importable package (no __init__.py).
#   * The DOV/G3Dv3 codelists are read __file__-relative out of
#     infrastructure/codelists/data/ and are not declared as package data.
#   * numba's @njit(cache=True) writes next to the source it compiles.
#
# python-build-standalone (what uv already downloads for this project) is built
# to be relocatable, so copying it and installing the locked dependency set
# into its own site-packages gives a runtime that is byte-for-byte the one the
# test suite runs against. The cost is size, not correctness - and correctness
# in someone else's hands is what this milestone is about.
#
# The backend SOURCE ships as source for the same reason: identical to dev,
# and it keeps alembic + the codelist data files resolving exactly as they do
# under pytest. It is readable; so is a decompiled wheel. Tamper hardening is
# debt #5 and is deliberately not attempted here.
#
# The dev workflow is untouched: the repo .venv remains what a dev session
# uses. Nothing here runs unless you run it.
#
# Usage:
#   .\scripts\build-embedded-python.ps1
#   .\scripts\build-embedded-python.ps1 -Force

[CmdletBinding()]
param(
    # Rebuild even when desktop/embedded/python already looks complete.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$StageRoot = Join-Path $RepoRoot 'desktop\embedded'
$PythonTarget = Join-Path $StageRoot 'python'
$BackendTarget = Join-Path $StageRoot 'backend'

# Stdlib directories nothing in this application imports. Dropped because they
# are pure weight in an installer a coworker downloads, not because they are
# suspected of anything.
$StdlibDropDirs = @('test', 'idlelib', 'lib2to3', 'turtledemo')

function Write-Step($message) {
    Write-Host "[embedded-python] $message"
}

# The interpreter + its ~640 MB of dependencies only change when uv.lock does,
# so that half is skippable. The backend SOURCE is 5 MB and changes constantly
# — it is re-copied every run, unconditionally, further down.
#
# Splitting these is not a micro-optimisation. When the whole script
# short-circuited, a Python edit followed by `npm run dist` produced an
# installer still carrying the previous snapshot, silently: the build is
# 25 minutes long and reports success, so the staleness only surfaces as the
# bug you thought you had just fixed.
$dependenciesStaged = (Test-Path (Join-Path $PythonTarget 'python.exe')) -and -not $Force
if ($dependenciesStaged) {
    Write-Step "interpreter already staged at $PythonTarget (use -Force to rebuild it)"
}

if (-not $dependenciesStaged) {

# The interpreter to clone is the one the dev venv was built from, so the
# packaged app runs the same CPython patch level the tests do. Reading it from
# pyvenv.cfg rather than asking uv keeps the two in lockstep by construction.
$pyvenvCfg = Join-Path $RepoRoot '.venv\pyvenv.cfg'
if (-not (Test-Path $pyvenvCfg)) {
    throw "no .venv at $RepoRoot - run 'uv sync --group dev' first"
}
$homeLine = Select-String -Path $pyvenvCfg -Pattern '^home\s*=\s*(.+)$'
if (-not $homeLine) { throw "could not read 'home' from $pyvenvCfg" }
$BasePython = $homeLine.Matches[0].Groups[1].Value.Trim()
if (-not (Test-Path (Join-Path $BasePython 'python.exe'))) {
    throw "the interpreter recorded in pyvenv.cfg is gone: $BasePython"
}
Write-Step "cloning $BasePython"

if (Test-Path $PythonTarget) { Remove-Item -Recurse -Force $PythonTarget }
New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null
Copy-Item $BasePython $PythonTarget -Recurse

Write-Step 'pruning the standard library'
foreach ($dir in $StdlibDropDirs) {
    $path = Join-Path $PythonTarget "Lib\$dir"
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path
        Write-Step "  dropped Lib\$dir"
    }
}

Write-Step 'exporting the locked runtime dependency set'
$requirements = Join-Path $StageRoot 'requirements.embedded.txt'
Push-Location $RepoRoot
try {
    # --no-dev: pytest / mypy / ruff / faker are ~70 MB the app never imports.
    # --no-emit-project: groundmodel itself ships as source, below.
    # The export carries hashes, so the install below is pinned end to end.
    uv export --no-dev --no-emit-project --format requirements-txt -o $requirements
    if ($LASTEXITCODE -ne 0) { throw "uv export failed with exit code $LASTEXITCODE" }

    Write-Step 'installing dependencies into the staged interpreter'
    # --break-system-packages: uv marks its own managed interpreters
    # externally-managed. This is our redistributable COPY of one, which is
    # exactly the case the marker does not intend to cover.
    uv pip install --python (Join-Path $PythonTarget 'python.exe') `
        --break-system-packages --require-hashes -r $requirements
    if ($LASTEXITCODE -ne 0) { throw "uv pip install failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

}  # end if (-not $dependenciesStaged)

# ALWAYS re-copied, even when the interpreter was skipped above - see the note
# at the top. This is the file set that changes between two builds on the same
# day, and shipping yesterday's copy is invisible until someone debugs a bug
# they already fixed.
Write-Step 'staging the backend source'
if (Test-Path $BackendTarget) { Remove-Item -Recurse -Force $BackendTarget }
New-Item -ItemType Directory -Force -Path (Join-Path $BackendTarget 'src') | Out-Null
Copy-Item (Join-Path $RepoRoot 'src\groundmodel') (Join-Path $BackendTarget 'src\groundmodel') -Recurse

Write-Step 'dropping compiled bytecode'
# Bytecode compiled against the developer's absolute paths; regenerated on the
# target machine on first import. The interpreter tree is only swept when it
# was just built - walking 640 MB to re-confirm it is clean costs more than it
# is worth on the common "only the backend changed" rebuild.
$bytecodeRoots = if ($dependenciesStaged) { @($BackendTarget) } else { @($PythonTarget, $BackendTarget) }
foreach ($root in $bytecodeRoots) {
    Get-ChildItem -Path $root -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
        Sort-Object -Property FullName -Descending |
        ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
}

Write-Step 'verifying the staged runtime'
$exe = Join-Path $PythonTarget 'python.exe'
# Import the heavy natives explicitly: a relocated interpreter that starts but
# cannot load polars or numba is the failure this whole script exists to avoid,
# and it must surface here rather than on a tester's machine.
$check = @'
import sys
sys.path.insert(0, sys.argv[1])
import asyncpg, polars, numba, scipy, pyproj, shapely, alembic, fastapi, geoalchemy2
import groundmodel
from groundmodel.api.serve import build_config
print("ok", sys.version.split()[0])
'@
# The import check is run with a throwaway SECRET_KEY: settings are constructed
# at import time and would otherwise emit a RuntimeWarning about the default
# key, which is noise here (the real key is generated per install at runtime).
$env:SECRET_KEY = 'build-time-import-check-only'
# 'Continue' around the native call: under 'Stop', PowerShell 5.1 turns ANY
# stderr output from a native executable into a terminating error, so a single
# warning line would fail the build. The exit code below is the real gate.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $check | & $exe - (Join-Path $BackendTarget 'src')
} finally {
    $ErrorActionPreference = $previousPreference
    Remove-Item Env:\SECRET_KEY -ErrorAction SilentlyContinue
}
if ($LASTEXITCODE -ne 0) { throw "the staged runtime failed its import check" }

$pySize = (Get-ChildItem -Recurse -File $PythonTarget | Measure-Object -Property Length -Sum).Sum
$beSize = (Get-ChildItem -Recurse -File $BackendTarget | Measure-Object -Property Length -Sum).Sum
Write-Step "staged $PythonTarget ($([math]::Round($pySize / 1MB)) MB)"
Write-Step "staged $BackendTarget ($([math]::Round($beSize / 1MB)) MB)"
