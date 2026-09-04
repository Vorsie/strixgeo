"""Configuration for the StrixGeo code guide generator and checker.

This is the single source of truth shared by :mod:`generate_pages` and
:mod:`check_pages`:

* which source trees the guide covers (``SOURCE_ROOTS``);
* which pages must be fully explained before the checker will pass
  (``COMPLETE_MODULES``);
* the beta-critical reading order that drives the index pages
  (``READING_ORDER``).

Kept as plain module-level data (per the project convention that constants live
in a dedicated file) so a value change touches one place. It is imported by the
two scripts after they add this directory to ``sys.path``; it deliberately
imports nothing from ``groundmodel`` so the guide can be generated and checked
without importing the application or standing up a database.
"""

from __future__ import annotations

from pathlib import Path

# Repository root, resolved from this file's location on disk
# (``<repo>/docs/code-guide/code_guide_config.py``) rather than from the working
# directory, so the scripts work no matter where they are invoked from.
REPO_ROOT: Path = Path(__file__).resolve().parents[2]

# The Sphinx source directory (this folder) and the sub-folder that holds the
# one-page-per-source-file pages.
GUIDE_ROOT: Path = Path(__file__).resolve().parent
PAGES_DIRNAME: str = "pages"

# Source trees the guide documents, as ``(label, path-relative-to-repo)``. The
# Python backend ships first; the desktop TypeScript tree is added to this list
# when the campaign reaches it (the generator already knows how to split
# ``.ts`` / ``.tsx`` — see ``code_guide_lib.split_typescript_source``).
SOURCE_ROOTS: list[tuple[str, str]] = [
    ("groundmodel", "src/groundmodel"),
]

# File suffixes the generator turns into pages, per source tree. Python only for
# now; ``.ts`` / ``.tsx`` are listed so a later desktop root picks them up.
PYTHON_SUFFIXES: tuple[str, ...] = (".py",)
TYPESCRIPT_SUFFIXES: tuple[str, ...] = (".ts", ".tsx")

# Directory names skipped anywhere in a source tree.
IGNORED_DIR_NAMES: frozenset[str] = frozenset(
    {"__pycache__", ".mypy_cache", ".pytest_cache", "node_modules", "_build"}
)

# The pages whose every block MUST carry a hand-written explanation for the
# checker to pass. These are the beta-critical files the founder reads first:
# the boot + activation path, and the CPT/geotech classification correlations.
# Everything NOT in this set is allowed to keep generated placeholders — the
# guide is a campaign, and the checker only demands completeness where a package
# has been declared done. Paths are relative to the repository root, POSIX form.
COMPLETE_MODULES: frozenset[str] = frozenset(
    {
        # Reading-order group (1): boot + activation + migrator + warm-up.
        "src/groundmodel/api/serve.py",
        "src/groundmodel/api/main.py",
        "src/groundmodel/api/boot_migration.py",
        "src/groundmodel/api/boot_migration_constants.py",
        "src/groundmodel/api/heavy_library_warmup.py",
        "src/groundmodel/api/heavy_library_warmup_constants.py",
        "src/groundmodel/infrastructure/db/database_migrator.py",
        "src/groundmodel/infrastructure/db/database_migrator_constants.py",
        # The CPT / NAD / litho classification correlations.
        "src/groundmodel/domain/services/robertson_2015.py",
        "src/groundmodel/domain/services/nad_classifier.py",
        "src/groundmodel/domain/services/nad_classification_constants.py",
        "src/groundmodel/domain/services/litho_segmentation.py",
    }
)


# The beta-critical reading order. Each group becomes one index page with a
# hand-written introduction and a toctree of its file pages. Groups are matched
# in list order: a module joins the FIRST group that names it in ``members`` or
# whose ``prefixes`` it starts with. Anything unmatched falls into the generated
# "Everything else" group, bucketed by top-level package.
#
# ``members`` is an ordered list of exact repo-relative paths — used where the
# reading order is curated and spans directories (group 1). ``prefixes`` is a
# list of repo-relative path prefixes — used for whole-package groups.
READING_ORDER: list[dict[str, object]] = [
    {
        "slug": "01-boot-and-activation",
        "title": "1. Boot and activation — how the engine starts",
        "members": [
            "src/groundmodel/api/serve.py",
            "src/groundmodel/api/main.py",
            "src/groundmodel/api/boot_migration.py",
            "src/groundmodel/api/boot_migration_constants.py",
            "src/groundmodel/infrastructure/db/database_migrator.py",
            "src/groundmodel/infrastructure/db/database_migrator_constants.py",
            "src/groundmodel/api/heavy_library_warmup.py",
            "src/groundmodel/api/heavy_library_warmup_constants.py",
        ],
        "prefixes": [],
    },
    {
        "slug": "02-parsers",
        "title": "2. Parsers — reading CPT, borehole and DOV data",
        "members": [],
        "prefixes": ["src/groundmodel/infrastructure/parsers/"],
    },
    {
        "slug": "03-domain-models-and-storage",
        "title": "3. Domain models and storage — the shape of the data",
        "members": [],
        "prefixes": [
            "src/groundmodel/domain/models/",
            "src/groundmodel/domain/value_objects/",
            "src/groundmodel/infrastructure/db/models/",
            "src/groundmodel/infrastructure/db/repositories/",
        ],
    },
    {
        "slug": "04-litho-engine",
        "title": "4. The fill / litho engine — turning readings into layers",
        "members": [],
        "prefixes": ["src/groundmodel/domain/services/"],
    },
    {
        "slug": "05-geotech",
        "title": "5. Geotech — NAD packing classes and subdivision",
        "members": [
            "src/groundmodel/application/divide_boreholes.py",
            "src/groundmodel/application/subdivide_all_bodies.py",
        ],
        "prefixes": [
            "src/groundmodel/application/geotech_",
        ],
    },
    {
        "slug": "06-exports",
        "title": "6. Exports — writing files for design tools",
        "members": [],
        "prefixes": ["src/groundmodel/infrastructure/exporters/"],
    },
]

# Slug/title for the catch-all group that holds every source file no reading-
# order group claimed. Bucketed by top-level package into one sub-index each.
REST_GROUP_SLUG: str = "07-everything-else"
REST_GROUP_TITLE: str = "7. Everything else — the rest of the codebase"
