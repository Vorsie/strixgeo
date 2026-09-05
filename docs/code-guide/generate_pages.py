"""Generate the code-guide pages and index pages from the real source tree.

Run it with::

    uv run python docs/code-guide/generate_pages.py

For every source file under a configured tree (:data:`code_guide_config.SOURCE_ROOTS`)
it emits one ``.rst`` page under ``pages/`` that shows the whole file, split into
blocks at every top-level function, class and method, each block a
``literalinclude`` of the real file followed by a hand-written explanation. It
also emits the reading-order index pages under ``indexes/`` and the root
``index.rst``.

**Regeneration never destroys prose.** Hand-written explanations live between
the ``CG-EXPLANATION-START`` / ``CG-EXPLANATION-END`` markers (see
:mod:`code_guide_lib`); on a re-run this script reads them back and re-attaches
them by block id. A block that has disappeared from the source (a renamed
function) has its prose parked in an "orphaned explanations" comment at the foot
of the page rather than dropped. The line ranges in the ``literalinclude`` and
``CG-BLOCK`` markers are always refreshed to match the current file, which is
what lets ``check_pages.py`` detect drift.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

# The two sibling helper modules live in this directory. When the script is run
# as ``python docs/code-guide/generate_pages.py`` its own directory is on
# ``sys.path`` already; the insert makes an explicit invocation robust too.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import code_guide_config as config  # noqa: E402
import code_guide_lib as lib  # noqa: E402

# --------------------------------------------------------------------------
# Placeholder prose emitted for a block that has no hand-written explanation
# yet. The CG-PLACEHOLDER marker is how check_pages.py knows the block is
# unfinished; a human replaces this whole region with real prose.
# --------------------------------------------------------------------------
_PLACEHOLDER_BODY = [
    "",
    lib.PLACEHOLDER_MARKER,
    "",
    ".. note::",
    "",
    "   **Plain-English explanation not yet written.** This block still needs a",
    '   "What this does" and "Why it is here" walkthrough in the plainest',
    "   English possible.",
    "",
]


@dataclass(frozen=True)
class SourceFile:
    """One source file the guide covers.

    Attributes
    ----------
    rel_path : str
        Path relative to the repository root, POSIX form (e.g.
        ``src/groundmodel/api/serve.py``).
    abs_path : Path
        Absolute path on disk.
    suffix : str
        File suffix (``.py`` / ``.ts`` / ``.tsx``).
    """

    rel_path: str
    abs_path: Path
    suffix: str


def discover_sources() -> list[SourceFile]:
    """Walk every configured source tree and return the files to document.

    Returns
    -------
    list[SourceFile]
        Every ``.py`` (and, for a TypeScript root, ``.ts`` / ``.tsx``) file
        under a configured tree, sorted by path, with ignored directories
        (``__pycache__`` etc.) skipped.
    """
    suffixes = set(config.PYTHON_SUFFIXES) | set(config.TYPESCRIPT_SUFFIXES)
    found: list[SourceFile] = []
    for source_root in config.SOURCE_ROOTS:
        root = config.REPO_ROOT / source_root.rel_root
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            if any(part in config.IGNORED_DIR_NAMES for part in path.relative_to(root).parts):
                continue
            # Skip test/spec files (``foo.test.ts``, ``bar.spec.tsx``): the guide
            # documents the code that ships, not its tests.
            if any(marker in path.name for marker in config.EXCLUDED_FILENAME_MARKERS):
                continue
            rel = path.relative_to(config.REPO_ROOT).as_posix()
            found.append(SourceFile(rel, path, path.suffix))
    return found


def _root_for(rel_path: str) -> config.SourceRoot | None:
    """Return the configured source root a repo-relative path belongs to, if any."""
    for source_root in config.SOURCE_ROOTS:
        if rel_path == source_root.rel_root or rel_path.startswith(source_root.rel_root + "/"):
            return source_root
    return None


def page_slug(rel_path: str) -> str:
    """Turn a repo-relative source path into a unique, flat page slug.

    ``src/groundmodel/api/serve.py`` -> ``groundmodel.api.serve``;
    ``desktop/src/main/index.ts`` -> ``desktop.main.index``. The suffix and the
    source root's ``strip_prefix`` are dropped, the root's ``slug_prefix`` is
    prepended, and the separators become dots. Because file paths are unique,
    slugs are unique (and the ``desktop.`` prefix keeps the two trees from
    colliding). A path under no configured root falls back to stripping ``src/``.
    """
    without_suffix = rel_path.rsplit(".", 1)[0]
    source_root = _root_for(rel_path)
    if source_root is not None:
        trimmed = (
            without_suffix[len(source_root.strip_prefix) :]
            if without_suffix.startswith(source_root.strip_prefix)
            else without_suffix
        )
        return source_root.slug_prefix + trimmed.replace("/", ".")
    trimmed = without_suffix[len("src/") :] if without_suffix.startswith("src/") else without_suffix
    return trimmed.replace("/", ".")


def display_name(rel_path: str) -> str:
    """A readable module name for the page title.

    ``.../api/serve.py`` -> ``groundmodel.api.serve``;
    ``.../api/__init__.py`` -> ``groundmodel.api`` (the package itself).
    """
    slug = page_slug(rel_path)
    if slug.endswith(".__init__"):
        return slug[: -len(".__init__")]
    return slug


def literalinclude_path(rel_path: str) -> str:
    """Relative path from a ``pages/`` document to the real source file.

    Pages live in ``docs/code-guide/pages/``; the source is at the repo root, so
    three ``..`` segments climb from ``pages/`` to the repo root.
    """
    return f"../../../{rel_path}"


def _language_for(suffix: str) -> str:
    """Pygments lexer name for a source suffix."""
    if suffix in config.TYPESCRIPT_SUFFIXES:
        return "tsx" if suffix == ".tsx" else "typescript"
    return "python"


def _split_for(source: str, suffix: str) -> list[lib.Block]:
    """Split a source string with the splitter matching its suffix.

    Falls back to a single whole-file block if the Python source does not parse
    (should not happen in a working tree, but a broken file must still render).
    """
    if suffix in config.TYPESCRIPT_SUFFIXES:
        return lib.split_typescript_source(source)
    try:
        return lib.split_python_source(source)
    except SyntaxError as exc:  # pragma: no cover - defensive
        print(f"WARNING: {exc} — showing the file as one block", file=sys.stderr)
        line_count = len(source.splitlines())
        return [lib.Block("module-header", "Module header — the whole file", 1, max(line_count, 1))]


def _heading(text: str, underline: str) -> list[str]:
    """Return a title line plus an underline exactly as long as the title."""
    return [text, underline * max(len(text), 3), ""]


def render_page(source: SourceFile, preserved: dict[str, list[str]]) -> str:
    """Render one source file's page, re-attaching preserved prose by block id.

    Parameters
    ----------
    source : SourceFile
        The file being documented.
    preserved : dict[str, list[str]]
        ``block_id -> prose lines`` recovered from any existing page, so a
        regeneration keeps hand-written explanations.

    Returns
    -------
    str
        The full ``.rst`` page text.
    """
    text = source.abs_path.read_text(encoding="utf-8")
    blocks = _split_for(text, source.suffix)
    is_complete = source.rel_path in config.COMPLETE_MODULES

    name = display_name(source.rel_path)
    out: list[str] = []
    out.extend(_heading(name, "="))
    out.append(f"{lib.PAGE_MARKER} source={source.rel_path} complete={str(is_complete).lower()}")
    out.append("")
    out.append(f"*Source file:* ``{source.rel_path}``")
    out.append("")

    if not blocks:
        out.append("This file is empty.")
        out.append("")
        return "\n".join(out) + "\n"

    out.append(".. contents::")
    out.append("   :local:")
    out.append("   :depth: 1")
    out.append("")

    used_ids: set[str] = set()
    for block in blocks:
        used_ids.add(block.block_id)
        out.extend(_heading(block.title, "-"))
        out.append(f"{lib.BLOCK_MARKER} id={block.block_id} lines={block.start}-{block.end}")
        out.append("")
        out.append(f".. literalinclude:: {literalinclude_path(source.rel_path)}")
        out.append(f"   :language: {_language_for(source.suffix)}")
        out.append(f"   :lines: {block.start}-{block.end}")
        out.append("   :lineno-match:")
        out.append("")
        out.append(f"{lib.EXPLANATION_START} id={block.block_id}")
        body = preserved.get(block.block_id)
        if body is None or lib._region_is_placeholder(body):
            body = list(_PLACEHOLDER_BODY)
        out.extend(body)
        out.append(f"{lib.EXPLANATION_END} id={block.block_id}")
        out.append("")

    _append_orphans(out, preserved, used_ids)
    return "\n".join(out) + "\n"


def _append_orphans(out: list[str], preserved: dict[str, list[str]], used_ids: set[str]) -> None:
    """Park prose whose block no longer exists so a regeneration never drops it."""
    orphans = {bid: body for bid, body in preserved.items() if bid not in used_ids}
    orphans = {bid: body for bid, body in orphans.items() if not lib._region_is_placeholder(body)}
    if not orphans:
        return
    out.append(f"{lib.ORPHAN_MARKER}")
    out.append("")
    out.append(".. note::")
    out.append("")
    out.append("   These explanations were written for blocks that no longer exist in")
    out.append("   the source (the code was renamed or moved). They are kept here so")
    out.append("   the prose is not lost; move each into its new block above.")
    out.append("")
    for block_id, body in orphans.items():
        out.append(f"{lib.EXPLANATION_START} id={block_id}")
        out.extend(body)
        out.append(f"{lib.EXPLANATION_END} id={block_id}")
        out.append("")


def _load_preserved(page_path: Path) -> dict[str, list[str]]:
    """Read an existing page's explanation regions, if the page exists."""
    if not page_path.exists():
        return {}
    return lib.parse_page(page_path.read_text(encoding="utf-8")).explanations


