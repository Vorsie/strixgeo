"""Shared machinery for the code guide: split source into blocks, read/write pages.

The generator and the checker both need to agree on exactly HOW a source file is
cut into blocks and on the marker format inside a page, so both live here as one
module. Two responsibilities:

1. **Splitters.** :func:`split_python_source` uses the standard-library ``ast``
   module to cut a Python file into blocks at every top-level function, class,
   and class method (the module header — docstring + imports + module-level
   constants — is the first block). :func:`split_typescript_source` does the
   same for ``.ts`` / ``.tsx`` (the desktop tree) with a top-level line scanner
   that recognises functions, classes, ``interface`` / ``type`` / ``enum``
   blocks, and ``const`` / ``let`` / ``var`` bindings (exported or bare),
   including ``export default`` and generic ``<T>`` forms. Both tile the whole
   file with no gaps and no overlaps, so a page always shows every line.

2. **Page format.** The generated ``.rst`` pages carry inert RST comment markers
   (:data:`BLOCK_MARKER`, :data:`EXPLANATION_START`, …) that let the generator
   preserve hand-written prose across regenerations and let the checker detect
   drift and unfinished blocks. The read/write helpers here are the only place
   that knows the marker spelling.

Nothing here imports ``groundmodel``: the guide is built and checked without
importing the application.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

# --------------------------------------------------------------------------
# Block model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Block:
    """One contiguous span of a source file, shown as a single page block.

    Attributes
    ----------
    block_id : str
        Stable identity used to re-attach a hand-written explanation across a
        regeneration, e.g. ``module-header``, ``function:main``,
        ``class:DatabaseMigrator``, ``method:DatabaseMigrator.migrate``. A
        duplicate id (same name twice in a file) gets a ``~2`` / ``~3`` suffix.
    title : str
        Human-readable heading shown above the code block.
    start : int
        First line of the span, 1-based and inclusive (matches the editor).
    end : int
        Last line of the span, 1-based and inclusive.
    """

    block_id: str
    title: str
    start: int
    end: int


def _decorator_aware_start(node: ast.AST) -> int:
    """Return a node's first source line, counting any decorators above it.

    ``ast`` reports a decorated ``def`` / ``class`` at the ``def`` / ``class``
    keyword line, not at the ``@decorator`` above it. Block boundaries must sit
    above the decorators so each function's block shows its own decorators, so
    this returns the earliest decorator line when there are decorators.
    """
    decorators = getattr(node, "decorator_list", None)
    if decorators:
        return min(int(dec.lineno) for dec in decorators)
    return int(node.lineno)  # type: ignore[attr-defined]


def _uniquify(block_id: str, seen: dict[str, int]) -> str:
    """Return ``block_id`` unchanged the first time, then ``id~2``, ``id~3``, …."""
    count = seen.get(block_id, 0) + 1
    seen[block_id] = count
    return block_id if count == 1 else f"{block_id}~{count}"


def _class_member_defs(class_node: ast.ClassDef) -> list[ast.stmt]:
    """Return a class body's methods (sync + async ``def``), in source order."""
    return [
        member
        for member in class_node.body
        if isinstance(member, ast.FunctionDef | ast.AsyncFunctionDef)
    ]


def _def_title(node: ast.FunctionDef | ast.AsyncFunctionDef, prefix: str) -> str:
    """Build a heading for a function/method, marking ``async`` where relevant."""
    async_marker = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
    return f"{prefix} ``{async_marker}def {node.name}``"


