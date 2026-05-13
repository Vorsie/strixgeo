"""Enforce CLAUDE.md "Code Conventions" §eslint-disable rule (debt #42).

Every ``// eslint-disable-next-line react-hooks/exhaustive-deps`` site
in the desktop renderer MUST be preceded by a ``// reason: ...`` block
comment explaining *why* the linter is wrong here. The rule is
codified in CLAUDE.md but until this script landed nothing enforced
it — a reviewer eyeball was the only gate, and a future Claude or
collaborator could silently slip a reason-less disable into the
codebase.

This script is a deliberate alternative to installing eslint + a
custom plugin. The full eslint setup is its own infrastructure
work that doesn't pay for itself when the only rule we want to
enforce is this one. A 70-line Python script does the same job
with zero npm install footprint.

Invocation:

    python scripts/check_eslint_reason.py [PATH ...]

When called without paths, defaults to the desktop renderer tree.
The git pre-commit hook + the CI workflow both run it on every
desktop TypeScript change.

Exit codes:

* 0 — no violations
* 1 — at least one violation; lines printed in
  ``file:line: content`` format so editors can jump to them
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# The disable directive we govern. Other ``eslint-disable-next-line``
# variants (e.g. ``@typescript-eslint/no-explicit-any``) are not
# covered by the CLAUDE.md rule — the rationale there is that the
# react-hooks rule has a documented incident history (the S7
# infinite-render-loop) and a track record of false-negative
# suppression, so it gets the extra gate.
DIRECTIVE = "eslint-disable-next-line react-hooks/exhaustive-deps"
REASON_TOKEN = "reason:"

# Default scan target — every TypeScript file under the renderer +
# main process, but NOT test files (a violation in a test file is
# fine; tests are allowed to suppress freely). The pre-commit hook
# may pass specific staged paths to narrow the scan.
DEFAULT_ROOTS = (Path("desktop/src"),)


def find_violations(paths: list[Path]) -> list[tuple[Path, int, str]]:
    """Return list of (path, 1-indexed line number, line content) violations.

    Walks each file's lines; on every line containing ``DIRECTIVE``,
    walks BACKWARDS through preceding ``//`` comment lines and blank
    lines looking for ``REASON_TOKEN``. A non-comment, non-blank line
    above the directive ends the search without a match (the reason
    must be in the immediately-adjacent comment block).
    """
    violations: list[tuple[Path, int, str]] = []
    for path in paths:
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            # Binary or unreadable; skip silently. The hook scans only
            # text-extension files (.ts/.tsx) so this is defence in
            # depth.
            continue
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if DIRECTIVE not in line:
                continue
            if _reason_above(lines, i):
                continue
            violations.append((path, i + 1, line.strip()))
    return violations


def _reason_above(lines: list[str], directive_index: int) -> bool:
    """Walk backwards from a directive line, looking for the reason
    comment in the immediately-preceding comment block.

    Tolerates blank lines (a reason block separated from the
    directive by whitespace still counts). Stops at the first
    non-comment, non-blank line.
    """
    j = directive_index - 1
    while j >= 0:
        stripped = lines[j].strip()
        if stripped == "":
            j -= 1
            continue
        if not stripped.startswith("//"):
            # Non-comment line above — no reason in this block.
            return False
        if REASON_TOKEN in stripped:
            return True
        j -= 1
    return False


def expand_paths(roots: list[Path]) -> list[Path]:
    """Flatten a roots list into the concrete ``.ts`` / ``.tsx`` files
    to scan. Skips test files + node_modules + dist.
    """
    skip_segments = {"node_modules", "dist", "out", "__pycache__"}
    files: list[Path] = []
    for root in roots:
        if root.is_file():
            files.append(root)
            continue
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            if any(seg in skip_segments for seg in path.parts):
                continue
            if ".test." in path.name or ".spec." in path.name:
                continue
            files.append(path)
    return files


def main(argv: list[str]) -> int:
    """CLI entry — argv excludes the program name."""
    raw_roots = [Path(p) for p in argv] if argv else list(DEFAULT_ROOTS)
    paths = expand_paths(raw_roots)
    violations = find_violations(paths)
    if not violations:
        return 0
    print(
        "[eslint-reason] Missing `// reason:` comment above "
        "`eslint-disable-next-line react-hooks/exhaustive-deps`.\n"
        'CLAUDE.md "Code Conventions" rule: every disable site must '
        "carry a reason comment explaining why the linter is wrong.\n"
    )
    for path, lineno, content in violations:
        print(f"  {path}:{lineno}: {content}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
