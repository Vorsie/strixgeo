"""Constants for :mod:`groundmodel.application.create_litho_lens`.

Kept in a dedicated module (project convention: module-level constants
live in a ``*_constants.py`` beside the code that uses them, never at
the top of a logic module).
"""

from __future__ import annotations

# ContactSource string written on synthetic wedge-tip contacts created
# by the lens use case.  Matches the convention used by
# ``ExtrapolatePinchOut``.  Kept distinct so future tooling can
# distinguish geology-level pinch-outs from lens-scoped ones.
LENS_PINCH_OUT_SOURCE: str = "pinch_out_extrapolation"

# Confidence level for lens-synthetic contacts.  "low" because the tip
# position is section-local geometry derived from at most two adjacent
# contacts — the engineer should review before committing a design.
LENS_PINCH_OUT_CONFIDENCE: str = "low"

# Sentinel depth stored on lens-synthetic contacts to satisfy the
# NOT-NULL constraint on ``formation_contact.depth_top_m``.  The value
# has no physical meaning: the absolute tip elevation lives in
# ``synthetic_elevation_m``.  Mirrors ``ExtrapolatePinchOut``'s convention
# (_SYNTHETIC_DEPTH_SENTINEL = 0.0).
LENS_SYNTHETIC_DEPTH_SENTINEL: float = 0.0