def split_python_source(source: str) -> list[Block]:
    """Split Python ``source`` into gap-free blocks at top-level definitions.

    The tiling rule, in plain terms:

    * A run of consecutive top-level statements (the module docstring, imports,
      module-level constants) is one block. The first such run is the **module
      header**; a later run — for example constants defined between two
      functions, or ``app = create_app()`` at the foot of a file — is its own
      block too, so constants are never hidden inside a neighbouring function.
    * Every top-level function is one block; every top-level class is a
      **class-header** block (the ``class`` line, its docstring and any class
      attributes before the first method) followed by one block per method.
    * Each block runs up to the line before the next block starts, so the blocks
      cover line 1 to the last line with no gap and no overlap — the whole file
      is always shown.

    Parameters
    ----------
    source : str
        The complete text of a Python source file.

    Returns
    -------
    list[Block]
        Blocks in source order. A file with no top-level definitions returns a
        single ``module-header`` block spanning the whole file. An empty file
        returns an empty list.

    Raises
    ------
    SyntaxError
        If ``source`` does not parse — the caller decides how to report it.
    """
    line_count = len(source.splitlines())
    if line_count == 0:
        return []

    tree = ast.parse(source)
    if not tree.body:
        return [Block("module-header", "Module header — the whole file", 1, line_count)]

    # Group the module body into ordered "units": each is either one def/class
    # node, or a coalesced run of consecutive simple statements.
    units: list[list[ast.stmt]] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            units.append([node])
        elif units and not _is_definition(units[-1][0]):
            units[-1].append(node)  # extend the current statement run
        else:
            units.append([node])

    # Each unit's own first source line (decorator-aware for defs/classes).
    raw_starts = [_decorator_aware_start(unit[0]) for unit in units]

    seen: dict[str, int] = {}
    blocks: list[Block] = []
    for index, unit in enumerate(units):
        # The first unit always starts at line 1 so a shebang / leading comment
        # is never dropped; later units start at their own first line.
        start = 1 if index == 0 else raw_starts[index]
        end = raw_starts[index + 1] - 1 if index + 1 < len(units) else line_count
        node = unit[0]
        if isinstance(node, ast.ClassDef):
            blocks.extend(_split_class(node, start, end, seen))
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            blocks.append(
                Block(
                    _uniquify(f"function:{node.name}", seen),
                    _def_title(node, "Function"),
                    start,
                    end,
                )
            )
        elif index == 0:
            blocks.append(
                Block(
                    _uniquify("module-header", seen),
                    "Module header — docstring, imports and constants",
                    start,
                    end,
                )
            )
        else:
            blocks.append(
                Block(
                    _uniquify("module-statements", seen),
                    "Module-level constants and statements",
                    start,
                    end,
                )
            )

    return blocks


def _is_definition(node: ast.stmt) -> bool:
    """Return whether a statement is a top-level function or class definition."""
    return isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef)


def _split_class(
    class_node: ast.ClassDef, class_start: int, class_end: int, seen: dict[str, int]
) -> list[Block]:
    """Split one class span into a class-header block plus one block per method."""
    methods = _class_member_defs(class_node)
    if not methods:
        return [
            Block(
                _uniquify(f"class:{class_node.name}", seen),
                f"Class ``{class_node.name}``",
                class_start,
                class_end,
            )
        ]

    blocks: list[Block] = []
    first_method_start = _decorator_aware_start(methods[0])
    blocks.append(
        Block(
            _uniquify(f"class:{class_node.name}", seen),
            f"Class ``{class_node.name}`` — header",
            class_start,
            first_method_start - 1,
        )
    )
    for index, method in enumerate(methods):
        method_start = _decorator_aware_start(method)
        method_end = (
            _decorator_aware_start(methods[index + 1]) - 1
            if index + 1 < len(methods)
            else class_end
        )
        blocks.append(
            Block(
                _uniquify(f"method:{class_node.name}.{method.name}", seen),
                _def_title(method, f"Method ``{class_node.name}``."),
                method_start,
                method_end,
            )
        )
    return blocks


# Top-level TypeScript/JavaScript definition starts, matched only at column 0 so
# nested definitions stay inside their parent block. This is a line scanner, not
# a real parser: it is deliberately simple, and only has to cut sensible blocks
# — a block is always a valid line range, so a mis-cut (a keyword at column 0
# inside a template literal, say) is cosmetic, never broken RST. The five
# patterns, tried in this order per line:
#
# * a ``function`` / ``class`` declaration — including ``export default
#   function``, ``export async function``, ``abstract class`` and generic
#   ``<T>`` forms; the name is optional so an anonymous ``export default
#   function () {}`` still starts its own block;
# * an ``interface`` / ``enum`` / ``namespace`` / ``module`` declaration
#   (including ``const enum``);
# * a ``type`` alias (``export type X = …``);
# * a ``const`` / ``let`` / ``var`` binding — an exported or bare arrow
#   component, a ``React.memo(...)`` component, or a top-level constant object;
# * a bare ``export default …`` of anything else (a config object, an array).
_TS_FUNC_CLASS = re.compile(
    r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?"
    r"(?P<kind>function|class)\b\s*(?P<name>[A-Za-z0-9_$]+)?"
)
_TS_TYPEISH = re.compile(
    r"^(?:export\s+)?(?:declare\s+)?(?:const\s+)?"
    r"(?P<kind>interface|enum|namespace|module)\s+(?P<name>[A-Za-z0-9_$]+)"
)
_TS_TYPE_ALIAS = re.compile(r"^(?:export\s+)?(?:declare\s+)?type\s+(?P<name>[A-Za-z0-9_$]+)")
_TS_BINDING = re.compile(
    r"^(?:export\s+)?(?:declare\s+)?(?P<kind>const|let|var)\s+(?P<name>[A-Za-z0-9_$]+)"
)
_TS_DEFAULT = re.compile(r"^export\s+default\b")


