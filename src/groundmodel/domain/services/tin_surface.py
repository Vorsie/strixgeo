"""TIN compute + slice services for the geological model.

Pure-geometry domain services that turn a formation's contacts into
an interpolated surface (Triangulated Irregular Network) and answer
"give me a polyline along this section line" queries against that
surface.

Why TIN
-------
Method-agnostic on purpose — the surface schema ships a ``method``
column (``"tin"`` for v1, room for ``"kriging"`` / ``"rbf"`` /
``"gempy"`` later). TIN is the v1 default because:

* Sub-millisecond compute on tens of points (Delaunay via SciPy's
  qhull binding) — supports the "drag a contact and see the surface
  refresh" interactive UX.
* Exact at the picks. The engineer's deliberate placement is
  preserved; no kriging-style smoothing turns a hand-picked top
  into "approximately" the same top.
* Geologically defensible — every export consumer (Plaxis,
  D-Stability, DXF, IFC) handles polylines / triangulated surfaces
  as first-class.
* No tunable parameters (vs kriging's variogram fit or RBF's
  shape parameter). Deterministic, reproducible, no surprises.

Surface representation
----------------------
``TinSurface`` is a value object:

* ``vertices`` — list of (x_m, y_m, elevation_m) tuples in the
  project's horizontal CRS + the formation's vertical datum.
* ``triangles`` — list of (i_a, i_b, i_c) tuples of vertex indices.
  Each triangle is one Delaunay cell.

Empty / degenerate inputs (≤ 2 contacts, all collinear, all stacked
at one (x, y)) return an empty TIN — the caller renders nothing
rather than crashing. Two contacts is the geological minimum for an
interpretation but not for a surface; the user has to add a third
non-collinear pick before interpolation produces anything.
"""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.spatial import Delaunay  # type: ignore[import-untyped]

from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


@dataclass(frozen=True)
class ContactPoint3D:
    """One source point for the TIN — a contact's (x, y, elevation_m).

    The TIN compute treats contact_id as opaque metadata so the
    cache-validity checksum can include it (and detect a "swap one
    contact for another at the same xyz" change, which would have
    the same triangulation but different downstream interpretation).
    """

    contact_id: str
    x_m: float
    y_m: float
    elevation_m: float


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


def compute_tin(contacts: Sequence[ContactPoint3D]) -> TinSurface:
    """Run Delaunay triangulation on a formation's contact points.

    Parameters
    ----------
    contacts : Sequence[ContactPoint3D]
        Source contacts. Inputs without a valid (x, y) pair (NaN or
        identical-to-another) are silently filtered — Delaunay's
        qhull backend rejects degenerate input with QhullError; we
        prefer "render nothing" over a 500.

    Returns
    -------
    TinSurface
        ``vertices`` matches the input order of valid points;
        ``triangles`` is empty when fewer than 3 non-collinear
        points remain.

    Notes
    -----
    Performance: ~0.1 ms for ≤ 50 contacts on a typical laptop;
    Delaunay is O(n log n). The recompute hook calls this on every
    contact mutation, so the cost has to stay sub-render-frame even
    for large formations.
    """
    n_in = len(contacts)
    logger.trace(f"compute_tin: {n_in} input contact(s)")
    if n_in == 0:
        return TinSurface(vertices=[], triangles=[])

    # Drop NaN / inf points — they'd crash qhull. Preserve the
    # remaining points' order so the cache checksum is stable.
    valid: list[ContactPoint3D] = []
    for c in contacts:
        if np.isfinite(c.x_m) and np.isfinite(c.y_m) and np.isfinite(c.elevation_m):
            valid.append(c)
    n_valid = len(valid)
    if n_valid != n_in:
        logger.debug(f"compute_tin: dropped {n_in - n_valid} non-finite contact(s)")

    vertices: list[tuple[float, float, float]] = [(c.x_m, c.y_m, c.elevation_m) for c in valid]
    if n_valid < 3:
        # Geological minimum for a surface is 3 non-collinear points.
        # Keep the vertices on the cache row so the section view can
        # still render the picks as dots; just no triangles.
        logger.debug(f"compute_tin: <3 valid contact(s) ({n_valid}), no triangulation")
        return TinSurface(vertices=vertices, triangles=[])

    # Reject duplicate (x, y) — qhull treats them as degenerate.
    # Two contacts at the same (x, y) but different z is geologically
    # nonsensical (one borehole = one surface elevation per formation)
    # and is already prevented by the per-(model, anchor, formation)
    # uniqueness rule, but defensive here anyway.
    points = np.array([[v[0], v[1]] for v in vertices], dtype=float)
    unique_xy, unique_idx = np.unique(points, axis=0, return_index=True)
    if len(unique_xy) < n_valid:
        logger.debug(f"compute_tin: {n_valid - len(unique_xy)} duplicate (x,y) point(s) collapsed")
        # Keep only the first occurrence of each (x, y) — preserves
        # input ordering inside the dedup'd subset.
        kept_idx = sorted(unique_idx.tolist())
        vertices = [vertices[i] for i in kept_idx]
        points = points[kept_idx]
    if len(points) < 3:
        return TinSurface(vertices=vertices, triangles=[])

    try:
        tri = Delaunay(points)
    except Exception as err:
        # All-collinear / near-collinear inputs raise QhullError. Treat
        # like "fewer than 3 points" — no triangulation, render dots.
        logger.warning(
            f"compute_tin: Delaunay failed ({type(err).__name__}: {err}); "
            f"returning vertices-only surface"
        )
        return TinSurface(vertices=vertices, triangles=[])

    triangles: list[tuple[int, int, int]] = [
        (int(t[0]), int(t[1]), int(t[2])) for t in tri.simplices.tolist()
    ]
    logger.trace(f"compute_tin: produced {len(vertices)} vertices, {len(triangles)} triangles")
    return TinSurface(vertices=vertices, triangles=triangles)


