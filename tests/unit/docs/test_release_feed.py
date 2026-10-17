"""The release machinery points at the public source repo and one version.

From 0.2.0 on the source repo Vorsie/strixgeo is public and carries the
releases itself: electron-builder publishes there, the release guard reads
that feed, and the desktop and Python packages carry the same version.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACKAGE_JSON = ROOT / "desktop" / "package.json"
PUBLISHED_VERSION_MJS = ROOT / "desktop" / "scripts" / "publishedVersion.mjs"
PYPROJECT = ROOT / "pyproject.toml"
CHANGELOG = ROOT / "CHANGELOG.md"


def _package() -> dict:
    """Return the parsed desktop/package.json."""
    return json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))


def test_installers_publish_to_the_public_source_repo() -> None:
    """The electron-builder publish block names Vorsie/strixgeo."""
    publish = _package()["build"]["publish"]
    targets = [(p["owner"], p["repo"]) for p in publish]
    assert targets == [("Vorsie", "strixgeo")]


def test_release_guard_reads_the_public_source_repo_feed() -> None:
    """The guard's feed constant is the public source repo."""
    text = PUBLISHED_VERSION_MJS.read_text(encoding="utf-8")
    assert "export const RELEASES_REPO = 'Vorsie/strixgeo'\n" in text


def test_desktop_and_python_packages_carry_the_same_version() -> None:
    """package.json and pyproject.toml name one version, 0.2.0."""
    with PYPROJECT.open("rb") as handle:
        python_version = tomllib.load(handle)["project"]["version"]
    assert _package()["version"] == python_version == "0.2.0"


def test_changelog_has_the_0_2_0_entry_under_a_fresh_unreleased() -> None:
    """CHANGELOG has a dated 0.2.0 entry below an empty Unreleased heading."""
    text = CHANGELOG.read_text(encoding="utf-8")
    assert "## [0.2.0]" in text
    unreleased = text.index("## [Unreleased]")
    released = text.index("## [0.2.0]")
    assert unreleased < released
    between = text[unreleased + len("## [Unreleased]") : released]
    assert between.strip() == "", f"Unreleased is not empty: {between!r}"
