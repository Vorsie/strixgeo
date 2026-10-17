"""The repo carries its licence the way package tools and GitHub read it."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_license_file_is_the_agpl_text() -> None:
    """LICENSE is the full GNU AGPL-3.0 text."""
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("                    GNU AFFERO GENERAL PUBLIC LICENSE")
    assert "Version 3, 19 November 2007" in text


def test_package_metadata_name_the_licence() -> None:
    """pyproject and package.json both declare AGPL-3.0-or-later."""
    py = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert re.search(r'license\s*=\s*\{\s*text\s*=\s*"AGPL-3.0-or-later"\s*\}', py)
    pkg = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
    assert pkg["license"] == "AGPL-3.0-or-later"


def test_notice_lists_the_bundled_third_parties() -> None:
    """NOTICE names every bundled runtime and its licence."""
    notice = " ".join((ROOT / "NOTICE").read_text(encoding="utf-8").split())
    for name in (
        "PostgreSQL",
        "PostGIS",
        "Electron",
        "CesiumJS",
        "PyMuPDF",
        "d-geolib",
        "rapidocr",
        "DOV",
    ):
        assert name in notice, name
    # The "or later" grant and the trademark rule are the two sentences a
    # redistributor must not lose; whitespace is normalised because they wrap.
    assert "or (at your option) any later version" in notice
    assert "A modified distribution must use another name" in notice
