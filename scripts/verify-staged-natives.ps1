# Behavioural gate: run the real unit suites against the COMPILED .pyd artifacts.
#
# WHY EXECUTE, NOT HASH
# --------------------
# This host has documented RAM corruption: two separate .pyd files have shipped
# with a poisoned image section while their bytes still hashed correct (asyncpg
# 2026-08-14; see CLAUDE.local.md "Machine health"). A hash, a size, or a
# "the file exists" check therefore proves NOTHING about a compiled artifact on
# this machine. The only trustworthy gate is to IMPORT and RUN the .pyd through
# the suites that pin its behaviour. A byte flip that changed a classification
# threshold or a parse offset would sail past every hash check and be caught
# only here.
#
# WHAT IT RUNS
# ------------
# Under the STAGED interpreter (the relocated python that ships), with
# PYTHONPATH pointed at the staged backend so `groundmodel` resolves to the
# compiled tree, it runs:
#   * a generated pre-suite marker test that re-asserts every manifest module is
#     Nuitka-compiled INSIDE the pytest process (same interpreter + sys.path the
#     suites use);
#   * tests/unit/domain/services/voxel_litho  (SHA-256 byte-identity pin +
#     greedy-mesh @njit nopython tripwire);
#   * tests/unit/domain/test_nad_classifier.py;
#   * tests/unit/infrastructure/parsers  (incl. the DOV parse-worker, which
#     round-trips a compiled parser).
# pytest itself is installed pure-Python into a throwaway target OUTSIDE the
# staged tree, so no test-only dependency leaks into what ships.
#
# Any failure throws -> the dist build dies. That is the point: a semantic
# deviation introduced by compilation must stop the installer, not surface in a
# customer's hands.

[CmdletBinding()]
param(
    # Staged backend/src (contains the compiled groundmodel package).
    [Parameter(Mandatory = $true)]
    [string]$StagedBackendSrc,

    # The staged, relocated python.exe that the installer ships.
    [Parameter(Mandatory = $true)]
    [string]$StagedPython,

    # Scratch root for the pytest install + numba cache + marker test.
    [string]$ScratchDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Manifest = Join-Path $PSScriptRoot 'native_compile_manifest.py'
$Pyproject = Join-Path $RepoRoot 'pyproject.toml'

function Write-Step($message) {
    Write-Host "[verify-natives] $message"
}

function Invoke-WithNativeErrors {
    param([scriptblock]$Script)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Script } finally { $ErrorActionPreference = $saved }
}

if (-not (Test-Path $StagedPython)) { throw "staged python not found: $StagedPython" }
if (-not (Test-Path (Join-Path $StagedBackendSrc 'groundmodel'))) {
    throw "no 'groundmodel' package under -StagedBackendSrc: $StagedBackendSrc"
}

if (-not $ScratchDir) { $ScratchDir = Join-Path $env:TEMP 'strix-native-gate' }
$GatePytest = Join-Path $ScratchDir 'gate-pytest'
$GateWork = Join-Path $ScratchDir 'work'
$NumbaCache = Join-Path $ScratchDir 'numba-cache'
New-Item -ItemType Directory -Force -Path $GateWork | Out-Null
New-Item -ItemType Directory -Force -Path $NumbaCache | Out-Null

# ---------------------------------------------------------------------------
# pytest, pure-Python, into a target OUTSIDE the staged tree. Two pins:
#   * --python <staged>: wheel selection matches the shipped cp311/win interpreter.
#   * versions taken from the repo's own dev group (`uv export --frozen`): the
#     gate must run under the EXACT pytest the repo's suites are proven on, never
#     whatever `uv pip install pytest` resolves to today (an unpinned install had
#     already drifted a minor ahead of the lock).
# ---------------------------------------------------------------------------
Write-Step 'resolving the repo-pinned pytest versions (dev group)'
Push-Location $RepoRoot
try {
    # --frozen: read the lockfile as-is, never mutate it from inside the gate.
    # dev is a default group, so the export carries its pinned pytest lines.
    $exportLines = Invoke-WithNativeErrors {
        uv export --frozen --no-hashes --no-emit-project --format requirements-txt
    }
    if ($LASTEXITCODE -ne 0) { throw 'uv export of the dev group failed' }
} finally {
    Pop-Location
}
$wanted = 'pytest', 'pytest-asyncio', 'pytest-benchmark'
$specs = @()
foreach ($pkg in $wanted) {
    # Match the exact "<pkg>==<version>" line; strip any trailing env marker.
    $line = $exportLines |
        Where-Object { $_ -match "^$([regex]::Escape($pkg))==" } |
        Select-Object -First 1
    if (-not $line) { throw "could not find a repo-pinned '$pkg' in the dev-group export" }
    $specs += (($line -split '[ ;]')[0]).Trim()
}
Write-Step "gate pytest pinned to: $($specs -join ', ')"

