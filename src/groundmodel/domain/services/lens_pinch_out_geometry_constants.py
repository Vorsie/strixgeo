"""Constants for :mod:`groundmodel.domain.services.lens_pinch_out_geometry`.

Kept in a dedicated module (project convention: module-level constants
live in a ``*_constants.py`` beside the code that uses them, never at
the top of a logic module) so they are importable, discoverable, and
overridable in tests without monkey-patching the service module.
"""

from __future__ import annotations

# Minimum absolute Δalong between two pinching contacts for the
# dip computation to be considered non-degenerate.  Two contacts
# that are closer than this (in metres along the section line) are
# treated as a degenerate pair — effectively a single contact —
# and the single-contact fallback path is taken instead.
#
# WHY: floating-point division at Δalong → 0 produces enormous, unstable
# gradients.  Real contacts projected from the same anchor borehole in
# the same CPT column cannot be < 1 mm apart in along-section space
# unless the input has already been deduplicated incorrectly.
MIN_CONTACT_DELTA_ALONG_M: float = 1e-3  # 1 mm

# Minimum absolute gradient difference used to detect whether the
# extrapolated pinching surface and the target surface are diverging
# (rather than converging).  When |gradient_pinching - gradient_target|
# is below this value, the two lines are treated as parallel in the
# extrapolation zone; no intersection exists and
# ``LensPinchGeometryError`` is raised.
#
# WHY: at exactly zero difference the algebraic solver would divide by
# zero; at near-zero the intersection is numerically unstable and
# geologically meaningless (the lines meet at a theoretically infinite
# distance).
PARALLEL_GRADIENT_EPSILON: float = 1e-9

# Relative-density interpolation step (metres along-section) used when
# walking the target polyline to find where the extrapolated pinching
# surface crosses it.  Not actually used in the closed-form algebraic
# solver (which finds the exact crossing), but kept here as a named
# constant for any future numerical fallback path.
_WALK_STEP_M: float = 0.05  # 5 cm — sub-sample precision
