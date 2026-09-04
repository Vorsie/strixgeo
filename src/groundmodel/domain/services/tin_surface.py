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
* One concave-hull tightness factor (``CONCAVE_HULL_ALPHA_FACTOR``,
  an alpha-shape) — no data-driven fitting (vs kriging's variogram fit
  or RBF's shape parameter). Deterministic and reproducible: the same
  contacts always yield the same surface.

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
import math
import struct
from collections.abc import Sequence

import numpy as np

from groundmodel.domain.services.tin_surface_constants import CONCAVE_HULL_ALPHA_FACTOR

# Value objects moved to domain/value_objects/ (one class per file,
# debt #42); re-exported here so existing
# ``from ...services.tin_surface import ContactPoint3D`` importers and
# this module's own functions resolve unchanged.
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.value_objects.section_line_2d import SectionLine2D
from groundmodel.domain.value_objects.slice_point import SlicePoint
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

__all__ = [
    "ContactPoint3D",
    "TinSurface",
    "SectionLine2D",
    "SlicePoint",
    "compute_tin",
    "checksum_contacts",
    "evaluate_tin_at",
    "nearest_vertex_elevation",
    "slice_tin",
]


def compute_tin(
    contacts: Sequence[ContactPoint3D],
    concave_hull_alpha_factor: float = CONCAVE_HULL_ALPHA_FACTOR,
) -> TinSurface:
    """Run Delaunay triangulation on a formation's contact points.

    SciPy's Delaunay triangulates the *full convex hull* of the input
    points, which on sparse / elongated borehole layouts produces large
    boundary triangles that drape the surface across regions with no
    borehole control (the "drooping edges" artifact). A concave-hull
    (alpha-shape) trim drops any triangle whose circumscribed-circle
    radius exceeds ``alpha = concave_hull_alpha_factor * median_edge``,
    so the surface hugs the borehole footprint and simply does not exist
    where the data cannot constrain it.

    Parameters
    ----------
    contacts : Sequence[ContactPoint3D]
        Source contacts. Inputs without a valid (x, y) pair (NaN or
        identical-to-another) are silently filtered — Delaunay's
        qhull backend rejects degenerate input with QhullError; we
        prefer "render nothing" over a 500.
    concave_hull_alpha_factor : float, default ``CONCAVE_HULL_ALPHA_FACTOR``
        Alpha-shape tightness. A triangle is dropped when its
        circumradius exceeds this multiple of the median edge length.
        Lower → tighter concave hull (less droop, can fragment a very
        sparse formation); higher → looser, toward the convex hull
        (more droop kept). The trim never removes the *entire* surface —
        if every triangle would be cut (degenerate spread), all are kept
        and a warning is logged, so a poorly-controlled formation
        degrades to a droopy surface rather than vanishing.

    Returns
    -------
    TinSurface
        ``vertices`` matches the input order of valid points (vertices
        orphaned by the alpha-shape trim are retained — consistent with
        the degenerate-input paths); ``triangles`` is empty when fewer
        than 3 non-collinear points remain.

    Notes
    -----
    Performance: ~0.1 ms for ≤ 50 contacts on a typical laptop;
    Delaunay is O(n log n) and the vectorised trim is O(triangles).
    The recompute hook calls this on every contact mutation, so the
    cost has to stay sub-render-frame even for large formations.
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

    # deferred: keeps scipy off the boot path — only a real triangulation
    # needs it, and the API import (which registers routers) must not pay it.
    from scipy.spatial import Delaunay  # type: ignore[import-untyped]

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

    simplices = tri.simplices  # (M, 3) int — indexes the deduped points
    n_raw = int(simplices.shape[0])

    # Concave-hull (alpha-shape) trim. Geometry is measured in the
    # projected x-y plane (the same metric as borehole spacing); z is
    # irrelevant to "is this triangle spanning an uncontrolled gap".
    #
    # Criterion: drop a triangle when its circumscribed-circle RADIUS
    # exceeds alpha. This is the canonical Delaunay alpha-shape — unlike
    # a longest-edge test it also removes fat-but-large boundary
    # triangles and follows concavities in the borehole cloud, so the
    # surface actually hugs the data footprint instead of bridging gaps.
    # Near-collinear slivers have area -> 0 -> R -> inf, so they are
    # always cut (the worst droop). alpha auto-scales per formation off
    # the median edge so a sparse formation is not judged against a
    # dense one's spacing.
    tri_xy = points[simplices]  # (M, 3, 2)
    edge_lengths = np.linalg.norm(
        tri_xy - tri_xy[:, [1, 2, 0], :], axis=2
    )  # (M, 3): edges (0-1), (1-2), (2-0)
    a, b, c = edge_lengths[:, 0], edge_lengths[:, 1], edge_lengths[:, 2]
    # Twice the signed area via the 2-D cross product of two edge vectors.
    e1 = tri_xy[:, 1, :] - tri_xy[:, 0, :]
    e2 = tri_xy[:, 2, :] - tri_xy[:, 0, :]
    area2 = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])  # (M,)
    # Circumradius R = (a*b*c) / (4*Area). area2 == 2*Area, so
    # R = (a*b*c) / (2*area2). Degenerate (area2 == 0) -> R = inf -> cut.
    with np.errstate(divide="ignore", invalid="ignore"):
        circumradius = np.where(area2 > 0.0, (a * b * c) / (2.0 * area2), np.inf)
    median_edge = float(np.median(edge_lengths))
    alpha = concave_hull_alpha_factor * median_edge
    keep_mask = circumradius <= alpha
    kept = simplices[keep_mask]

    n_trimmed = n_raw - int(kept.shape[0])
    if kept.shape[0] == 0:
        # Guard: never wipe a whole formation. A degenerate spread where
        # every triangle exceeds alpha should degrade to the (droopy)
        # full hull, visibly poor but present, not a vanished surface.
        logger.warning(
            f"compute_tin: alpha-shape trim would drop ALL {n_raw} "
            f"triangle(s) (median_edge={median_edge:.3g}, "
            f"factor={concave_hull_alpha_factor}); keeping the full hull "
            f"to avoid an empty surface"
        )
        kept = simplices
        n_trimmed = 0
    elif n_trimmed:
        logger.debug(
            f"compute_tin: alpha-shape trimmed {n_trimmed}/{n_raw} "
            f"boundary triangle(s) (circumradius > {concave_hull_alpha_factor} "
            f"x median {median_edge:.3g} = {alpha:.3g})"
        )

    triangles: list[tuple[int, int, int]] = [
        (int(t[0]), int(t[1]), int(t[2])) for t in kept.tolist()
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


def nearest_vertex_elevation(
    vertices: Sequence[tuple[float, float, float]], x: float, y: float
) -> float:
    """Return the elevation of the vertex nearest to ``(x, y)``.

    Shared off-footprint fallback for TIN sampling: when
    :func:`evaluate_tin_at` returns ``None`` (the query point is outside
    every triangle), callers degrade to the closest vertex's elevation so
    they always hand back a finite value. Distance is compared squared —
    no ``sqrt`` needed for the arg-min. Consumed by
    ``ModelDomain.top_at`` / ``deep_base_at`` and ``SurfaceBound.evaluate``
    (previously two hand-rolled copies).

    Parameters
    ----------
    vertices : Sequence[tuple[float, float, float]]
        TIN vertices as ``(x_m, y_m, elevation_m)``.
    x, y : float
        Query coordinates in the surface's CRS.

    Returns
    -------
    float
        Elevation of the closest vertex by Euclidean distance; ``0.0``
        when ``vertices`` is empty (callers that need a hard error guard
        for the empty case before calling).
    """
    best_dist = math.inf
    best_elev = 0.0
    for vx, vy, vz in vertices:
        d = (vx - x) ** 2 + (vy - y) ** 2
        if d < best_dist:
            best_dist = d
            best_elev = vz
    return best_elev


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
