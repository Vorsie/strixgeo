"""Constants the voxel labelling reads, kept out of the logic files that use them.

Two are tolerances the labelling REPORTS against: both answer "how small a
discrepancy is not a real one?" and are read outside the function that applies them,
the hairline limit by the application layer, which names it in the WARNING it raises.
The other two are the labeller's own knobs, the progress-tick budget and the
boundary-convention rule statement.  They live here rather than at the top of a class
file (see :mod:`voxel_types`, which reserves this module for exactly that).

Pure constants module, no I/O, no framework imports.  It holds values; it does not
act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.snap_grid_constants import SNAP_GRID_M

__all__ = [
    "CONTACT_GOES_TO_THE_BODY_ABOVE",
    "HAIRLINE_LIMIT_M",
    "PROGRESS_TICK_TARGET",
    "PROJECTION_TIE_EPS_M",
    "STACK_VOID_ACTIONABLE_M",
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

STACK_VOID_ACTIONABLE_M: float = 0.10
"""Smallest interior void the gapless gate reports as a broken guarantee.

The hairline limit above (15 mm) separates a snapped-flush contact from a real
gap for MEASUREMENT, but every gap over it — down to a couple of centimetres —
was being reported as a broken promise.  The owner's installer-#35 build flagged
"4 column stacks carry an interior void over 15 mm, worst 33.5 mm": a void a
third of the vertical voxel height, invisible on screen and below anything an
engineer could act on, reported as a guarantee failure with no action to take.

A void between the hairline limit and this threshold is real but sub-actionable:
it is carried in the report as a NOTE (the largest such residue is shown) and the
clause still PASSES.  A void at or above this threshold is a hole an engineer can
see and act on — a tenth of a metre is the coarsest reasonable "you can act on
this" floor and an order of magnitude above the snap noise — so the clause FAILS
and names it.  Owner directive 2026-09-13: report only what the engineer can act
on, and give every violation an action.

OWNER-CALIBRATION-PENDING like the reconciliation tolerance: 0.10 m is the
starting floor, to be re-set once more real builds are measured against it.
"""

#: Upper bound on the number of per-column progress ticks a single build emits.
#: The labelling loop reports once every ``max(1, nx // PROGRESS_TICK_TARGET)``
#: x-columns (rows) plus a final tick, so a tall grid does not flood the SSE
#: channel while a short one still ticks smoothly.  The cancel predicate, by
#: contrast, is checked EVERY row — it is a cheap ``Event.is_set`` and must stay
#: responsive.
PROGRESS_TICK_TARGET = 200

CONTACT_GOES_TO_THE_BODY_ABOVE = """A voxel exactly on a contact belongs to the SHALLOWER body.

One rule, two implementations (:func:`_column_labels` and
:func:`_column_labels_gapped`): each stack interval is half-open ``[base, top)``,
so where one entry's base equals the next entry's top the upper entry wins.  The
column's global base is closed (the deepest entry owns a voxel exactly on it) and
its global top is open (a voxel exactly on the surface is void) — a benign
measure-zero asymmetry on the grid, but the SAME asymmetry in both labellers, so
which one the caller passes never changes a voxel's answer.
"""
