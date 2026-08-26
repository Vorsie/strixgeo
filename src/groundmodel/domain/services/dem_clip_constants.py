"""Constants for the DEM clip domain service.

These string identifiers are a **public contract** consumed by the API schema
(``GapIssueResponse.kind``) and by the frontend for issue display.  Changing
them is a breaking change equivalent to removing an API field — apply the
same backwards-compatibility rules as REST field names (deprecation cycle,
version bump if removed, never silently renamed).
"""

from __future__ import annotations

from typing import Final

# Emitted when a formation-surface vertex has a surveyed top that exceeds
# the DEM elevation at the same (x, y).  The vertex is clamped to the
# terrain; the issue records the overshoot for engineer review.
KIND_CONTACT_ABOVE_DEM: Final = "contact_above_dem"

# Emitted when a vertex lands on a DEM cell whose value is None (NoData) —
# either outside the coverage area or a water body returning its surface
# rather than the bed.  The vertex z is left unchanged because no reliable
# clamp target is available.
KIND_DEM_CELL_LOW_CONFIDENCE: Final = "dem_cell_low_confidence"

# How far the ground surface is carried PAST the outermost investigation, in
# metres.  The surface is a reference the user reads a vertical distance
# against (interpreted model top vs terrain); a mesh that stops exactly at the
# last borehole reads as a floating slab and gives the eye nothing to judge
# "this is the ground" by.  50 m is roughly one screen-width of context at the
# zoom a site of a few hundred metres is viewed at, and is negligible against
# the WCS per-tile span cap (25 km).
GROUND_SURFACE_MARGIN_M: Final = 50.0
