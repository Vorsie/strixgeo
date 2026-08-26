"""Tolerances the voxel labelling reports against.

Both values answer "how small a discrepancy is not a real one?", and both are
read outside the function that applies them — the hairline limit by the
application layer, which names it in the WARNING it raises — so they live here
rather than at the top of a class file (see :mod:`voxel_types`, which reserves
this module for exactly that).

Pure constants module — no I/O, no framework imports.  It holds values; it does
not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.snap_grid import SNAP_GRID_M

__all__ = [
    "HAIRLINE_LIMIT_M",
    "PROJECTION_TIE_EPS_M",
]

PROJECTION_TIE_EPS_M: float = SNAP_GRID_M
"""How close two gaps' distances must be before evidence, not fence order, decides.

Two consecutive gaps of one section reach a point off their SHARED column through
the very same foot, so their perpendicular distances are mathematically identical
and differ only by float noise (~1e-6 m over a 500 m model).  One snap cell is
therefore already generous: a contest this close means the two gaps reach the point
equally well, so preferring the drawn one over the blank one costs no accuracy.

Derived from the 2-D engine's snap grid rather than invented separately, so the
module has ONE answer to "closer than this is not a real difference".
"""

HAIRLINE_LIMIT_M: float = 0.015
"""Tallest interior gap in a final column stack that is still called a hairline.

The 2-D engine snaps polygon coordinates to a millimetre, so contacts the engineer
drew flush can come back a fraction of a cell apart; the worst such gap on the
owner's real geotech model is 0.999 mm — exactly one snap cell.  Fifteen
millimetres is an order of magnitude above that noise floor and an order of
magnitude below anything an engineer would draw on purpose, so a gap over it is a
new class of event rather than more rounding.

It is REPORTED, never enforced: the partition is allowed to say "unknown", and a
build must not refuse a model because the engineer left a hole on purpose.
"""
