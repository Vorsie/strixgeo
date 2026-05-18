"""Tuning constants for :mod:`groundmodel.domain.services.tin_surface`.

Kept in a dedicated module (project convention: module-level constants
live in a ``*_constants.py`` beside the code that uses them, never at the
top of a logic module) so the value is importable, discoverable, and
overridable by tests without reaching into the service.
"""

from __future__ import annotations

# Concave-hull (alpha-shape) tightness for the Delaunay boundary.
#
# WHY: SciPy's Delaunay always triangulates the FULL convex hull of the
# input points. On sparse / elongated borehole layouts (e.g. a runway
# strip with a few off-axis holes) that produces large boundary
# triangles which drape the surface across regions with zero borehole
# control and ramp it steeply at the rim — the "drooping edges" the user
# sees in the 3D viewer, which would otherwise flow into the DXF /
# Plaxis exports and the .gmproj bundle. The earlier longest-edge
# "sliver only" trim was too loose (it kept any triangle with one short
# anchoring edge, so the outline stayed nearly convex and still drooped).
#
# A triangle is dropped when its CIRCUMRADIUS exceeds
# ``alpha = CONCAVE_HULL_ALPHA_FACTOR * median_edge`` (edges measured in
# the projected x-y plane, the same metric as borehole spacing). The
# circumradius criterion is the canonical Delaunay alpha-shape: it cuts
# fat-but-large boundary triangles too and follows concavities in the
# point cloud, and near-collinear slivers (area -> 0 -> R -> inf) are
# always cut. alpha auto-scales per formation off the median edge so a
# sparse formation is not judged against a dense one's spacing.
#
# Sizing: a well-shaped interior triangle has circumradius ~0.55-0.9 x
# local spacing (equilateral = 1/sqrt3 ~ 0.58; right-isosceles =
# 1/sqrt2 ~ 0.71). 1.6 keeps all reasonable interior triangles while
# pulling the boundary in tight enough to remove the drape. LOWER ->
# tighter hull, less droop, but can punch interior holes / fragment a
# very irregular sparse cloud; HIGHER -> looser, toward the convex hull
# (more droop kept). Owner-directed switch from sliver-only 2026-05-18;
# first-pass value the engineer will eyeball and may retune. The trim is
# still fully deterministic — a fixed factor, no data-driven fitting.
CONCAVE_HULL_ALPHA_FACTOR = 1.6
