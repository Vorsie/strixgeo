"""``bin/build_bundle.py`` packs exactly what the Combell deploy needs.

Rule (runbook §6/§12): the upload is ``activation/`` (the router, from
``public/``), ``src/``, ``bin/``, ``migrations/`` and ``schema.sql`` — never
``config.php`` (secrets stay on the server), never ``dist/`` or tests. Member
names use forward slashes so the zip unpacks the same on the Linux host.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ACTIVATION_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ACTIVATION_DIR / "bin"))

from build_bundle import build_bundle  # noqa: E402


def test_bundle_holds_the_deploy_set_with_server_paths_and_no_secrets(tmp_path: Path) -> None:
    """The zip carries router/src/bin/migrations/schema under their server names only."""
    out = build_bundle(ACTIVATION_DIR, tmp_path)
    assert out.exists() and out.suffix == ".zip"
    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
    assert "activation/index.php" in names  # public/index.php lands as activation/index.php
    assert "src/licence.php" in names
    assert "bin/mint.php" in names
    assert "migrations/002_duration_days.sql" in names
    assert "schema.sql" in names
    assert all("\\" not in n for n in names)
    assert not any(n.endswith("config.php") for n in names)
    assert not any(n.startswith(("dist/", "tests/")) for n in names)
