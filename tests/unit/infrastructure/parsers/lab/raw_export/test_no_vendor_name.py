"""Owner ruling 2026-09-30: zero reference to the lab's in-house program name.

"don't use the name [of the lab program] in the app (this references an intern
app of afdeling Geotechniek, i want zero reference due to copyright and stuff,
just make a generic importer". The formats are described by what they are
(oedometer control listing, triaxial per-point dump, oedometer stage export),
never by the vendor. The name is assembled from pieces here so this guard does
not trip on itself.
"""

from __future__ import annotations

import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[6]
_VENDOR = re.compile("geo" + "sys", re.IGNORECASE)
_SCANNED = ("src", "tests", "desktop/src", "desktop/tests", "docs", "scripts")
_SKIPPED_PARTS = {"__pycache__", "node_modules", "_results", "_build"}
_TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".md", ".json", ".ps1", ".txt", ".csv", ".dat", ".rst"}


def _scanned_files() -> list[Path]:
    """Every text file under the scanned roots (caches and build output skipped)."""
    out: list[Path] = []
    for root in _SCANNED:
        for path in (_REPO / root).rglob("*"):
            if _SKIPPED_PARTS & set(path.parts) or ".egg-info" in str(path):
                continue
            out.append(path)
    return out


def test_no_file_or_folder_carries_the_vendor_name() -> None:
    """No module, package, test or fixture path names the lab program."""
    named = [str(p.relative_to(_REPO)) for p in _scanned_files() if _VENDOR.search(p.name)]
    assert named == []


def test_no_source_doc_or_string_mentions_the_vendor_name() -> None:
    """No UI string, docstring, comment, doc or fixture mentions the lab program."""
    hits: list[str] = []
    for path in _scanned_files():
        if not path.is_file() or path.suffix.lower() not in _TEXT_SUFFIXES:
            continue
        text = path.read_bytes().decode("latin-1")
        for n, line in enumerate(text.splitlines(), 1):
            if _VENDOR.search(line):
                hits.append(f"{path.relative_to(_REPO)}:{n}")
    assert hits == []