# --------------------------------------------------------------------------
# Grouping into the reading order + index pages
# --------------------------------------------------------------------------


def assign_group(rel_path: str) -> str:
    """Return the reading-order group slug a source file belongs to.

    Groups are tried in list order; the first that names the path in ``members``
    or matches it by ``prefixes`` claims it — unless the path matches one of that
    group's ``exclude_prefixes``, in which case the group is skipped and matching
    continues (this is how group 9 takes the renderer shell but leaves its stages
    to groups 10-11). An unclaimed path falls into the backend catch-all.
    """
    for group in config.READING_ORDER:
        members = group["members"]
        prefixes = group["prefixes"]
        excludes = group.get("exclude_prefixes", [])
        assert (
            isinstance(members, list) and isinstance(prefixes, list) and isinstance(excludes, list)
        )
        if any(rel_path.startswith(prefix) for prefix in excludes):
            continue
        if rel_path in members:
            return str(group["slug"])
        if any(rel_path.startswith(prefix) for prefix in prefixes):
            return str(group["slug"])
    return config.REST_GROUP_SLUG


def rest_bucket(rel_path: str) -> str:
    """Bucket a leftover file by its top-level package under ``src/groundmodel``.

    ``src/groundmodel/application/foo.py`` -> ``application``;
    a file directly under ``src/groundmodel`` -> ``root``.
    """
    parts = rel_path.split("/")
    # parts == ['src', 'groundmodel', '<package>', ...]
    if len(parts) >= 4:
        return parts[2]
    return "root"


