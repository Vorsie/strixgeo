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
# times the MEDIAN edge length across all triangles. 4.0 is deliberately
# conservative: it removes only egregious hull slivers (> 4x typical
# spacing) and keeps virtually all genuinely interpolated area, so a
# graded mesh (denser here, sparser there) is not over-trimmed. Raising
# it trims less (more droop kept); lowering it trims more aggressively
# toward a concave-hull look. Owner-set 2026-05-18; first-pass value the
# engineer will eyeball and may retune. The trim is still fully
# deterministic — a fixed factor, no data-driven fitting.
SLIVER_MAX_EDGE_FACTOR = 4.0
