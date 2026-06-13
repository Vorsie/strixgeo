"""Grid + smoothing constants for the Stage-4 isosurface extraction.

Each constant carries the WHY of its value.  Stage 4 samples the fitted
potential field on a regular 3D grid inside the model block and runs marching
cubes ONCE per interior horizon at that horizon's iso-value; these constants
govern the grid resolution policy and the optional cosmetic mesh smoothing.

The spec fixes the *interface* (``extract_isosurfaces(field, order,
grid_spacing_m, domain)``), not these numbers — ``grid_spacing_m`` is a caller
argument, so the only tunable here is the smoothing pass, which is purely
cosmetic and never changes which triangles exist.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Laplacian (umbrella-operator) smoothing
# ---------------------------------------------------------------------------

# Number of topology-preserving Laplacian smoothing passes applied to every
# extracted surface.  Each pass moves every vertex toward the average position
# of its edge-neighbours; it NEVER adds, removes, or re-indexes a triangle, so
# the surface's connectivity (and therefore its watertight-sharing role in
# Stage 5) is untouched.
#
# WHY a smoothing pass at all: marching cubes on a coarse grid produces a
# visibly faceted ("stair-stepped") surface where the grid cells cut the
# isosurface.  One umbrella pass relaxes those facets into a smoother sheet that
# reads as a geological contact rather than a voxel boundary — a cosmetic
# improvement the owner reviews at the real-data/wiring stage.
#
# WHY keep it SMALL (1): a single pass removes the worst faceting while barely
# moving the surface off the true iso-level (each vertex moves at most half the
# local edge length, and only tangentially on a smooth sheet).  More passes
# shrink/round the surface measurably (Laplacian smoothing is a diffusion — it
# pulls concave features inward), which would bias contact elevations.  Set to
# 0 to disable entirely (the extraction is fully correct without it; smoothing
# is presentation-only).
ISO_SURFACE_SMOOTH_ITERATIONS: int = 1
