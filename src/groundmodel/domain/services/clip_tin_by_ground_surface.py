"""Crossing-line clip of a formation TIN against the ground surface.

Pure domain function.  No I/O, no DB, no framework dependencies.  The caller
samples the ground surface (DEM, adjusted by any manual bed-level overrides)
and passes the result here as a callable; this module only does geometry.

The rule (owner ruling 2026-09-06)
----------------------------------
The old ``clip_tin_to_dem`` (removed 2026-09-21, it had no production caller
once this shipped) clamped every vertex to ``min(z, ground_z)`` point
by point.  On a site where a canal was dredged out, the DEM over the water
carries the WATER surface, and clamping flattened a formation top to a plateau
at that surface instead of cutting it.  The owner's rule instead:

    "You need to see where a polygon crossed the mTAW model.  Take that line
    (or 2 or more points, that is a line) and give them as input to the TIN."

So: intersect the formation surface with the ground surface, take the crossing
polyline, feed its points into the TIN as new vertices, and drop the part of
the surface that lies ABOVE the ground.  Concretely:

* a formation surface **ends where it crosses** the ground surface;
* the **crossing line is part of the TIN** (its points are new vertices, each
  sitting exactly on the ground);
* **nothing above the ground remains**;
* a surface **entirely below** the ground (e.g. Merelbeke, well under the bed)
  is returned unchanged — never clamped, never flattened, never
  re-triangulated: byte-identical to the input.

Implementation
--------------
Each triangle is clipped independently against the scalar field
``f = surface_z - ground_z`` (keep the ``f <= 0`` half) using a single-plane
Sutherland-Hodgman clip in the triangle's own plane:

* all three vertices on/below ground → the triangle is kept verbatim;
* all three above → the triangle is dropped;
* mixed → the triangle is clipped to the sub-polygon where ``f <= 0``, with
  the crossing points inserted on the straddling edges, then fan-triangulated.

A triangle any of whose vertices lands on a ground NoData cell is kept verbatim
— there is no reliable cut target there, mirroring the low-confidence handling
of the old clamp.  When no triangle is dropped or clipped the ORIGINAL surface
object is returned so the below-ground case is guaranteed byte-identical.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Final

from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

# A vertex whose ``surface_z - ground_z`` is within this of zero counts as ON
# the ground (kept), not above it.  Small enough that a real overshoot is never
# mistaken for "on the ground", large enough to swallow float-accumulation noise
# in the crossing arithmetic.  Metres.
_CROSSING_TOLERANCE_M: Final = 1e-9

_Vertex = tuple[float, float, float]


def clip_tin_by_ground_surface(
    surface: TinSurface,
    ground_z: Callable[[float, float], float | None],
) -> TinSurface:
    """Cut a formation TIN along its crossing line with the ground surface.

    Parameters
    ----------
    surface : TinSurface
        The formation's surface from Delaunay triangulation.  Its vertices are
        ``(x_m, y_m, elevation_m)`` in the project CRS + the formation datum.
    ground_z : Callable[[float, float], float | None]
        Ground-surface sampler: accepts ``(x, y)`` in the project CRS and
        returns the ground elevation in metres, or ``None`` for a NoData cell
        (outside coverage or, before a manual bed override is drawn, a water
        body returning nothing).  Typically the DEM sampler wrapped with the
        project's bed-level overrides.

    Returns
    -------
    TinSurface
        The clipped surface.  When nothing is above the ground the **input
        object is returned unchanged** (byte-identical), so a below-ground
        formation like Merelbeke keeps its own top.  A surface entirely above
        the ground clips to an empty surface (no vertices, no triangles).

    Notes
    -----
    * Triangle interiors below ground are preserved exactly — only the
      straddling triangles are reshaped and the above-ground triangles removed.
    * The crossing points sit on the ground surface (``z == ground_z``); the
      difference ``f`` is interpolated linearly along each straddling edge,
      which is the piecewise-linear intersection at the TIN's own resolution.
    """
    if not surface.vertices:
        return surface

    # Vertices-only surface (fewer than 3 contacts, no triangulation): there is
    # no crossing LINE to insert, but "nothing above the ground remains" still
    # holds — drop the above-ground points, keep the rest. NoData vertices are
    # kept (no reliable cut).
    if not surface.triangles:
        return _clip_vertices_only(surface, ground_z)

    out_vertices: list[_Vertex] = []
    out_index: dict[tuple[float, float, float], int] = {}
    out_triangles: list[tuple[int, int, int]] = []
    changed = False

    def _add(v: _Vertex) -> int:
        # Deduplicate on a rounded key so a crossing point shared by two
        # adjacent triangles becomes one vertex; store the un-rounded value so a
        # kept original vertex is byte-identical.
        key = (round(v[0], 9), round(v[1], 9), round(v[2], 9))
        idx = out_index.get(key)
        if idx is None:
            idx = len(out_vertices)
            out_index[key] = idx
            out_vertices.append(v)
        return idx

    for ia, ib, ic in surface.triangles:
        tri = (surface.vertices[ia], surface.vertices[ib], surface.vertices[ic])
        g0 = ground_z(tri[0][0], tri[0][1])
        g1 = ground_z(tri[1][0], tri[1][1])
        g2 = ground_z(tri[2][0], tri[2][1])

        if g0 is None or g1 is None or g2 is None:
            # No reliable cut target on this triangle — keep it verbatim.
            _emit_triangle(tri, _add, out_triangles)
            continue

        diffs = [tri[0][2] - g0, tri[1][2] - g1, tri[2][2] - g2]
        n_above = sum(1 for d in diffs if d > _CROSSING_TOLERANCE_M)

        if n_above == 0:
            # Whole triangle on/below ground — keep verbatim.
            _emit_triangle(tri, _add, out_triangles)
            continue

        changed = True
        if n_above == 3:
            # Whole triangle above ground — drop it.
            continue

        # Straddling triangle: clip to the f <= 0 half and fan-triangulate.
        polygon = _clip_triangle_below_ground(tri, diffs)
        if len(polygon) < 3:
            continue
        indices = [_add(p) for p in polygon]
        for k in range(1, len(indices) - 1):
            out_triangles.append((indices[0], indices[k], indices[k + 1]))

    if not changed:
        # Every triangle survived untouched — return the original object so the
        # below-ground case is guaranteed byte-identical.
        return surface

    logger.debug(
        f"clip_tin_by_ground_surface: {len(surface.triangles)} triangle(s) in, "
        f"{len(out_triangles)} out, {len(out_vertices)} vertices"
    )
    return TinSurface(vertices=out_vertices, triangles=out_triangles)


def _clip_vertices_only(
    surface: TinSurface,
    ground_z: Callable[[float, float], float | None],
) -> TinSurface:
    """Drop above-ground vertices from a triangulation-less surface.

    NoData vertices (``ground_z`` is ``None``) are kept — no reliable cut.
    When every vertex survives the input object is returned unchanged.
    """
    kept: list[_Vertex] = []
    for v in surface.vertices:
        g = ground_z(v[0], v[1])
        if g is None or v[2] <= g + _CROSSING_TOLERANCE_M:
            kept.append(v)
    if len(kept) == len(surface.vertices):
        return surface
    return TinSurface(vertices=kept, triangles=[])


def _emit_triangle(
    tri: tuple[_Vertex, _Vertex, _Vertex],
    add: Callable[[_Vertex], int],
    out_triangles: list[tuple[int, int, int]],
) -> None:
    """Append a kept triangle to the output, deduplicating its vertices."""
    ia = add(tri[0])
    ib = add(tri[1])
    ic = add(tri[2])
    out_triangles.append((ia, ib, ic))


def _clip_triangle_below_ground(
    tri: tuple[_Vertex, _Vertex, _Vertex],
    diffs: list[float],
) -> list[_Vertex]:
    """Sutherland-Hodgman clip of one triangle to the ``f <= 0`` half-plane.

    Parameters
    ----------
    tri : tuple of three (x, y, z)
        The triangle's vertices.
    diffs : list[float]
        ``surface_z - ground_z`` at each vertex, same order as ``tri``.

    Returns
    -------
    list[(x, y, z)]
        The clipped polygon in order (3 or 4 vertices).  The crossing points
        carry the formation z interpolated along the straddling edge, which
        equals the ground z there — so they sit exactly on the ground surface.
    """
    polygon: list[_Vertex] = []
    for i in range(3):
        cur, cur_d = tri[i], diffs[i]
        nxt, nxt_d = tri[(i + 1) % 3], diffs[(i + 1) % 3]
        cur_in = cur_d <= _CROSSING_TOLERANCE_M
        nxt_in = nxt_d <= _CROSSING_TOLERANCE_M
        if cur_in:
            polygon.append(cur)
        if cur_in != nxt_in:
            # Crossing on edge cur -> nxt where f == 0.
            t = cur_d / (cur_d - nxt_d)
            polygon.append(
                (
                    cur[0] + t * (nxt[0] - cur[0]),
                    cur[1] + t * (nxt[1] - cur[1]),
                    cur[2] + t * (nxt[2] - cur[2]),
                )
            )
    return polygon
