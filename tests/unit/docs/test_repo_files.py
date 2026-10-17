"""The standard open-source files exist and carry the agreed sections."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

REQUIRED = {
    "README.md": ["AGPL-3.0", "Support the project", "GeoStrix", "trademark"],
    "CONTRIBUTING.md": ["Signed-off-by", "Conventional Commits", "develop", "tests"],
    "CODE_OF_CONDUCT.md": ["Contributor Covenant"],
    "SECURITY.md": ["security advisor"],
    "CHANGELOG.md": ["## [0.1.6]", "Keep a Changelog"],
    ".github/CODEOWNERS": ["@Vorsie"],
    ".github/FUNDING.yml": ["github: [Vorsie]"],
    ".github/PULL_REQUEST_TEMPLATE.md": ["What the tests prove", "Signed-off-by"],
    ".github/ISSUE_TEMPLATE/bug_report.md": [
        "[bug]",
        "Acceptance criteria",
        "Help > Save logs for support",
    ],
    ".github/ISSUE_TEMPLATE/feature_request.md": ["[feat]", "Acceptance criteria"],
    # The issue chooser sends questions to Discussions.
    ".github/ISSUE_TEMPLATE/config.yml": ["contact_links"],
    # Dependabot version updates cover the three dependency ecosystems:
    # the Python lock (uv), the desktop app (npm) and the CI actions.
    ".github/dependabot.yml": [
        'package-ecosystem: "uv"',
        'package-ecosystem: "npm"',
        'package-ecosystem: "github-actions"',
    ],
    # GitHub reads CITATION.cff for its "Cite this repository" button.
    "CITATION.cff": ["cff-version: 1.2.0", "AGPL-3.0-or-later"],
    # Questions go to Discussions, not to the issue tracker.
    "SUPPORT.md": ["Discussions"],
}


def test_every_standard_file_exists_with_its_sections() -> None:
    """Each file exists and contains the phrases the design fixed."""
    missing: list[str] = []
    for rel, phrases in REQUIRED.items():
        path = ROOT / rel
        if not path.exists():
            missing.append(f"{rel}: missing")
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in phrases:
            if phrase not in text:
                missing.append(f"{rel}: lacks {phrase!r}")
    assert missing == [], missing