def _ts_definition_at(line: str) -> tuple[str, str] | None:
    """Return ``(kind, name)`` when a line begins a top-level TS definition.

    Tries the definition patterns in priority order and returns the first hit,
    or ``None`` when the line is not a top-level definition start. An anonymous
    ``export default`` (a function/class/value with no name) is reported with the
    name ``default`` so it still becomes its own block.

    Parameters
    ----------
    line : str
        One source line, matched from column 0 (so an indented, nested
        definition never matches).

    Returns
    -------
    tuple[str, str] | None
        ``(kind, name)`` — e.g. ``("function", "useCounter")``,
        ``("interface", "Props")``, ``("const", "Badge")`` — or ``None``.
    """
    func_class = _TS_FUNC_CLASS.match(line)
    if func_class:
        return func_class.group("kind"), func_class.group("name") or "default"
    typeish = _TS_TYPEISH.match(line)
    if typeish:
        return typeish.group("kind"), typeish.group("name")
    type_alias = _TS_TYPE_ALIAS.match(line)
    if type_alias:
        return "type", type_alias.group("name")
    binding = _TS_BINDING.match(line)
    if binding:
        return binding.group("kind"), binding.group("name")
    if _TS_DEFAULT.match(line):
        return "default", "default"
    return None


def split_typescript_source(source: str) -> list[Block]:
    """Split TypeScript/JavaScript ``source`` into gap-free top-level blocks.

    A line scanner (not a real parser — see :func:`_ts_definition_at`) marks a
    new block at every column-0 ``function`` / ``class`` / ``interface`` /
    ``type`` / ``enum`` declaration and every ``const`` / ``let`` / ``var``
    binding, exported or bare, plus a bare ``export default``. The module header
    is everything before the first such line. Same gap-free tiling as the Python
    splitter, so a page always shows every line.

    Parameters
    ----------
    source : str
        The complete text of a ``.ts`` / ``.tsx`` file.

    Returns
    -------
    list[Block]
        Blocks in source order; a single ``module-header`` block when no
        top-level definition is found; an empty list for an empty file.
    """
    lines = source.splitlines()
    if not lines:
        return []

    starts: list[tuple[int, str, str]] = []
    for index, line in enumerate(lines):
        found = _ts_definition_at(line)
        if found is not None:
            kind, name = found
            starts.append((index + 1, kind, name))

    if not starts:
        return [Block("module-header", "Module header — the whole file", 1, len(lines))]

    seen: dict[str, int] = {}
    blocks: list[Block] = []
    if starts[0][0] > 1:
        blocks.append(
            Block(
                _uniquify("module-header", seen),
                "Module header — imports and top-level setup",
                1,
                starts[0][0] - 1,
            )
        )
    for index, (start_line, kind, name) in enumerate(starts):
        end_line = starts[index + 1][0] - 1 if index + 1 < len(starts) else len(lines)
        blocks.append(
            Block(
                _uniquify(f"{kind}:{name}", seen),
                f"``{kind} {name}``",
                start_line,
                end_line,
            )
        )
    return blocks


# --------------------------------------------------------------------------
# Page marker format
# --------------------------------------------------------------------------
#
# Every marker is an RST *comment* (``.. TEXT`` with no ``::``), so Sphinx
# renders nothing for it and ``-W`` never trips over it. The generator and the
# checker parse these lines to find blocks, their line ranges, and the prose
# regions.

