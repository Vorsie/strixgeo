"""The pinch-out tolerance :mod:`pinch_terminations` measures region ends against.

Extracted from the module so the value lives beside its siblings rather than at the
top of the logic file (the project constants convention).

Pure constants module, no I/O, no framework imports.  It holds a value; it does not
act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

__all__ = [
    "FLAT_M",
]

FLAT_M = 0.01
"""A region end this thin or thinner is a pinch-out apex, in metres.

The measured lens apexes sit at 0.000 m, so this is a float-noise guard rather than a
tunable: raising it would start calling genuinely thin bands terminations.
"""
