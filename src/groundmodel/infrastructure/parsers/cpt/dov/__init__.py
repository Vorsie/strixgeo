"""DOV (Databank Ondergrond Vlaanderen) CPT import — WFS client and XML parser.

The ``__init__.py`` here exists for two reasons:
* setuptools ``[tool.setuptools.packages.find]`` uses regular packages with explicit
  ``__init__.py`` files to discover what to ship in the wheel; PEP 420 namespace
  packages (no ``__init__.py``) work in Python 3.3+ but interact poorly with some
  build tools, mypy strict mode, and pytest's rootdir resolution.
* The docstring is the package's one-line description, surfaced by ``help()`` and
  IDE hover tooltips.

Other ``__init__.py`` files in this codebase follow the same pattern: a single
docstring, sometimes also re-exporting key types (see ``parsers/cpt/gef/__init__.py``).
"""
