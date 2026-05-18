"""Tuning constants for :mod:`groundmodel.domain.services.tin_surface`.

Kept in a dedicated module (project convention: module-level constants
live in a ``*_constants.py`` beside the code that uses them, never at the
top of a logic module) so the value is importable, discoverable, and
overridable by tests without reaching into the service.
"""

from __future__ import annotations

# Concave-hull (alpha-shape) tightness for the Delaunay boundary.
#
# This is THE boundary trim — the principled "interpolate only, do not
# extrapolate" implementation (owner directive 2026-05-18, after the
# sliver longest-edge filter and the 30-deg slope cap were both tried
# and removed: sliver stayed too convex, the slope cap punched holes in
# legitimately-tapering formation edges and conflated drape with real
# steep geology).
#
# WHY: SciPy's Delaunay always triangulates the FULL convex hull. Every
# triangle is mathematically interpolation (a barycentric blend of 3
# real picks), but the hull throws large triangles across regions with
# NO boreholes between them — interpolation in name, a guess across a
# data void in fact. That void-spanning is the "droop". The alpha-shape
# clips the triangulation to the data footprint: a triangle is dropped
# when its CIRCUMRADIUS exceeds
# ``alpha = CONCAVE_HULL_ALPHA_FACTOR * median_edge`` (x-y plane, the
# borehole-spacing metric). Circumradius is the canonical alpha-shape
# test — it cuts fat-but-large boundary triangles, follows concavities
# in the cloud, and near-collinear slivers (area->0 -> R->inf) are
# always cut. alpha auto-scales per formation off the median edge so a
# sparse formation is not judged against a dense one's spacing.
#
# This is NOT too limiting — it is what LeapFrog / gINT / GemPy do: the
# surface stops where the data stops, honestly, instead of inventing a
# drooping rim. Consequences the engineer must know: (a) each formation
# has its own borehole subset, so formations get slightly different
# lateral extents (ragged inter-formation edges = real, not a bug);
# (b) to extend a surface past the outer boreholes, ADD A PICK — you
# stay in control. A manual extent polygon (LeapFrog-style) is the
# future escape hatch if automatic clipping is ever too conservative.
#
# Sizing: a well-shaped interior triangle has circumradius ~0.55-0.9 x
# local spacing (equilateral = 1/sqrt3 ~ 0.58; right-isosceles =
# 1/sqrt2 ~ 0.71). LOWER -> tighter hull, less droop, but eventually
# punches interior holes / fragments a sparse cloud (the "cutting too
# much" failure). HIGHER -> looser, toward the convex hull (more droop
# kept). Deterministic — fixed factor, no data-driven fitting.
#
# Tuning log:
#   1.6 (2026-05-18) — first alpha-shape pass; never fairly evaluated
#                      (stale-cache bug; reverted).
#   2.5 (2026-05-18) — re-adopted as THE method; started GENEROUS on
#                      owner feedback "you're cutting too much / holes
#                      in the base formation". Holes resolved but a
#                      little droop remained here and there.
#   2.0 (2026-05-18) — one step tighter chasing residual "droop".
#   4.0 (2026-05-18) — owner reverted to loose. The residual droop
#                      turned out to be the SPLIT CUT-FACE bug
#                      (buildCapPrimitives, fixed separately), NOT the
#                      TIN footprint — so the tight clip was no longer
#                      needed. 4.0 keeps a generous footprint (close to
#                      the convex hull) while still cutting the gross
#                      data-void spans.
CONCAVE_HULL_ALPHA_FACTOR = 4.0