def ordered_members(group: dict[str, object], sources: list[SourceFile]) -> list[SourceFile]:
    """Order a group's files: curated ``members`` first, then the rest sorted."""
    members = group["members"]
    assert isinstance(members, list)
    by_rel = {s.rel_path: s for s in sources}
    curated = [by_rel[m] for m in members if m in by_rel]
    curated_set = {s.rel_path for s in curated}
    remainder = sorted(
        (s for s in sources if s.rel_path not in curated_set),
        key=lambda s: s.rel_path,
    )
    return curated + remainder


def _index_intro(existing: Path, default: list[str]) -> list[str]:
    """Recover a hand-written index intro region, or fall back to a default."""
    if existing.exists():
        parsed = lib.parse_page(existing.read_text(encoding="utf-8"))
        body = parsed.explanations.get("intro")
        if body is not None and not lib._region_is_placeholder(body):
            return body
    return default


def _render_index(
    title: str,
    intro_body: list[str],
    toctree_entries: list[str],
    caption: str | None = None,
) -> str:
    """Render an index page: title, preserved intro region, generated toctree."""
    out: list[str] = []
    out.extend(_heading(title, "="))
    out.append(f"{lib.EXPLANATION_START} id=intro")
    out.extend(intro_body)
    out.append(f"{lib.EXPLANATION_END} id=intro")
    out.append("")
    out.append(".. toctree::")
    out.append("   :maxdepth: 1")
    if caption:
        out.append(f"   :caption: {caption}")
    out.append("")
    for entry in toctree_entries:
        out.append(f"   {entry}")
    out.append("")
    return "\n".join(out) + "\n"


def write_pages(sources: list[SourceFile], pages_dir: Path) -> int:
    """Write every source file's page; return how many were written."""
    pages_dir.mkdir(parents=True, exist_ok=True)
    for source in sources:
        page_path = pages_dir / f"{page_slug(source.rel_path)}.rst"
        preserved = _load_preserved(page_path)
        page_path.write_text(render_page(source, preserved), encoding="utf-8")
    return len(sources)


