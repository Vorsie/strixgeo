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
UV_LOCK = ROOT / "uv.lock"


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


def _versions() -> tuple[str, str, str]:
    """Return the version named by package.json, pyproject.toml and uv.lock."""
    with PYPROJECT.open("rb") as handle:
        python_version = tomllib.load(handle)["project"]["version"]
    # A Windows checkout with autocrlf may hold CRLF; the marker spans one line end.
    lock = UV_LOCK.read_text(encoding="utf-8").replace(chr(13), "")
    marker = 'name = "groundmodel"' + chr(10) + 'version = "'
    lock_version = lock[lock.index(marker) + len(marker) :].split('"', 1)[0]
    return _package()["version"], python_version, lock_version


def test_desktop_and_python_packages_carry_the_same_version() -> None:
    """package.json, pyproject.toml and uv.lock name one version.

    A tag build fails when the tag and package.json disagree, and the staging
    export runs ``uv export --frozen``, which refuses a lockfile that lags
    pyproject.toml; so a bump touches all three in one commit.
    """
    desktop, python, lock = _versions()
    assert desktop == python == lock


def test_changelog_has_the_current_version_directly_below_unreleased() -> None:
    """CHANGELOG has the current version's entry directly below Unreleased.

    Unreleased collects the changes made after the current version, so it may
    hold entries, but no other version heading sits between the two. The
    hosted build takes this section as the release notes of the tag build.
    """
    version = _versions()[0]
    text = CHANGELOG.read_text(encoding="utf-8")
    heading = f"## [{version}]"
    assert heading in text, f"CHANGELOG has no {heading} section"
    unreleased = text.index("## [Unreleased]")
    released = text.index(heading)
    assert unreleased < released
    between = text[unreleased + len("## [Unreleased]") : released]
    assert "## [" not in between, f"A version heading sits above {version}: {between!r}"
