"""The Dependabot configuration: majors are planned upgrades, never bot PRs.

The run of 2026-10-17 opened one grouped PR per ecosystem that bundled React
19, Tailwind 4, TypeScript 7, Vite 8 and recharts 3 with the patch bumps of
the month; such a PR can never pass CI and only costs a review. From then on
a version-update group carries only minor and patch updates, and the uv and
npm ecosystems ignore every major update: a major is a planned upgrade by
hand (issue #122 for Tailwind 4). Security groups are not version updates
and keep bundling whatever the advisory needs.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / ".github" / "dependabot.yml"

ECOSYSTEMS_WITH_MAJORS_BY_HAND = {"uv", "npm"}


def _updates() -> list[dict[str, Any]]:
    """Return the ``updates`` entries of the configuration."""
    data = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    return list(data["updates"])


def _version_groups(entry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return the groups of one entry that bundle version updates."""
    return {
        name: group
        for name, group in entry.get("groups", {}).items()
        if group.get("applies-to", "version-updates") == "version-updates"
    }


def test_version_update_groups_carry_only_minor_and_patch() -> None:
    """A grouped version PR never mixes a major with the monthly bumps."""
    wrong: list[str] = []
    for entry in _updates():
        for name, group in _version_groups(entry).items():
            if set(group.get("update-types", [])) != {"minor", "patch"}:
                wrong.append(f"{entry['package-ecosystem']}: group {name}")
    assert wrong == [], wrong


def test_python_and_desktop_ignore_every_major_update() -> None:
    """A major update of a library or a tool is a planned upgrade by hand."""
    wrong: list[str] = []
    for entry in _updates():
        ecosystem = entry["package-ecosystem"]
        if ecosystem not in ECOSYSTEMS_WITH_MAJORS_BY_HAND:
            continue
        rules = entry.get("ignore", [])
        ignores_all_majors = any(
            rule.get("dependency-name") == "*"
            and rule.get("update-types") == ["version-update:semver-major"]
            for rule in rules
        )
        if not ignores_all_majors:
            wrong.append(ecosystem)
    assert wrong == [], wrong
