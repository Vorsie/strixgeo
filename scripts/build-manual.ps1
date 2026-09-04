<#
.SYNOPSIS
    Build the StrixGeo user manual (docs/manual) to HTML, failing on any Sphinx
    warning.

.DESCRIPTION
    The manual is hand-written prose (no generated pages, no source
    literalinclude), so the build is a single step: run `sphinx-build -W`, which
    turns ANY Sphinx warning into an error. On success it prints the path to the
    rendered index.html.

.EXAMPLE
    .\scripts\build-manual.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Repo root is the parent of this script's directory.
$repoRoot = Split-Path -Parent $PSScriptRoot
$manualDir = Join-Path $repoRoot 'docs/manual'
$outDir = Join-Path $manualDir '_build/html'

Push-Location $repoRoot
try {
    Write-Host '[manual] building HTML (warnings are errors)...' -ForegroundColor Cyan
    uv run python -m sphinx -W --keep-going -b html $manualDir $outDir
    if ($LASTEXITCODE -ne 0) { throw "sphinx-build failed (exit $LASTEXITCODE)" }

    $indexPath = Join-Path $outDir 'index.html'
    Write-Host "[manual] OK - open $indexPath" -ForegroundColor Green
}
finally {
    Pop-Location
}
