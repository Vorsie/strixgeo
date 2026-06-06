"""Flag section-overlay geometry that bypasses the spacing-aware transform.

Every section overlay must map along-section metres through ``warpedXToScreen``
(the post-column-nudge transform), NOT raw ``xToScreen`` / ``proj.along``. At
100% column spacing the two agree, so the bug is invisible until the user nudges
spacing — then the overlay floats metres off its column. This has recurred
repeatedly (see memory ``feedback_section_view_spacing_modifier``).

Deterministic check: scan the given files (or the whole sections dir) for raw
``xToScreen(`` calls — ``warpedXToScreen`` is fine, bare ``xToScreen`` is the smell.

Usage
-----
    python check_section_geometry.py                 # scan the sections dir
    python check_section_geometry.py file1.tsx ...   # scan changed files only

Exit code 1 if any raw call is found (CI-friendly).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# bare xToScreen( not preceded by a letter (so warpedXToScreen / screenXToAlong
# don't match). The drag-commit inverse warpedScreenXToAlongCb is also fine.
_RAW = re.compile(r"(?<![A-Za-z])xToScreen\(")
_SECTIONS = Path("desktop/src/renderer/src/components/sections")


def _scan(path: Path) -> list[tuple[int, str]]:
    hits = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.lstrip().startswith(("//", "*", "/*")):
            continue  # comments mentioning xToScreen are not real call sites
        if _RAW.search(line):
            hits.append((i, line.strip()))
    return hits


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # source lines may be non-ASCII
    args = [Path(a) for a in sys.argv[1:]]
    if args:
        files = [p for p in args if p.suffix in {".ts", ".tsx"} and "sections" in str(p)]
    else:
        files = sorted(_SECTIONS.glob("*.tsx")) + sorted(_SECTIONS.glob("*.ts"))

    flagged = False
    for f in files:
        # Exclude test/spec files — they're .tsx as often as .ts (section tests
        # are .test.tsx), and matching only ".test.ts" let .test.tsx through to
        # false-flag xToScreen( used in mocks/assertions.
        if not f.exists() or ".test." in f.name or ".spec." in f.name:
            continue
        for ln, txt in _scan(f):
            flagged = True
            print(f"  {f}:{ln}: raw xToScreen -> should be warpedXToScreen?\n      {txt}")

    if flagged:
        print("\n  ^ raw section coords found. Confirm each is genuinely spacing-")
        print("    independent; otherwise switch to warpedXToScreen.")
        return 1
    print("  OK — no raw section-coordinate calls in the scanned files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
