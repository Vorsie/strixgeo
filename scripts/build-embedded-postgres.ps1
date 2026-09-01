# Stage the portable PostgreSQL + PostGIS tree the packaged app ships.
#
# Debt #2, "Fork A" of docs/distribution-db-decision.md: the installer carries
# a Postgres the app starts itself, so a coworker needs no Docker and no
# terminal. This script produces desktop/embedded/pgsql, which
# electron-builder then copies to <install>/resources/pgsql via
# extraResources.
#
# Two upstream artefacts, both official:
#   * The EnterpriseDB Windows BINARY ZIP (not the installer) - the same build
#     the PostgreSQL project links from its Windows download page.
#   * The OSGeo PostGIS Windows bundle, whose documented install procedure is
#     to copy its bin/ lib/ share/ over the PostgreSQL tree.
#
# Pruning: the binary zip is 869 MB unpacked, of which 711 MB is a full
# pgAdmin 4 desktop application we never launch. Everything dropped below is
# dropped because the app provably never invokes it - the end-to-end proof is
# that the packaged app boots, runs CREATE EXTENSION postgis and migrates.
#
# The dev workflow is untouched: docker-compose on :5433 remains the only
# database a dev session sees. Nothing here runs unless you run it.
#
# Usage:
#   .\scripts\build-embedded-postgres.ps1
#   .\scripts\build-embedded-postgres.ps1 -DownloadDir D:\cache -Force

[CmdletBinding()]
param(
    # Where the two upstream zips are cached between runs. Downloads are
    # skipped when a file with the expected SHA256 is already present.
    # Default is computed in the body: $PSScriptRoot is NOT bound during
    # param-default evaluation under `powershell.exe -File` (the npm
    # `embedded:postgres` path) — only in the script body.
    [string]$DownloadDir = '',
    # Rebuild even when desktop/embedded/pgsql already looks complete.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# $PSScriptRoot is empty inside the param() default above when launched via
# `powershell.exe -File`; it is populated here in the body. Resolve the cache
# dir now so both `-File` and dot/&-invocation work identically.
if (-not $DownloadDir) {
    $DownloadDir = Join-Path $PSScriptRoot '..\desktop\embedded\.cache'
}

# --- Upstream artefacts -----------------------------------------------------
# Pinned by version AND digest: a silently-refreshed upstream zip would
# otherwise change what ships without changing this repo (the same reason
# docker-compose.yml pins the postgis image by digest, #219).
$PostgresUrl = 'https://get.enterprisedb.com/postgresql/postgresql-16.10-1-windows-x64-binaries.zip'
$PostgresSha256 = 'EBB3B6AF4FA69DEA9951B66855BC4D42DC04E56CCB9AA7024CE3C58BD89D6B0C'
$PostgisUrl = 'https://download.osgeo.org/postgis/windows/pg16/postgis-bundle-pg16-3.6.2x64.zip'
$PostgisSha256 = '9F4E8A30D69ED7CC0088DD3D218AC65BD4E26AA5B7BFFCB2EBD7DCB74A4FF2A6'
$PostgisDirName = 'postgis-bundle-pg16-3.6.2x64'

# Directories inside the PostgreSQL zip that the app never reads.
#   pgAdmin 4    - a 711 MB Electron+Python GUI; we ship our own UI.
#   StackBuilder - the optional-component downloader; needs a network and a UI.
#   doc, include - man pages and C headers for building extensions.
$PostgresDropDirs = @('pgAdmin 4', 'StackBuilder', 'doc', 'include', 'symbols')

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$StageRoot = Join-Path $RepoRoot 'desktop\embedded'
$Target = Join-Path $StageRoot 'pgsql'
$Work = Join-Path $StageRoot '.work-pgsql'

function Write-Step($message) {
    Write-Host "[embedded-postgres] $message"
}

# Download once, then verify the digest on EVERY run - including cache hits -
# so a truncated download, a corrupted cache or a silently-refreshed upstream
# cannot become the thing we ship. This is the same guarantee
# build-embedded-python.ps1 gets from 'uv pip install --require-hashes'.
function Get-Artifact($url, $path, $expectedSha256) {
    if (Test-Path $path) {
        Write-Step "cached: $(Split-Path $path -Leaf)"
        Assert-Sha256 $path $expectedSha256
        return
    }
    Write-Step "downloading $url"
    $parent = Split-Path $path -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    # Progress rendering costs more wall-clock than the transfer on a fast link.
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
    } finally {
        $ProgressPreference = $previous
    }
    Write-Step "downloaded $([math]::Round((Get-Item $path).Length / 1MB)) MB"
    Assert-Sha256 $path $expectedSha256
}

