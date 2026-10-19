"""Generate ``docs/erd.md``: a Mermaid Entity-Relationship Diagram of the schema.

The diagram is built from the ORM metadata (``Base.metadata``), loaded through
the same import hook Alembic's ``migrations/env.py`` uses
(``import groundmodel.infrastructure.db.models``), so every mapped table is
present. No database connection is needed.

The output holds an overview diagram (table names + relationships) and one
diagram per domain group with the full columns. The output is byte-stable:
tables, columns-in-declaration-order and relationships are emitted in a fixed
order, with ``\\n`` line endings.

Usage::

    uv run python scripts/gen_erd.py           # rewrite docs/erd.md
    uv run python scripts/gen_erd.py --check   # exit 1 when docs/erd.md is stale

``tests/unit/docs/test_erd_up_to_date.py`` fails when the file is stale, so CI
keeps it current.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path

from sqlalchemy import Column, MetaData, Table, UniqueConstraint
from sqlalchemy.types import TypeEngine

# --- constants (kept in the script: it is a standalone dev tool) -------------

REPO_ROOT = Path(__file__).resolve().parents[1]
ERD_PATH = REPO_ROOT / "docs" / "erd.md"
REGENERATE_COMMAND = "uv run python scripts/gen_erd.py"

# A group diagram above ~20 tables stops being readable on GitHub.
MAX_GROUP_SIZE = 20

# Section order in docs/erd.md.
GROUP_ORDER = [
    "Project and investigations",
    "Samples and lab tests",
    "Geological and litho interpretation",
    "Bodies and 3-D build",
]

# Every ORM table maps to exactly one group. The models package is flat (one
# file per class), so the group cannot be derived from a subpackage; an
# explicit map is the deterministic choice. A new table without an entry makes
# the generator stop with a message naming it.
TABLE_GROUPS: dict[str, str] = {
    # Project and investigations: the project, CPT + borehole data as imported.
    "project": "Project and investigations",
    "cpt": "Project and investigations",
    "cpt_series": "Project and investigations",
    "borehole": "Project and investigations",
    "drill_segment": "Project and investigations",
    "field_log_interval": "Project and investigations",
    "observation": "Project and investigations",
    "observation_layer": "Project and investigations",
    "admixture": "Project and investigations",
    "investigation_review": "Project and investigations",
    "bed_override": "Project and investigations",
    # Samples and lab tests: scalar lab families + the raw lab series tables.
    "sample": "Samples and lab tests",
    "atterberg_limits": "Samples and lab tests",
    "caco3_content": "Samples and lab tests",
    "grain_size": "Samples and lab tests",
    "organic_content": "Samples and lab tests",
    "scalar_lab_test": "Samples and lab tests",
    "water_content": "Samples and lab tests",
    "lab_series_test": "Samples and lab tests",
    "lab_series_specimen": "Samples and lab tests",
    "lab_series_stage": "Samples and lab tests",
    "lab_series_channel": "Samples and lab tests",
    "lab_series_lab_result": "Samples and lab tests",
    # Geological and litho interpretation: models, formations, contacts, sections.
    "geological_model": "Geological and litho interpretation",
    "geological_formation": "Geological and litho interpretation",
    "formation_contact": "Geological and litho interpretation",
    "formation_absence": "Geological and litho interpretation",
    "formation_surface": "Geological and litho interpretation",
    "litho_layer": "Geological and litho interpretation",
    "litho_contact_correlation_edge": "Geological and litho interpretation",
    "cross_section": "Geological and litho interpretation",
    "geotech_tie_tombstone": "Geological and litho interpretation",
    # Bodies and 3-D build: body identity facts + the voxel build output.
    "body": "Bodies and 3-D build",
    "body_boundary_node": "Bodies and 3-D build",
    "body_boundary_shape": "Bodies and 3-D build",
    "body_geometry_fact": "Bodies and 3-D build",
    "body_separation": "Bodies and 3-D build",
    "body_union": "Bodies and 3-D build",
    "litho_body_solid": "Bodies and 3-D build",
    "litho_build_generation": "Bodies and 3-D build",
}

# SQLAlchemy type class name -> Mermaid attribute type. Mermaid's erDiagram
# grammar rejects spaces, parentheses and brackets in a type, so every type is
# reduced to one ``[A-Za-z][A-Za-z0-9_]*`` word.
SIMPLE_TYPE_NAMES: dict[str, str] = {
    "BigInteger": "bigint",
    "SmallInteger": "smallint",
    "Integer": "int",
    "Boolean": "bool",
    "Date": "date",
    "Text": "text",
    "UUID": "uuid",
    "Uuid": "uuid",
    "JSONB": "jsonb",
    "JSON": "json",
    "LargeBinary": "bytea",
    "DOUBLE_PRECISION": "double",
    "Double": "double",
    "Float": "float",
    "Numeric": "numeric",
}

_NON_WORD = re.compile(r"[^A-Za-z0-9_]+")


# --- metadata ------------------------------------------------------------------


def load_metadata() -> MetaData:
    """Import every ORM model and return the populated declarative metadata.

    Returns
    -------
    sqlalchemy.MetaData
        ``Base.metadata`` after the models package registered all tables.
    """
    # Same hook as migrations/env.py: the package __init__ imports every model.
    import groundmodel.infrastructure.db.models  # noqa: F401
    from groundmodel.infrastructure.db.base import Base

    return Base.metadata


# --- type and column rendering ------------------------------------------------


def mermaid_type(sql_type: TypeEngine[object]) -> str:
    """Return a Mermaid-safe single-word name for a SQLAlchemy column type.

    Parameters
    ----------
    sql_type : sqlalchemy.types.TypeEngine
        The column type.

    Returns
    -------
    str
        A word matching ``[A-Za-z][A-Za-z0-9_]*``, e.g. ``varchar200``,
        ``timestamptz``, ``double_array``, ``geometry_point``.
    """
    for klass in type(sql_type).__mro__:
        name = klass.__name__
        if name == "ARRAY":
            item = sql_type.item_type  # type: ignore[attr-defined]
            return f"{mermaid_type(item)}_array"
        if name == "Geometry":
            geometry = str(getattr(sql_type, "geometry_type", "") or "").lower()
            return f"geometry_{geometry}" if geometry else "geometry"
        if name == "DateTime":
            return "timestamptz" if getattr(sql_type, "timezone", False) else "timestamp"
        if name in SIMPLE_TYPE_NAMES:
            return SIMPLE_TYPE_NAMES[name]
        if name == "String":
            length = getattr(sql_type, "length", None)
            return f"varchar{length}" if length else "varchar"
    fallback = _NON_WORD.sub("_", type(sql_type).__name__.lower()).strip("_")
    return fallback or "unknown"


def _is_unique(column: Column[object]) -> bool:
    """Return whether the column alone is unique (flag, constraint, index or sole PK)."""
    if column.unique:
        return True
    table = column.table
    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint) and [c.name for c in constraint.columns] == [
            column.name
        ]:
            return True
    for index in table.indexes:
        if index.unique and [c.name for c in index.columns] == [column.name]:
            return True
    primary = list(table.primary_key.columns)
    return len(primary) == 1 and primary[0].name == column.name


def _attribute_line(column: Column[object]) -> str:
    """Return one Mermaid attribute line: ``type name KEYS "nullable"``."""
    keys = []
    if column.primary_key:
        keys.append("PK")
    if column.foreign_keys:
        keys.append("FK")
    if not column.primary_key and _is_unique(column):
        keys.append("UK")
    parts = [mermaid_type(column.type), column.name]
    if keys:
        parts.append(",".join(keys))
    if column.nullable and not column.primary_key:
        parts.append('"nullable"')
    return "        " + " ".join(parts)


def _entity_block(table: Table) -> list[str]:
    """Return the Mermaid entity block of one table with all its columns."""
    lines = [f"    {table.name} {{"]
    lines.extend(_attribute_line(column) for column in table.columns)
    lines.append("    }")
    return lines


def relationship_lines(tables: Iterable[Table], only_parents: set[str] | None = None) -> list[str]:
    """Return one Mermaid relationship line per foreign key of the given tables.

    The child (referencing) table is on the left; standard crow's foot. The
    child side is zero-or-many (``}o``) because a parent may have no children,
    or zero-or-one (``|o``) when the FK column is unique. The parent side is
    exactly one (``||``) for a NOT NULL FK and zero-or-one (``o|``) for a
    nullable FK. The label is the FK column name.

    Parameters
    ----------
    tables : Iterable[sqlalchemy.Table]
        The referencing tables whose foreign keys are drawn.
    only_parents : set[str] | None
        When given, draw only the foreign keys that point at these tables.

    Returns
    -------
    list[str]
        Lines sorted by (child table, column, parent table).
    """
    entries = []
    for table in tables:
        for fk in table.foreign_keys:
            column = fk.parent
            left = "|o" if _is_unique(column) else "}o"
            right = "o|" if column.nullable else "||"
            parent = fk.column.table.name
            if only_parents is not None and parent not in only_parents:
                continue
            entries.append((table.name, column.name, parent, left, right))
    return [
        f'    {child} {left}--{right} {parent} : "{col}"'
        for child, col, parent, left, right in sorted(entries)
    ]


# --- document -----------------------------------------------------------------


def _group_of(table_name: str) -> str:
    """Return the group of a table, or stop with a message naming the gap."""
    try:
        return TABLE_GROUPS[table_name]
    except KeyError:
        raise SystemExit(
            f"gen_erd: table {table_name!r} has no group. Add it to TABLE_GROUPS "
            f"in scripts/gen_erd.py, then run: {REGENERATE_COMMAND}"
        ) from None


def render_erd(metadata: MetaData) -> str:
    """Render the full ``docs/erd.md`` Markdown text from the metadata.

    Parameters
    ----------
    metadata : sqlalchemy.MetaData
        The ORM metadata (see :func:`load_metadata`).

    Returns
    -------
    str
        The Markdown document with ``\\n`` line endings, ending in one newline.

    Raises
    ------
    SystemExit
        When a table has no entry in ``TABLE_GROUPS``.
    """
    tables = sorted(metadata.tables.values(), key=lambda t: t.name)
    groups: dict[str, list[Table]] = {group: [] for group in GROUP_ORDER}
    for table in tables:
        groups[_group_of(table.name)].append(table)

    out = [
        "# Database ERD",
        "",
        "<!-- Generated by scripts/gen_erd.py from the ORM metadata. Do not edit by hand. -->",
        "",
        "Generated by `scripts/gen_erd.py` from the SQLAlchemy ORM metadata "
        "(`Base.metadata`). Do not edit by hand: regenerate with "
        f"`{REGENERATE_COMMAND}`. The unit test `tests/unit/docs/test_erd_up_to_date.py` "
        "fails when this file is stale.",
        "",
        "Objects that exist only in migrations (partial unique indexes, triggers, "
        "check constraints) are not drawn. A relationship line reads "
        '`child <cardinality> parent : "fk column"` in standard '
        "crow's-foot notation: "
        "the child side is zero-or-many (`}o`), or zero-or-one (`|o`) when the FK "
        "column is unique; the parent side is exactly one (`||`) for a NOT NULL FK "
        "and zero-or-one (`o|`) for a nullable FK. A nullable column carries the "
        'comment `"nullable"`.',
        "",
        f"{len(tables)} tables in {len(GROUP_ORDER)} groups:",
        "",
    ]
    out.extend(f"- {group}: {len(groups[group])} tables" for group in GROUP_ORDER)
    out += ["", "## Overview", "", "```mermaid", "erDiagram"]
    out.extend(f"    {table.name}" for table in tables)
    out.extend(relationship_lines(tables))
    out.append("```")

    for group in GROUP_ORDER:
        members = groups[group]
        names = {t.name for t in members}
        # Draw the group's own FKs plus the FKs from other groups that point
        # into it; the far-side table then shows as a bare entity.
        incoming = [
            t
            for t in tables
            if t.name not in names and any(fk.column.table.name in names for fk in t.foreign_keys)
        ]
        relationships = relationship_lines(members) + relationship_lines(incoming, names)
        out += ["", f"## {group}", "", "```mermaid", "erDiagram"]
        for table in members:
            out.extend(_entity_block(table))
        out.extend(sorted(relationships))
        out.append("```")
    return "\n".join(out) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    """Write ``docs/erd.md``, or with ``--check`` report whether it is stale.

    Parameters
    ----------
    argv : Sequence[str] | None
        Command-line arguments (``sys.argv[1:]`` when None).

    Returns
    -------
    int
        0 on success / up to date, 1 when ``--check`` finds a stale file.
    """
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 when the file is stale")
    parser.add_argument("--output", type=Path, default=ERD_PATH, help="target file")
    args = parser.parse_args(argv)

    fresh = render_erd(load_metadata())
    target: Path = args.output
    if args.check:
        # read_text normalises CRLF, so a CRLF checkout on Windows is not stale.
        current = target.read_text(encoding="utf-8") if target.is_file() else ""
        if current != fresh:
            print(
                f"gen_erd: {target} is stale (the ORM models changed). Run: {REGENERATE_COMMAND}",
                file=sys.stderr,
            )
            return 1
        print(f"gen_erd: {target} is up to date", file=sys.stderr)
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(fresh, encoding="utf-8", newline="\n")
    print(f"gen_erd: wrote {target} ({len(load_metadata().tables)} tables)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
