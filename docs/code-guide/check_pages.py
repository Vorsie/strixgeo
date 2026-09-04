"""Fail the build when the code guide has drifted from the source or is unfinished.

Run it with::

    uv run python docs/code-guide/check_pages.py

It is wired into ``scripts/build-code-guide.ps1`` and enforces three things:

1. **Coverage** — every source file under a configured tree has a page.
2. **No drift** — a page's recorded block ranges still match a fresh split of the
   current source. When someone edits a source file and the definitions move,
   the recorded ``:lines:`` no longer line up and the guide would show the wrong
   code under the wrong explanation; this catches that so the page is
   regenerated.
3. **Completeness** — a page in a "complete" package
   (:data:`code_guide_config.COMPLETE_MODULES`) has a real explanation on every
   block (no leftover placeholder).

It also reports pages that document a source file that no longer exists (a stale
page to delete). Exit code 0 = clean; 1 = one or more problems, each printed with
the exact fix.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import code_guide_config as config  # noqa: E402
import code_guide_lib as lib  # noqa: E402

# Import the generator's pure helpers rather than re-deriving slugs/splits, so
# the checker and the generator can never disagree on how a file maps to a page
# or how a file is split.
import generate_pages as generator  # noqa: E402


def _fresh_blocks(source: generator.SourceFile) -> list[lib.Block]:
    """Split a source file exactly as the generator would, right now."""
    text = source.abs_path.read_text(encoding="utf-8")
    return generator._split_for(text, source.suffix)


def check() -> list[str]:
    """Return a list of problem descriptions; empty means the guide is clean."""
    problems: list[str] = []
    sources = generator.discover_sources()
    pages_dir = config.GUIDE_ROOT / config.PAGES_DIRNAME

    documented: set[str] = set()

    for source in sources:
        page_path = pages_dir / f"{generator.page_slug(source.rel_path)}.rst"
        documented.add(page_path.name)

        # 1. Coverage.
        if not page_path.exists():
            problems.append(
                f"MISSING PAGE: {source.rel_path} has no page. "
                f"Run: uv run python docs/code-guide/generate_pages.py"
            )
            continue

        parsed = lib.parse_page(page_path.read_text(encoding="utf-8"))
        fresh = _fresh_blocks(source)

        # 2. Drift — recorded ranges vs a fresh split.
        fresh_ranges = {block.block_id: (block.start, block.end) for block in fresh}
        if parsed.block_ranges != fresh_ranges:
            problems.append(
                f"DRIFT: {source.rel_path} — the page's block ranges no longer match "
                f"the file. Regenerate: uv run python docs/code-guide/generate_pages.py"
            )

        # 3. Completeness for pages in a complete package.
        if source.rel_path in config.COMPLETE_MODULES:
            unfinished = sorted(
                block.block_id for block in fresh if block.block_id in parsed.placeholder_ids
            )
            missing = sorted(
                block.block_id for block in fresh if block.block_id not in parsed.explanations
            )
            for block_id in unfinished:
                problems.append(
                    f"UNFINISHED: {source.rel_path} — block '{block_id}' is in a "
                    f"complete package but still carries a placeholder explanation."
                )
            for block_id in missing:
                problems.append(
                    f"UNFINISHED: {source.rel_path} — block '{block_id}' has no "
                    f"explanation region at all (regenerate, then write it)."
                )

    # 4. Stale pages — a page whose source is gone.
    if pages_dir.exists():
        for page_path in sorted(pages_dir.glob("*.rst")):
            if page_path.name in documented:
                continue
            parsed = lib.parse_page(page_path.read_text(encoding="utf-8"))
            src = parsed.source_path or "(unknown)"
            problems.append(
                f"STALE PAGE: {page_path.relative_to(config.REPO_ROOT).as_posix()} "
                f"documents {src}, which is no longer a source file. Delete the page."
            )

    return problems


def main() -> int:
    """Print every problem and return a non-zero exit code when any exist."""
    problems = check()
    if problems:
        print(f"code-guide check FAILED — {len(problems)} problem(s):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print("code-guide check OK — every source file has an up-to-date page.")
    return 0


if __name__ == "__main__":
    # The messages carry an em-dash; make stdout/stderr UTF-8 so a Windows
    # console (or the PowerShell build gate capturing this output) never trips
    # over encoding a non-ASCII character.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8")
    raise SystemExit(main())