# Page-level header: names the source file this page documents and whether the
# page is in a "complete" package (prose required on every block).
PAGE_MARKER = ".. CG-PAGE"
# One per block: its stable id and the current source line range.
BLOCK_MARKER = ".. CG-BLOCK"
# Wrap the hand-written prose for one block. The generator rewrites everything
# except the lines strictly between these two markers.
EXPLANATION_START = ".. CG-EXPLANATION-START"
EXPLANATION_END = ".. CG-EXPLANATION-END"
# Present inside an explanation region that is still an unfilled placeholder.
# Removed by hand when real prose is written; the checker treats its presence
# (or an empty region) as "not yet explained".
PLACEHOLDER_MARKER = ".. CG-PLACEHOLDER"
# Introduces the block of preserved prose whose block no longer exists in the
# source (e.g. a renamed function). Nothing is ever silently discarded.
ORPHAN_MARKER = ".. CG-ORPHANED-EXPLANATIONS"

_PAGE_RE = re.compile(r"^\.\. CG-PAGE source=(?P<source>\S+) complete=(?P<complete>\S+)")
_BLOCK_RE = re.compile(r"^\.\. CG-BLOCK id=(?P<id>\S+) lines=(?P<start>\d+)-(?P<end>\d+)")
_EXPL_START_RE = re.compile(r"^\.\. CG-EXPLANATION-START id=(?P<id>\S+)")
_EXPL_END_RE = re.compile(r"^\.\. CG-EXPLANATION-END id=(?P<id>\S+)")


@dataclass(frozen=True)
class ParsedPage:
    """What the checker/generator needs from an existing page file.

    Attributes
    ----------
    source_path : str | None
        The repo-relative source path from the ``CG-PAGE`` marker, or ``None``
        when the page has no such marker (not a generated page).
    complete : bool
        The ``complete=`` flag from the ``CG-PAGE`` marker.
    block_ranges : dict[str, tuple[int, int]]
        Recorded ``block_id -> (start, end)`` from every ``CG-BLOCK`` marker —
        compared against a fresh split to detect drift.
    explanations : dict[str, list[str]]
        ``block_id -> prose lines`` captured strictly between the explanation
        markers, so a regeneration can put the same prose back.
    placeholder_ids : set[str]
        Block ids whose explanation region is still an unfilled placeholder.
    """

    source_path: str | None
    complete: bool
    block_ranges: dict[str, tuple[int, int]]
    explanations: dict[str, list[str]]
    placeholder_ids: set[str]


def parse_page(text: str) -> ParsedPage:
    """Parse a generated page's markers, ranges and preserved prose regions.

    Parameters
    ----------
    text : str
        The full text of a ``.rst`` page.

    Returns
    -------
    ParsedPage
        The extracted metadata (see :class:`ParsedPage`).
    """
    source_path: str | None = None
    complete = False
    block_ranges: dict[str, tuple[int, int]] = {}
    explanations: dict[str, list[str]] = {}
    placeholder_ids: set[str] = set()

    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        page_match = _PAGE_RE.match(line)
        if page_match:
            source_path = page_match.group("source")
            complete = page_match.group("complete").strip().lower() == "true"
            index += 1
            continue
        block_match = _BLOCK_RE.match(line)
        if block_match:
            block_ranges[block_match.group("id")] = (
                int(block_match.group("start")),
                int(block_match.group("end")),
            )
            index += 1
            continue
        start_match = _EXPL_START_RE.match(line)
        if start_match:
            block_id = start_match.group("id")
            body: list[str] = []
            index += 1
            while index < len(lines):
                end_match = _EXPL_END_RE.match(lines[index])
                if end_match and end_match.group("id") == block_id:
                    break
                body.append(lines[index])
                index += 1
            explanations[block_id] = body
            if _region_is_placeholder(body):
                placeholder_ids.add(block_id)
            continue
        index += 1

    return ParsedPage(source_path, complete, block_ranges, explanations, placeholder_ids)


def _region_is_placeholder(body: list[str]) -> bool:
    """Return whether an explanation region is unfilled (placeholder or empty).

    A region counts as unfilled when it still carries the placeholder marker, or
    when it contains no prose at all (only blank lines and comment markers).
    """
    has_prose = False
    for raw in body:
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith(PLACEHOLDER_MARKER):
            return True
        if stripped.startswith(".."):
            continue  # a comment marker, not prose
        has_prose = True
    return not has_prose
