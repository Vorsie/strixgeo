"""Constants for synthetic pinch-out contacts.

Consumed by ``materialize_wedge_tips_for_formation.py`` (application
layer) per the CLAUDE.md convention: constants live in a
``*_constants.py`` file alongside the classes that use them.
"""

from __future__ import annotations

# ContactSource string for synthetic pinch-out contacts. Kept here
# alongside the use case rather than re-imported from contact_enums so
# the use case has a single well-named import.
PINCH_OUT_SOURCE: str = "pinch_out_extrapolation"

# Confidence level assigned to synthetic contacts. "low" because the tip
# position is model-derived, not measured — the engineer should verify it
# against actual site data before committing a design.
PINCH_OUT_CONFIDENCE: str = "low"
