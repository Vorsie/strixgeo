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
#   2.0 (2026-05-18) — owner "a bit tighter"; paired with the new
#                      MAX_DIP_DEG slope cap below (the x-y-only caveat
#                      is now covered by that, not by a smaller factor).
#
# This is an x-y-only test — it catches data-free spans, not steep
# compact drapes. The MAX_DIP_DEG slope cap below is its counterpart:
# the two compose (a triangle is dropped if EITHER fires). The trim is
# fully deterministic — a fixed factor, no data-driven fitting.
SLIVER_MAX_EDGE_FACTOR = 2.0

# Maximum geologically-plausible surface dip, in degrees. A triangle
# whose plane dips steeper than this (angle between its 3-D normal and
# the vertical) is dropped as interpolation drape, not real geology.
#
# WHY this is the real cure for "droop": the sliver test is x-y-only,
# so a boundary triangle that is normal in plan but plunges steeply in
# Z (a compact ramp down to one low / outlier control point) survives
# at ANY sliver factor. The slope cap targets exactly that.
#
# SCOPED to convex-hull-boundary triangles only (see compute_tin). A
# fully-interior steep triangle is bracketed by real picks on all
# sides — that is a genuine steep erosional contact (a Quaternary
# valley / buried channel incising the Paleogene, the Flemish-Valley
# case in Flanders), NOT drape, and is kept regardless of this cap.
# Residual caveat: an incision exactly at the project edge, with
# control on one side only, is indistinguishable from drape there and
# WILL be trimmed — inherent to any boundary trim; add a pick on the
# far side of the incision to constrain it.
#
# WHY 30 deg for Flanders (owner-set 2026-05-18, domain call): the
# Cenozoic formation tops here (Kortrijk / Boom / Diest / Quaternary
# cover) are near-flat-lying — regional dips ~1-2 deg, locally a few
# deg at most. 30 deg sits an order of magnitude above any genuine
# stratigraphic dip, so the cap can only ever remove interpolation
# artefacts, never a real contact. Retune per region if a steeply
# faulted / folded setting is ever modelled. Deterministic — fixed
# threshold, no fitting. Set to 90 (or higher) to disable the cap.
MAX_DIP_DEG = 30.0