Write-Step 'installing pytest into a throwaway target (outside the staged tree)'
Push-Location $RepoRoot
try {
    Invoke-WithNativeErrors {
        uv pip install --python $StagedPython --target $GatePytest @specs
    }
    if ($LASTEXITCODE -ne 0) { throw 'uv pip install of the gate pytest failed' }
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# Generate the pre-suite marker test. It re-asserts every manifest module is
# Nuitka-compiled from INSIDE the pytest process, so the proof travels on the
# same sys.path the suites run under. It reads the module list from the single
# manifest (repo scripts dir on sys.path).
# ---------------------------------------------------------------------------
$markerTest = Join-Path $GateWork 'test_aaa_staged_natives_are_compiled.py'
$scriptsDir = $PSScriptRoot
$markerBody = @"
# GENERATED by scripts/verify-staged-natives.ps1 for the packaged-build gate.
# Not a repo test: it only passes against a COMPILED staged tree, which is why
# it lives in scratch and is fed to pytest by path.
import importlib
import sys

sys.path.insert(0, r"$scriptsDir")
from native_compile_manifest import COMPILED_MODULES

import pytest


@pytest.mark.parametrize("name", COMPILED_MODULES)
def test_staged_module_is_nuitka_compiled(name):
    mod = importlib.import_module(name)
    assert getattr(mod, "__compiled__", None) is not None, (
        f"{name} imported as SOURCE, not a Nuitka .pyd (no __compiled__)"
    )
    assert type(mod.__loader__).__name__ == "nuitka_module_loader", (
        f"{name} loader is {type(mod.__loader__).__name__}, expected nuitka_module_loader"
    )
    assert mod.__compiled__.extension_filename.lower().endswith(".pyd")
"@
Set-Content -Path $markerTest -Value $markerBody -Encoding UTF8

# ---------------------------------------------------------------------------
# Run the gate under the STAGED interpreter. groundmodel resolves to the staged
# compiled tree (PYTHONPATH first); pytest resolves from the throwaway target.
# The repo pyproject.toml supplies asyncio_mode=auto (the parser suites have
# async tests) + --benchmark-disable.
# ---------------------------------------------------------------------------
$env:PYTHONPATH = "$StagedBackendSrc;$GatePytest"
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:NUMBA_CACHE_DIR = $NumbaCache
$env:PYTHONUTF8 = '1'
$env:MPLBACKEND = 'Agg'
# The suites construct settings at import; give a throwaway key to silence the
# default-key warning (mirrors build-embedded-python's own import check).
$env:SECRET_KEY = 'native-gate-import-check-only'

$targets = @(
    $markerTest,
    (Join-Path $RepoRoot 'tests\unit\domain\services\voxel_litho'),
    (Join-Path $RepoRoot 'tests\unit\domain\test_nad_classifier.py'),
    (Join-Path $RepoRoot 'tests\unit\infrastructure\parsers')
)

Write-Step 'executing the real suites against the compiled .pyd artifacts'
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & $StagedPython -m pytest -c $Pyproject --rootdir $RepoRoot -p no:cacheprovider -q @targets
    $pytestExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousPreference
    foreach ($v in 'PYTHONPATH', 'PYTHONDONTWRITEBYTECODE', 'NUMBA_CACHE_DIR', 'PYTHONUTF8', 'MPLBACKEND', 'SECRET_KEY') {
        Remove-Item "Env:\$v" -ErrorAction SilentlyContinue
    }
}

# Sweep any __pycache__ the run left in the staged tree (PYTHONDONTWRITEBYTECODE
# should prevent it, but the staged tree must ship byte-clean regardless).
Get-ChildItem -Path $StagedBackendSrc -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Sort-Object -Property FullName -Descending |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName }

if ($pytestExit -ne 0) {
    throw "the behavioural native gate FAILED (pytest exit $pytestExit) -- a compiled .pyd deviates from its source behaviour; the dist build must not proceed"
}
Write-Step 'behavioural native gate PASSED'