def checksum_contacts(contacts: Sequence[ContactPoint3D]) -> bytes:
    """Stable hash over the input contact set.

    Used by the recompute hook to skip work when the contacts
    haven't actually changed (e.g. a no-op PATCH that round-trips
    the same depth). Includes contact_id so swapping two contacts
    at identical xyz still triggers a recompute (downstream
    interpretation may differ even if the geometry doesn't).

    Returns
    -------
    bytes
        16-byte BLAKE2b digest. Cheap to compute, stable across
        process restarts, fits the LargeBinary cache column.
    """
    h = hashlib.blake2b(digest_size=16)
    # Sort by contact_id so the order of input contacts doesn't
    # affect the hash — the cache row's source set is order-
    # insensitive; only membership + xyz matter.
    for c in sorted(contacts, key=lambda x: x.contact_id):
        h.update(c.contact_id.encode("utf-8"))
        h.update(struct.pack("<ddd", c.x_m, c.y_m, c.elevation_m))
    return h.digest()


@dataclass(frozen=True)
class SectionLine2D:
    """Section endpoints in the project's horizontal CRS.

    Slice queries project the TIN onto this line and return a
    polyline of (along_distance_m, elevation_m) — one point per
    triangle edge crossing.
    """

    start_x: float
    start_y: float
    end_x: float
    end_y: float

    @property
    def length_m(self) -> float:
        """Horizontal length in metres."""
        return float(np.hypot(self.end_x - self.start_x, self.end_y - self.start_y))


@dataclass(frozen=True)
class SlicePoint:
    """One point on a section-slice polyline."""

    along_m: float
    elevation_m: float


def evaluate_tin_at(surface: TinSurface, x: float, y: float) -> float | None:
    """Interpolate the surface's elevation at a horizontal point.

    Walks the triangles, finds the one whose horizontal projection
    contains ``(x, y)``, and returns the barycentric-interpolated
    elevation. Returns ``None`` when the point sits outside every
    triangle (the surface doesn't cover that location) or when the
    surface has no triangles.

    Parameters
    ----------
    surface : TinSurface
    x, y : float
        Horizontal coordinates in the surface's CRS.

    Returns
    -------
    float | None
        Interpolated elevation at ``(x, y)``, or ``None`` when the
        point is outside the TIN's footprint.

    Notes
    -----
    Used by the cross-formation crossing validator to compare two
    surfaces' elevations at the same (x, y). Cost is O(triangles)
    per call — acceptable for v1 cardinality (<200 contacts per
    formation, <20 formations per project). When this becomes a
    bottleneck, swap for a pre-built KD-tree of triangle centroids
    or a triangle-walk via ``scipy.spatial.Delaunay.find_simplex``.
    """
    if not surface.triangles:
        return None
    for ia, ib, ic in surface.triangles:
        ax, ay, az = surface.vertices[ia]
        bx, by, bz = surface.vertices[ib]
        cx, cy, cz = surface.vertices[ic]
        # Barycentric coordinates relative to triangle (a, b, c).
        # Reference: any standard computational-geometry text — uses
        # the signed area ratios. Numerically stable for non-
        # degenerate triangles; degenerate ones are filtered upstream
        # by Delaunay.
        denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if denom == 0.0:
            continue
        w_a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
        w_b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
        w_c = 1.0 - w_a - w_b
        # Allow points exactly on an edge (weight == 0). Tolerance is
        # zero — Delaunay produces non-overlapping triangles, so any
        # point exactly on a shared edge will only match one triangle
        # within numerical noise; even if it matches both, both yield
        # the same interpolated z.
        if w_a >= 0.0 and w_b >= 0.0 and w_c >= 0.0:
            return w_a * az + w_b * bz + w_c * cz
    return None


