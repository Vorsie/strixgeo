"""Unit tests for the code-guide generator's splitter and prose preservation.

These lock the two behaviours the generator/checker rely on:

* the Python splitter cuts a file into gap-free blocks at the right line numbers
  (module header/constants, decorated function, async function, class + method);
* hand-written prose between the explanation markers survives a regeneration,
  and a moved definition is detectable as drift.

The code guide lives under ``docs/code-guide/`` (a hyphenated, non-importable
folder), so the test puts that directory on ``sys.path`` and imports the two
helper modules directly.
"""

from __future__ import annotations

import sys
from pathlib import Path

_GUIDE_DIR = Path(__file__).resolve().parents[3] / "docs" / "code-guide"
if str(_GUIDE_DIR) not in sys.path:
    sys.path.insert(0, str(_GUIDE_DIR))

import code_guide_lib as lib  # noqa: E402
import generate_pages as generator  # noqa: E402

# A tiny module exercising every split case: a module docstring + import +
# constant (the header run), a DECORATED function, an ASYNC function, and a
# class with one method. Line numbers are chosen so the expected ranges are
# obvious (see ``_SAMPLE_LINES`` indices below).
_SAMPLE_LINES = [
    '"""Module docstring."""',  # 1
    "",  # 2
    "import os",  # 3
    "",  # 4
    "CONST = 1",  # 5
    "",  # 6
    "",  # 7
    "@decorator",  # 8
    "def sync_func():",  # 9
    "    return CONST",  # 10
    "",  # 11
    "",  # 12
    "async def async_func():",  # 13
    "    return 2",  # 14
    "",  # 15
    "",  # 16
    "class Thing:",  # 17
    '    """Class doc."""',  # 18
    "",  # 19
    "    attr = 3",  # 20
    "",  # 21
    "    def method(self):",  # 22
    "        return self.attr",  # 23
]
_SAMPLE_SOURCE = "\n".join(_SAMPLE_LINES)


def test_splitter_cuts_at_the_right_line_numbers() -> None:
    """The splitter tiles the file gap-free at the expected block boundaries."""
    blocks = lib.split_python_source(_SAMPLE_SOURCE)
    got = [(b.block_id, b.start, b.end) for b in blocks]

    assert got == [
        ("module-header", 1, 7),  # docstring + import + CONST (a decorator starts line 8)
        ("function:sync_func", 8, 12),  # the @decorator line is inside the function's block
        ("function:async_func", 13, 16),
        ("class:Thing", 17, 21),  # class header: class line, docstring, attr
        ("method:Thing.method", 22, 23),
    ]


def test_splitter_tiles_the_whole_file_without_gaps() -> None:
    """Every line 1..N is covered exactly once (no gap, no overlap)."""
    blocks = lib.split_python_source(_SAMPLE_SOURCE)
    covered: list[int] = []
    for block in blocks:
        covered.extend(range(block.start, block.end + 1))
    assert covered == list(range(1, len(_SAMPLE_LINES) + 1))


def test_module_constant_lands_in_the_header_not_a_function() -> None:
    """A module-level constant before the first def belongs to the header block."""
    header = lib.split_python_source(_SAMPLE_SOURCE)[0]
    assert header.block_id == "module-header"
    assert header.start == 1 and header.end == 7  # CONST = 1 sits on line 5, inside


def test_moved_definition_is_detectable_as_drift() -> None:
    """When the source shifts, a fresh split's ranges differ from the recorded ones."""
    v1_ranges = {b.block_id: (b.start, b.end) for b in lib.split_python_source(_SAMPLE_SOURCE)}
    shifted = "\n" + "\n" + _SAMPLE_SOURCE  # two blank lines pushed on top
    v2_ranges = {b.block_id: (b.start, b.end) for b in lib.split_python_source(shifted)}
    assert v1_ranges != v2_ranges  # this inequality is exactly what check_pages.py flags


def test_parse_page_reads_back_block_ranges(tmp_path: Path) -> None:
    """A rendered page's CG-BLOCK markers parse back to the split's ranges."""
    module = tmp_path / "mod.py"
    module.write_text(_SAMPLE_SOURCE, encoding="utf-8")
    source = generator.SourceFile(rel_path="src/tmp/mod.py", abs_path=module, suffix=".py")

    page = generator.render_page(source, preserved={})
    parsed = lib.parse_page(page)

    fresh = {b.block_id: (b.start, b.end) for b in lib.split_python_source(_SAMPLE_SOURCE)}
    assert parsed.block_ranges == fresh
    assert parsed.source_path == "src/tmp/mod.py"


def test_prose_survives_regeneration(tmp_path: Path) -> None:
    """Hand-written prose between the markers is preserved across regenerations."""
    module = tmp_path / "mod.py"
    module.write_text(_SAMPLE_SOURCE, encoding="utf-8")
    source = generator.SourceFile(rel_path="src/tmp/mod.py", abs_path=module, suffix=".py")

    # First render: every block is a placeholder.
    first = generator.render_page(source, preserved={})
    parsed_first = lib.parse_page(first)
    assert "function:sync_func" in parsed_first.placeholder_ids

    # A human writes prose for one block; regenerate feeding it back.
    prose = "This is a hand-written explanation of sync_func."
    preserved = dict(parsed_first.explanations)
    preserved["function:sync_func"] = ["", prose, ""]
    second = generator.render_page(source, preserved)
    parsed_second = lib.parse_page(second)

    assert prose in "\n".join(parsed_second.explanations["function:sync_func"])
    assert "function:sync_func" not in parsed_second.placeholder_ids

    # Regenerate AGAIN from the second page's own regions — the prose is still there.
    third = generator.render_page(source, parsed_second.explanations)
    parsed_third = lib.parse_page(third)
    assert prose in "\n".join(parsed_third.explanations["function:sync_func"])
    # And a block left untouched is still a placeholder (completeness still works).
    assert "function:async_func" in parsed_third.placeholder_ids
