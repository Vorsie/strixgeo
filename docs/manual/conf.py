"""Sphinx configuration for the StrixGeo user manual.

The manual is a hand-written book for a geotechnical engineer using StrixGeo
for the first time. Unlike the code guide, it imports nothing from
``groundmodel`` and pulls in no source with ``literalinclude`` — every page is
prose, so the HTML builds on any machine with only Sphinx + furo installed.

Build with ``scripts/build-manual.ps1`` (which passes ``-W`` so any Sphinx
warning fails the build).
"""

from __future__ import annotations

# -- Project information -----------------------------------------------------

project = "StrixGeo User Manual"
author = "StrixGeo"
copyright = "StrixGeo"  # noqa: A001 — Sphinx's documented config name

# -- General configuration ---------------------------------------------------

# ``sphinx.ext.mathjax`` renders the ``.. math::`` blocks (the correlation
# equations in chapter 3) as MathJax in the browser. MathJax loads from a CDN
# at page-view time, so the BUILD itself never needs the network — the ``-W``
# gate passes fully offline.
extensions = [
    "sphinx.ext.mathjax",
]

# sphinx-copybutton is a convenience (a "copy" button on every code block). It
# lives in the ``docs`` dependency group, but the build must not hard-fail if it
# is ever missing, so it is added only when importable — matching the code
# guide's own pattern.
try:
    import sphinx_copybutton  # noqa: F401

    extensions.append("sphinx_copybutton")
except ImportError:  # pragma: no cover - depends on the environment
    pass

# Every page is reStructuredText.
source_suffix = {".rst": "restructuredtext"}

# The build output and OS cruft must not be treated as document sources.
exclude_patterns = [
    "_build",
    "Thumbs.db",
    ".DS_Store",
]

# ``-W`` (set on the command line) turns every remaining warning into an error.
nitpicky = False

# -- HTML output -------------------------------------------------------------

html_theme = "furo"
html_title = "StrixGeo User Manual"
