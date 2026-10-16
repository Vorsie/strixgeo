"""Open source 2026-10-17: no activation, licence-key or beta-expiry machinery remains.

The tree is scanned for the identifiers of the removed subsystem so a stray
pointer (a doc bullet, a script, a menu label) fails the unit gate instead of
confusing a contributor.
"""

from __future__ import annotations

import re
from pathlib import Path

# tests/unit/docs/<this file> -> parents[3] is the repo root.
ROOT = Path(__file__).resolve().parents[3]
SCAN_DIRS = ("src", "desktop/src", "docs", "scripts", "server", "CLAUDE.md", "README.md")
SCAN_SUFFIXES = {".py", ".ts", ".tsx", ".md", ".rst", ".ps1", ".mjs"}
FORBIDDEN = re.compile(
    r"activationService|activationStore|betaExpiry|enforceBetaExpiry|"
    r"STRIX_BETA_EXPIRES_AT|licenceActivation|server/activation|LicensingDialog|"
    r"getBetaStatus|beta-status|beta-expiry\.md|onboarding-activation-updater-proto|"
    r"activation_stub_server|activation-stub|ACTIVATION_FORMAT_VERSION",
)
# Tester-facing phrases of the removed flow, matched case-insensitively.
FORBIDDEN_PHRASES = re.compile(r"\bactivation server\b|\bbeta keys?\b", re.IGNORECASE)
# Records that are history by design: the open-source spec + plan, the debt
# backlog (RESOLVED entries keep their detail), lessons and the timing journal.
ALLOWED = {
    "docs/superpowers",
    "docs/debt.md",
    "docs/lessons-learned.md",
    "docs/benchmarks-journal.md",
    # dated audit record, history
    "docs/production-readiness-audit-2026-09-02.md",
    "docs/codex-production-check-2026-09-02.md",
    # pins the ABSENCE of the removed gate in the main-process source
    "desktop/src/main/bootSequence.test.ts",
    # history by design
    "CHANGELOG.md",
}
# Generated or third-party trees that a recursive walk can reach: the local,
# gitignored code-guide site and any installed packages or build output.
SKIPPED_PARTS = {"node_modules", "_build", "__pycache__"}
SKIPPED_PREFIXES = ("docs/code-guide",)


def _rel(f: Path) -> str:
    """Return the repo-relative path of ``f`` with forward slashes."""
    return str(f.relative_to(ROOT)).replace("\\", "/")


def _is_allowed(rel: str) -> bool:
    """Return True when ``rel`` is an ALLOWED file or lies under an ALLOWED folder."""
    return any(rel == a or rel.startswith(a + "/") for a in ALLOWED)


def _files() -> list[Path]:
    """List every scannable file under the scanned roots.

    Returns
    -------
    list[Path]
        Files with a scanned suffix, minus generated and third-party trees.
    """
    out: list[Path] = []
    for entry in SCAN_DIRS:
        p = ROOT / entry
        if not p.exists():
            # ``server/`` is gone today; scanning it still catches a revival.
            continue
        if p.is_file():
            out.append(p)
            continue
        out.extend(
            f
            for f in p.rglob("*")
            if f.is_file()
            and f.suffix in SCAN_SUFFIXES
            and not SKIPPED_PARTS.intersection(f.relative_to(ROOT).parts)
            and not _rel(f).startswith(SKIPPED_PREFIXES)
        )
    return out


def _mentions_removed_subsystem(text: str) -> bool:
    """Return True when ``text`` names an identifier or phrase of the removed flow."""
    return bool(FORBIDDEN.search(text) or FORBIDDEN_PHRASES.search(text))


def test_no_activation_or_expiry_identifier_survives() -> None:
    """Every file under the scanned roots is free of the removed identifiers."""
    hits = [
        _rel(f)
        for f in _files()
        if not _is_allowed(_rel(f))
        and _mentions_removed_subsystem(f.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == [], f"removed-subsystem identifiers still referenced in: {hits}"
