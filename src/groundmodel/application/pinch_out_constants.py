"""Constants for the pinch-out extrapolation use case.

Placed next to ``extrapolate_pinch_out.py`` (application layer) per
the CLAUDE.md convention: constants live in a ``*_constants.py`` file
alongside the classes that use them.
"""

from __future__ import annotations

# Default perpendicular offset (metres) applied when creating the twin
# synthetic contact.
#
# WHY 1.0 m: the offset must be large enough to break Delaunay
# collinearity (so the tip actually forms a non-degenerate triangle
# in the 3D TIN, producing a real wedge rather than a degenerate
# vertex) but small enough to be geologically negligible — 1 m is
# well within normal CPT/borehole positioning uncertainty and will
# not visibly distort the formation surface at any project scale.
# The system-architect's rationale: the Delaunay algorithm in
# compute_tin collapses collinear/duplicate (x,y) points silently,
# so without the offset the tip contact and the section-line contact
# share the same (x,y) in the TIN and the wedge degenerates to a
# point. The offset is configurable per-invocation (``offset_m``
# request field) so engineers with special requirements can adjust.
DEFAULT_PINCH_OUT_OFFSET_M: float = 1.0

# ContactSource string for synthetic pinch-out contacts. Kept here
# alongside the use case rather than re-imported from contact_enums so
# the use case has a single well-named import.
PINCH_OUT_SOURCE: str = "pinch_out_extrapolation"

# Confidence level assigned to synthetic contacts. "low" because the tip
# position is model-derived, not measured — the engineer should verify it
# against actual site data before committing a design.
PINCH_OUT_CONFIDENCE: str = "low"