def slice_tin(surface: TinSurface, line: SectionLine2D) -> list[SlicePoint]:
    """Cut the TIN with a vertical plane along ``line`` and return the polyline.

    Algorithm:

    1. Project each TIN vertex onto the line (signed along-distance +
       perpendicular offset).
    2. For every triangle, compute which of its three edges cross
       the section line (perpendicular-offset sign change).
    3. For each crossing edge, linearly interpolate the
       (along, elevation) of the crossing point.
    4. Sort all crossing points by ``along`` to form the polyline.

    Returns
    -------
    list[SlicePoint]
        Sorted shallowest-along to deepest-along. Empty when no
        triangle straddles the line OR the surface has no triangles.

    Notes
    -----
    * Off-line vertices contribute via their triangle's intersection
      with the line — exactly the property we want over the previous
      "connect picks projected onto line" render, where off-line
      picks were silently dropped.
    * Numerically the crossings may produce duplicate ``along``
      values when the line passes through a vertex; we keep the
      duplicates rather than dedup, since downstream consumers
      (DXF / Plaxis exporters) treat them as zero-length segments.
    """
    if not surface.triangles:
        logger.trace("slice_tin: surface has no triangles, empty polyline")
        return []

    # Direction unit vector + normal vector (perpendicular, +90°).
    dx = line.end_x - line.start_x
    dy = line.end_y - line.start_y
    length = float(np.hypot(dx, dy))
    if length == 0.0:
        logger.warning("slice_tin: zero-length section line, empty polyline")
        return []
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux  # left-perpendicular

    # Project every vertex once. ``along`` is signed distance along
    # the line; ``offset`` is signed perpendicular distance (positive
    # to the line's left).
    along: list[float] = []
    offset: list[float] = []
    for vx, vy, _vz in surface.vertices:
        rx = vx - line.start_x
        ry = vy - line.start_y
        along.append(rx * ux + ry * uy)
        offset.append(rx * nx + ry * ny)
    elev = [v[2] for v in surface.vertices]

    crossings: list[SlicePoint] = []
    for ia, ib, ic in surface.triangles:
        for i, j in ((ia, ib), (ib, ic), (ic, ia)):
            oi, oj = offset[i], offset[j]
            # Skip edges that don't cross the line. Sign-change check
            # handles "one above, one below"; ``== 0`` exactly means
            # the edge endpoint sits on the line — we sample those
            # endpoints separately to avoid a divide-by-zero.
            if oi == 0.0 and oj == 0.0:
                # Both endpoints on the line — degenerate edge,
                # caller's responsibility to render the triangle's
                # interior as a face. Skip.
                continue
            if oi * oj > 0.0:
                # Same side — no crossing.
                continue
            if oi == 0.0:
                crossings.append(SlicePoint(along[i], elev[i]))
                continue
            if oj == 0.0:
                crossings.append(SlicePoint(along[j], elev[j]))
                continue
            # Strict sign change: linearly interpolate to find the
            # crossing point's parametric position along edge i→j.
            t = oi / (oi - oj)  # in (0, 1)
            crossing_along = along[i] + t * (along[j] - along[i])
            crossing_elev = elev[i] + t * (elev[j] - elev[i])
            crossings.append(SlicePoint(crossing_along, crossing_elev))

    crossings.sort(key=lambda p: p.along_m)
    logger.trace(
        f"slice_tin: produced {len(crossings)} crossing(s) along {length:.1f}m section line"
    )
    return crossings
