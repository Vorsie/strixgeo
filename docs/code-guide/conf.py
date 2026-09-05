"""Sphinx configuration for the StrixGeo code guide.

The guide shows the real backend source, block by block, each block followed by
a plain-English explanation. It does NOT import ``groundmodel`` to build: every
code block is pulled in with ``literalinclude`` from the real file on disk, so
the HTML can be built on any machine without a database or the heavy scientific
stack. ``autodoc`` / ``viewcode`` are enabled (per the brief) but no page emits
an ``autodoc`` directive, so nothing is imported at build time.

Build with ``scripts/build-code-guide.ps1`` (which passes ``-W`` so any Sphinx
warning fails the build).
"""

from __future__ import annotations

# -- Project information -----------------------------------------------------

project = "StrixGeo Code Guide"
author = "StrixGeo"
copyright = "StrixGeo"  # noqa: A001 — Sphinx's documented config name

# -- General configuration ---------------------------------------------------

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",  # numpy-style docstrings (the project convention)
    "sphinx.ext.viewcode",
]

# sphinx-copybutton is a convenience (a "copy" button on every code block). It
# lives in the ``docs`` dependency group, but the build must not hard-fail if it
# is ever missing, so it is added only when importable — matching the brief's
# "sphinx_copybutton if available".
try:
    import sphinx_copybutton  # noqa: F401

    extensions.append("sphinx_copybutton")
except ImportError:  # pragma: no cover - depends on the environment
    pass

# The generated per-file pages and the hand-written indexes are all reStructured
# Text. Nothing else is a document source.
source_suffix = {".rst": "restructuredtext"}

# The generated pages, indexes and helper scripts must not be treated as
# document sources or trip the build.
exclude_patterns = [
    "_build",
    "Thumbs.db",
    ".DS_Store",
    "generate_pages.py",
    "check_pages.py",
    "code_guide_lib.py",
    "code_guide_config.py",
]

# Warnings this guide never wants promoted differently; ``-W`` (set on the
# command line) turns every remaining warning into an error.
nitpicky = False

# -- HTML output -------------------------------------------------------------

html_theme = "furo"
html_title = "StrixGeo Code Guide"
html_static_path = ["_static"]
html_css_files = ["custom.css"]

# Napoleon: read numpy-style docstrings (the project standard). These settings
# only matter if an ``autodoc`` directive is ever added; harmless otherwise.
napoleon_numpy_docstring = True
napoleon_google_docstring = False

# Pygments' tsx lexer chokes on a few JSX constructs; a block it cannot lex is
# rendered as plain text, which is fine for reading — never a reason to fail the
# -W build. (212 such blocks on the desktop pages, 2026-09-05.)
suppress_warnings = ["misc.highlighting_failure"]
