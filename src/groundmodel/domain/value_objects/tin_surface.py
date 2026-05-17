"""Value object: :class:`TinSurface`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TinSurface:
    """Interpolated surface as a triangulated mesh.

    ``vertices``: list of (x_m, y_m, elevation_m) tuples — same order
    as the input contacts (filtered to those with valid xyz).
    ``triangles``: list of (i, j, k) tuples — vertex indices,
    counter-clockwise.

    Empty-input contract: a TIN with fewer than 3 valid points has
    ``vertices = [...the points...]`` but ``triangles = []``. Slice
    queries against an empty TIN return an empty polyline.
    """

    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]
