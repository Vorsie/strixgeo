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
# Most of the backend ships as SOURCE for the same reason: identical to dev,
# and it keeps alembic + the codelist data files resolving exactly as they do
# under pytest. The EXCEPTION is the engine + parsers (owner ruling 2026-08-31:
# the codebase must not leak from a shipped binary). Right after the backend is
# copied, compile-backend-natives.ps1 translates the modules listed in
# native_compile_manifest.py to native .pyd IN THE STAGED COPY and deletes their
# .py; two behavioural gates then EXECUTE the compiled artifacts (the smoke gate
# below + verify-staged-natives.ps1) - hashes prove nothing on this box. The API,
# repositories and application layer stay source. See docs/distribution-build.md.
# Broader tamper hardening (anti-debug, the flag debugger surface) is debt #5.
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
# PowerShell 5.1 under 'Stop' turns ANY line a native exe writes to stderr into a
# terminating error, and both uv calls below narrate resolution progress on
# stderr ("Resolved N packages ...") even when they succeed. Gate on the exit
# code instead - which is the real signal, and what the checks below already do.
# (A `throw` stays terminating under 'Continue', so a genuine failure still halts
# the build.) Same dance as the staged-runtime import check further down.
$previousExportPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    # --no-dev: pytest / mypy / ruff / faker are ~70 MB the app never imports.
    #   It also drops the `compile` group (Nuitka) - a non-default group export
    #   never emits, so the compile toolchain cannot leak into what ships.
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
    $ErrorActionPreference = $previousExportPreference
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

# Compile the engine + parsers to native .pyd in the staged copy (owner ruling
# 2026-08-31: the codebase must not leak from a shipped binary). This replaces
# the listed modules' .py with a compiled .pyd IN THE STAGED TREE ONLY - the
# repo src/ is never touched. Runs after the backend copy (so it operates on the
# fresh copy) and before the bytecode drop (which then clears the orphaned .pyc
# left when a compiled module's .py is deleted). The driver throws on any
# failure, which halts this build under $ErrorActionPreference = 'Stop'.
Write-Step 'compiling the engine + parsers to native .pyd'
& (Join-Path $PSScriptRoot 'compile-backend-natives.ps1') -StagedBackendSrc (Join-Path $BackendTarget 'src')

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
import importlib
import os
import sys

staged_src = sys.argv[1]
scripts_dir = sys.argv[2]
sys.path.insert(0, staged_src)
sys.path.insert(0, scripts_dir)

import asyncpg, polars, numba, scipy, pyproj, shapely, alembic, fastapi, geoalchemy2
import groundmodel
from groundmodel.api.serve import build_config

# The native-compilation contract: every manifest module must load as a Nuitka
# .pyd in THIS relocated interpreter, and its .py source must be gone from the
# staged tree. Nuitka rewrites __file__/__spec__.origin back to the source path
# for tracebacks, so __file__ is a FALSE witness here - the only trustworthy
# proof is the __compiled__ marker plus the nuitka_module_loader loader.
from native_compile_manifest import COMPILED_MODULES

for name in COMPILED_MODULES:
    mod = importlib.import_module(name)
    assert getattr(mod, "__compiled__", None) is not None, f"{name} is not Nuitka-compiled"
    assert type(mod.__loader__).__name__ == "nuitka_module_loader", (
        f"{name} loader={type(mod.__loader__).__name__}, expected nuitka_module_loader"
    )
    rel = name.replace(".", os.sep)
    assert not os.path.exists(os.path.join(staged_src, rel + ".py")), (
        f"source .py survived compilation: {name}"
    )
    assert os.path.exists(os.path.join(staged_src, rel + ".cp311-win_amd64.pyd")), (
        f"missing .pyd for {name}"
    )

# greedy_mesh is the deliberate source carve-out (numba @njit(cache=True) needs
# its .py + __code__); it must import WITHOUT __compiled__ and keep its .py.
import groundmodel.domain.services.voxel_litho.greedy_mesh as gm
assert getattr(gm, "__compiled__", None) is None, "greedy_mesh must ship as SOURCE"
assert os.path.exists(
    os.path.join(staged_src, "groundmodel", "domain", "services", "voxel_litho", "greedy_mesh.py")
), "greedy_mesh.py must be present in the staged tree"

print("ok", sys.version.split()[0], "compiled", len(COMPILED_MODULES), "modules")
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
    $check | & $exe - (Join-Path $BackendTarget 'src') $PSScriptRoot
} finally {
    $ErrorActionPreference = $previousPreference
    Remove-Item Env:\SECRET_KEY -ErrorAction SilentlyContinue
}
if ($LASTEXITCODE -ne 0) { throw "the staged runtime failed its import check" }

# Behavioural native gate: import + RUN the compiled .pyd through the real unit
# suites (byte-identity pin, njit tripwire, NAD classifier, DOV/GEF parsers).
# Hashes prove nothing on this box - it has shipped bytes-hashed-correct .pyd
# with poisoned image sections - so the artifacts must be EXECUTED. Throws (and
# thus kills the build) if any compiled module deviates from its source.
Write-Step 'running the behavioural native gate'
& (Join-Path $PSScriptRoot 'verify-staged-natives.ps1') `
    -StagedBackendSrc (Join-Path $BackendTarget 'src') -StagedPython $exe

$pySize = (Get-ChildItem -Recurse -File $PythonTarget | Measure-Object -Property Length -Sum).Sum
$beSize = (Get-ChildItem -Recurse -File $BackendTarget | Measure-Object -Property Length -Sum).Sum
Write-Step "staged $PythonTarget ($([math]::Round($pySize / 1MB)) MB)"
Write-Step "staged $BackendTarget ($([math]::Round($beSize / 1MB)) MB)"