def write_indexes(sources: list[SourceFile], guide_root: Path) -> None:
    """Write the group index pages, the rest-bucket pages and the root index."""
    indexes_dir = guide_root / "indexes"
    indexes_dir.mkdir(parents=True, exist_ok=True)
    pages_dir_name = config.PAGES_DIRNAME

    grouped: dict[str, list[SourceFile]] = {}
    for source in sources:
        grouped.setdefault(assign_group(source.rel_path), []).append(source)

    backend_group_docs: list[str] = []
    desktop_group_docs: list[str] = []

    # Reading-order groups: backend 1..6, then desktop 8..13. Their index docs are
    # kept in two lists so the root toctree can slot the backend catch-all (07)
    # between them.
    for group in config.READING_ORDER:
        slug = str(group["slug"])
        title = str(group["title"])
        members = ordered_members(group, grouped.get(slug, []))
        entries = [f"../{pages_dir_name}/{page_slug(s.rel_path)}" for s in members]
        intro = _index_intro(
            indexes_dir / f"{slug}.rst",
            ["", f"{len(members)} file(s) in this group.", ""],
        )
        (indexes_dir / f"{slug}.rst").write_text(
            _render_index(title, intro, entries), encoding="utf-8"
        )
        if group.get("tree") == "desktop":
            desktop_group_docs.append(f"indexes/{slug}")
        else:
            backend_group_docs.append(f"indexes/{slug}")

    # Group 7 — everything else (backend only), bucketed by top-level package.
    rest = grouped.get(config.REST_GROUP_SLUG, [])
    buckets: dict[str, list[SourceFile]] = {}
    for source in rest:
        buckets.setdefault(rest_bucket(source.rel_path), []).append(source)

    rest_bucket_docs: list[str] = []
    for bucket in sorted(buckets):
        bucket_sources = sorted(buckets[bucket], key=lambda s: s.rel_path)
        entries = [f"../{pages_dir_name}/{page_slug(s.rel_path)}" for s in bucket_sources]
        slug = f"{config.REST_GROUP_SLUG}-{bucket}"
        title = f"Everything else — ``{bucket}``"
        intro = _index_intro(
            indexes_dir / f"{slug}.rst",
            ["", f"{len(bucket_sources)} file(s) in the ``{bucket}`` package.", ""],
        )
        (indexes_dir / f"{slug}.rst").write_text(
            _render_index(title, intro, entries), encoding="utf-8"
        )
        # This entry is toctree'd from 07-everything-else.rst, which itself lives
        # in indexes/, so the reference is relative to that folder (no prefix).
        rest_bucket_docs.append(slug)

    rest_intro = _index_intro(
        indexes_dir / f"{config.REST_GROUP_SLUG}.rst",
        [
            "",
            "Every source file the beta-critical reading order above did not",
            "already claim, grouped by top-level package. These pages are mostly",
            "generated skeletons awaiting their plain-English explanations.",
            "",
        ],
    )
    (indexes_dir / f"{config.REST_GROUP_SLUG}.rst").write_text(
        _render_index(config.REST_GROUP_TITLE, rest_intro, rest_bucket_docs), encoding="utf-8"
    )

    # Root toctree order: backend reading groups (1-6), the backend catch-all
    # (7), then the desktop reading groups (8-13).
    group_index_docs = (
        backend_group_docs + [f"indexes/{config.REST_GROUP_SLUG}"] + desktop_group_docs
    )
    _write_root_index(guide_root, group_index_docs)


def _write_root_index(guide_root: Path, group_index_docs: list[str]) -> None:
    """Write the root ``index.rst``: preserved intro + a toctree of the groups."""
    default_intro = [
        "",
        "This guide shows the StrixGeo source — the Python engine (backend) and",
        "the Electron desktop app — one page per file, split into small blocks.",
        "Under every block of real code is a plain-English explanation of what it",
        "does and why it is there.",
        "",
        "Start with :doc:`start-here`, then read the numbered groups in order:",
        "groups 1-7 are the backend engine, groups 8-13 the desktop app.",
        "",
    ]
    intro = _index_intro(guide_root / "index.rst", default_intro)
    out: list[str] = []
    out.extend(_heading("StrixGeo Code Guide", "="))
    out.append(f"{lib.EXPLANATION_START} id=intro")
    out.extend(intro)
    out.append(f"{lib.EXPLANATION_END} id=intro")
    out.append("")
    out.append(".. toctree::")
    out.append("   :maxdepth: 1")
    out.append("   :caption: Reading order")
    out.append("")
    out.append("   start-here")
    for doc in group_index_docs:
        out.append(f"   {doc}")
    out.append("")
    (guide_root / "index.rst").write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> int:
    """Regenerate every page and index; print a one-line summary."""
    sources = discover_sources()
    pages_dir = config.GUIDE_ROOT / config.PAGES_DIRNAME
    written = write_pages(sources, pages_dir)
    write_indexes(sources, config.GUIDE_ROOT)
    complete = sum(1 for s in sources if s.rel_path in config.COMPLETE_MODULES)
    print(
        f"code-guide: wrote {written} page(s) "
        f"({complete} in complete package(s)) + index pages under "
        f"{config.GUIDE_ROOT.relative_to(config.REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    # Make stdout UTF-8 so the summary line (and any path with a non-ASCII
    # character) prints cleanly on a Windows console or under the build gate.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8")
    raise SystemExit(main())
