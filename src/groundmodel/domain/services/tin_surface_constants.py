"""Tuning constants for :mod:`groundmodel.domain.services.tin_surface`.

Kept in a dedicated module (project convention: module-level constants
live in a ``*_constants.py`` beside the code that uses them, never at the
top of a logic module) so the value is importable, discoverable, and
overridable by tests without reaching into the service.
"""

from __future__ import annotations

# Sliver-trim factor for the Delaunay convex-hull boundary.
#
# WHY: SciPy's Delaunay always triangulates the FULL convex hull of the
# input points. On sparse / elongated borehole layouts (e.g. a runway
# strip with a few off-axis holes) that produces large hull-spanning
# "sliver" triangles which linearly drape the surface across regions with
# zero borehole control and ramp it steeply at the rim — the "drooping
# edges" the user sees in the 3D viewer and which would otherwise flow
# into the DXF / Plaxis exports and the .gmproj bundle.
#
# A triangle is dropped when its LONGEST edge (measured in the projected
# x-y plane, the same metric as borehole spacing) exceeds this factor
# times the MEDIAN edge length across all triangles. Raising it trims
# less (more droop kept); lowering it trims more aggressively toward a
# concave-hull look.
#
# Tuning log:
#   4.0 (2026-05-18) — first pass; on an elongated airfield-strip
#                      layout the boundary still drooped at the strip
#                      ends (judged once Build was made to always
#                      recompute, so the earlier verdict had been on a
#                      stale cache).
#   2.5 (2026-05-18) — owner "still a bit droopy"; tighter, clips the
#                      long cross-strip boundary triangles harder while
#                      leaving graded interior interpolation intact.
#
# Caveat: this is an x-y-only test. A boundary triangle that is normal
# in plan but steeply dipping in Z (a compact steep drape) is NOT caught
# at ANY factor — if droop survives a low factor, the cure is a slope
# cap or the concave-hull (alpha-shape) variant in git history, not a
# smaller factor. The trim is fully deterministic — a fixed factor, no
# data-driven fitting.
SLIVER_MAX_EDGE_FACTOR = 2.5
