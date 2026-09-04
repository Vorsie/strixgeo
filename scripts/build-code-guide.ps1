<#
.SYNOPSIS
    Build the StrixGeo code guide (docs/code-guide) to HTML, failing on any drift
    or any Sphinx warning.

.DESCRIPTION
    Three steps, in order, any failure aborts:

      1. Regenerate the pages from the current source tree
         (generate_pages.py). Hand-written explanations are preserved.
      2. Check the guide is complete and has not drifted from the source
         (check_pages.py) — a source file with no page, a page whose block
         ranges no longer match the file, or an unfinished block in a package
         marked complete fails here.
      3. Build the HTML with `sphinx-build -W`, so ANY Sphinx warning is an
         error.

    On success it prints the path to the rendered index.html.

.EXAMPLE
    .\scripts\build-code-guide.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Repo root is the parent of this script's directory.
$repoRoot = Split-Path -Parent $PSScriptRoot
$guideDir = Join-Path $repoRoot 'docs/code-guide'
$outDir = Join-Path $guideDir '_build/html'

Push-Location $repoRoot
try {
    Write-Host '[code-guide] 1/3 regenerating pages...' -ForegroundColor Cyan
    uv run python docs/code-guide/generate_pages.py
    if ($LASTEXITCODE -ne 0) { throw "generate_pages.py failed (exit $LASTEXITCODE)" }

    Write-Host '[code-guide] 2/3 checking coverage / drift / completeness...' -ForegroundColor Cyan
    uv run python docs/code-guide/check_pages.py
    if ($LASTEXITCODE -ne 0) { throw "check_pages.py failed (exit $LASTEXITCODE)" }

    Write-Host '[code-guide] 3/3 building HTML (warnings are errors)...' -ForegroundColor Cyan
    uv run python -m sphinx -W --keep-going -b html $guideDir $outDir
    if ($LASTEXITCODE -ne 0) { throw "sphinx-build failed (exit $LASTEXITCODE)" }

    $indexPath = Join-Path $outDir 'index.html'
    Write-Host "[code-guide] OK - open $indexPath" -ForegroundColor Green
}
finally {
    Pop-Location
}
