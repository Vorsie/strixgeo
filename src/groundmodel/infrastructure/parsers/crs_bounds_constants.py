"""Constants for the CRS-bounds coordinate check.

See :mod:`groundmodel.infrastructure.parsers.crs_bounds` for the classifier
that uses them.
"""

from __future__ import annotations

# Tolerance, in metres, added on every side of a CRS's projected coverage box
# before a coordinate is called "outside". The owner asked that a point a few
# hundred metres past the boundary is not flagged (ruling 2026-09-05).
#
# 500 m is comfortably larger than survey/GPS uncertainty and the sub-metre
# noise of a datum transform, yet three orders of magnitude smaller than a
# country's extent (~250 km). A genuinely wrong position — a swapped X/Y, a
# foreign coordinate, a mislabelled CRS — is off by tens of kilometres, far
# past this margin, so the tolerance absorbs edge-of-country points without
# masking the mistakes the check exists to catch.
CRS_BOUNDS_MARGIN_M: float = 500.0

# How many points to sample along each edge of a CRS's WGS84 ``area_of_use``
# rectangle when projecting it into the CRS's own metric bounding box. The
# rectangle's edges are lines of constant latitude/longitude; a conic or
# transverse-Mercator projection bows them, so the true metric extreme sits
# mid-edge, not at a corner. Sampling only the four corners under-covers the
# real extent by ~1.7 km on Belgian Lambert 72's south edge — enough to flag a
# valid coastal point. 128 samples per edge drives that gap below the metre.
CRS_BOUNDS_SAMPLES_PER_EDGE: int = 128

# The single validation-issue code every parser raises for an out-of-area
# coordinate. Kept here so the GEF and the two DOV parsers emit the identical
# string.
COORDINATES_OUTSIDE_CRS_BOUNDS_CODE: str = "COORDINATES_OUTSIDE_CRS_BOUNDS"