# Refuse rather than repair: a digest mismatch means the bytes are not the ones
# this repo was verified against, and quietly re-downloading would hide an
# upstream that changed a release in place.
function Assert-Sha256($path, $expected) {
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash
    if ($actual -ne $expected) {
        throw ("checksum mismatch for $path`n  expected $expected`n  actual   $actual`n" +
               "Delete the file to re-download. If the fresh download also mismatches, " +
               "upstream changed the artifact and the pinned hash in this script must be " +
               "reviewed and updated deliberately.")
    }
    Write-Step "  sha256 OK"
}

if ((Test-Path (Join-Path $Target 'bin\postgres.exe')) -and -not $Force) {
    Write-Step "already staged at $Target (use -Force to rebuild)"
    exit 0
}

$postgresZip = Join-Path $DownloadDir 'postgresql-16-binaries.zip'
$postgisZip = Join-Path $DownloadDir 'postgis-bundle-pg16.zip'
Get-Artifact $PostgresUrl $postgresZip $PostgresSha256
Get-Artifact $PostgisUrl $postgisZip $PostgisSha256

Write-Step 'extracting'
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
New-Item -ItemType Directory -Force -Path $Work | Out-Null
# bsdtar (shipped in System32 since Windows 10 1803) rather than
# Expand-Archive: measured on these two archives, Expand-Archive needs over
# half an hour for the PostgreSQL zip where bsdtar needs seconds. The
# difference is per-entry pipeline overhead on ~4000 files, and it turns a
# rebuild from "come back later" into part of the build.
$bsdtar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $bsdtar)) {
    throw "$bsdtar not found - Windows 10 1803 or later is required to build the installer"
}
foreach ($zip in @($postgresZip, $postgisZip)) {
    & $bsdtar -xf $zip -C $Work
    if ($LASTEXITCODE -ne 0) { throw "extracting $zip failed with exit code $LASTEXITCODE" }
}

$pgsql = Join-Path $Work 'pgsql'
$postgis = Join-Path $Work $PostgisDirName
if (-not (Test-Path $pgsql)) { throw "PostgreSQL zip did not contain a pgsql/ directory" }
if (-not (Test-Path $postgis)) { throw "PostGIS zip did not contain $PostgisDirName/" }

Write-Step 'pruning PostgreSQL tree'
foreach ($dir in $PostgresDropDirs) {
    $path = Join-Path $pgsql $dir
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path
        Write-Step "  dropped $dir"
    }
}

# The PostGIS bundle's documented install is "copy bin, lib and share into the
# PostgreSQL directory", overwriting. Followed verbatim rather than merged
# no-clobber: the bundle's GEOS / PROJ / OpenSSL set is the set its
# postgis-3.dll was linked against, and second-guessing that pairing is how
# you get a DLL mismatch that only shows up under ST_Transform.
Write-Step 'overlaying PostGIS'

# bin/ - every DLL and EXE except the standalone shapefile GUI (51 MB, and it
# is a desktop app we never launch).
Copy-Item -Path (Join-Path $postgis 'bin\*') -Destination (Join-Path $pgsql 'bin') `
    -Recurse -Force -Exclude 'postgisgui'
$gui = Join-Path $pgsql 'bin\postgisgui'
if (Test-Path $gui) { Remove-Item -Recurse -Force $gui }

# lib/ - only the PostGIS extension modules. The bundle also carries
# pgRouting, MobilityDB, h3, pointcloud, pg_sphere and ogr_fdw; we never
# CREATE EXTENSION any of them, so their modules would be unreachable weight.
Copy-Item -Path (Join-Path $postgis 'lib\postgis*.dll') `
    -Destination (Join-Path $pgsql 'lib') -Force

# share/extension - same reasoning: the postgis* control and SQL files only.
Copy-Item -Path (Join-Path $postgis 'share\extension\postgis*') `
    -Destination (Join-Path $pgsql 'share\extension') -Force

# share/contrib - carries the PROJ grid shift files. Kept in full: without
# them ST_Transform silently falls back to a lower-accuracy datum shift, and
# the app is expected to work with no network on a site visit.
$contribSrc = Join-Path $postgis 'share\contrib'
$contribDst = Join-Path $pgsql 'share\contrib'
if (-not (Test-Path $contribDst)) { New-Item -ItemType Directory -Force -Path $contribDst | Out-Null }
Copy-Item -Path (Join-Path $contribSrc '*') -Destination $contribDst -Recurse -Force

Write-Step 'verifying the staged tree'
$required = @(
    'bin\postgres.exe',
    'bin\initdb.exe',
    'bin\libgeos_c.dll',
    'lib\postgis-3.dll',
    'share\extension\postgis.control'
)
foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $pgsql $rel))) {
        throw "staged tree is missing $rel - the upstream layout changed"
    }
}

if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Move-Item -Path $pgsql -Destination $Target
Remove-Item -Recurse -Force $Work

$size = (Get-ChildItem -Recurse -File $Target | Measure-Object -Property Length -Sum).Sum
Write-Step "staged $Target ($([math]::Round($size / 1MB)) MB)"
