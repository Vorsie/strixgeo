"""The staging scripts bind Windows PowerShell 5.1 to its own modules first.

The hosted installer build (run 39114025205, 2026-10-18) died in
``build-embedded-postgres.ps1`` with "The term 'Get-FileHash' is not
recognized": the workflow step runs under PowerShell 7, the npm script starts
Windows PowerShell 5.1 as a child, and the child inherits a PSModulePath that
lists the 7.x modules first. 5.1 then binds Microsoft.PowerShell.Utility to the
7.x manifest, whose Get-FileHash it cannot load, while built-in cmdlets such as
Invoke-WebRequest still work. Each staging script therefore puts its own
``$PSHOME\\Modules`` first, before any Utility cmdlet runs.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
STAGING_SCRIPTS = ("build-embedded-postgres.ps1", "build-embedded-python.ps1")
MODULE_PATH_FIX = r'$env:PSModulePath = "$PSHOME\Modules;$env:PSModulePath"'


@pytest.mark.parametrize("name", STAGING_SCRIPTS)
def test_staging_script_puts_its_own_modules_first_before_get_filehash(name: str) -> None:
    """The PSModulePath line exists and precedes the first Get-FileHash call."""
    text = (ROOT / "scripts" / name).read_text(encoding="utf-8")
    fix_at = text.find(MODULE_PATH_FIX)
    assert fix_at != -1, f"{name} lacks the PSModulePath line"
    first_hash = text.find("Get-FileHash")
    assert first_hash != -1, f"{name} no longer hashes anything?"
    assert fix_at < first_hash, f"{name} sets PSModulePath after its first Get-FileHash"
