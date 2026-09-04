"""Model-domain geometry: alpha hull, deep-base surface, and ModelDomain.

This module provides the lateral and vertical bounds of the 3-D litho model
domain used by the voxel litho builder (``voxel_litho/``):

* ``alpha_hull_polygon`` — the concave footprint of the participating tests.
* ``deep_reaching_mask`` — which tests reach the deepest stratigraphic band
  (and therefore anchor the base surface of the model domain).
* ``ModelDomain`` — a value class that answers three spatial questions for
  any (x, y) coordinate:
  - ``contains`` — is this point inside the test footprint?
  - ``top_at``   — what is the ground-surface elevation?
  - ``deep_base_at`` — what is the base elevation of the model (interpolated
    through the DEEPEST-reaching tests only; shallow tests do not locally
    truncate the domain)?

``build_model_domain`` is called by
``voxel_litho.build_domain_from_sections`` to frame the voxel grid's
footprint and vertical extent.

Domain-layer purity
-------------------
Only scipy + numpy are used — both are already used by ``compute_tin``,
which lives in this same domain-services package.  No infrastructure or
application imports.  scipy is imported lazily inside ``alpha_hull_polygon``
(the one function that triangulates) so importing this module — which the API
does at boot to register routers — does not pull scipy onto the start-up path.
``ModelDomain`` is a plain class (computes, does not act) so it does not
inherit ``GroundModelLogger``.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from groundmodel.domain.services.tin_surface import (
    ContactPoint3D,
    compute_tin,
    evaluate_tin_at,
    nearest_vertex_elevation,
)
from groundmodel.domain.services.tin_surface_constants import (
    CONCAVE_HULL_ALPHA_FACTOR,
    MODEL_DOMAIN_COVERAGE_TOL_M,
)
from groundmodel.domain.value_objects.tin_surface import TinSurface

__all__ = [
    "DomainTest",
    "alpha_hull_polygon",
    "deep_reaching_mask",
    "ModelDomain",
    "build_model_domain",
]


# ---------------------------------------------------------------------------
# Value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DomainTest:
    """A geotechnical test that contributes to the model domain.

    Parameters
    ----------
    test_id : str
        Unique identifier (CPT permkey, borehole id, …).
    x_m : float
        Easting in the project's horizontal CRS (metres).
    y_m : float
        Northing in the project's horizontal CRS (metres).
    surface_elev_m : float
        Ground-surface elevation at this test location (metres, positive up).
        Typically DEM-sampled at ingest time.
    base_elev_m : float
        Elevation of the deepest measured point (metres, positive up, so
        usually negative).
    """

    test_id: str
    x_m: float
    y_m: float
    surface_elev_m: float
    base_elev_m: float


# ---------------------------------------------------------------------------
# Alpha hull
# ---------------------------------------------------------------------------


def alpha_hull_polygon(
    points: list[tuple[float, float]],
    factor: float = CONCAVE_HULL_ALPHA_FACTOR,
) -> list[tuple[float, float]]:
    """Return the alpha-shape (concave hull) boundary of a 2-D point cloud.

    Uses the same Delaunay-plus-circumradius criterion as ``compute_tin`` so
    that the two trims agree: a triangle is kept when its circumradius
    ``R ≤ factor * median_edge``.  The boundary ring is formed from edges
    that belong to exactly ONE kept triangle (the "outer shell"), then
    walked into a closed polygon.  When multiple disjoint loops result the
    largest by absolute signed area is returned.

    Parameters
    ----------
    points : list[tuple[float, float]]
        2-D (x, y) coordinates.  At least 3 non-collinear points are
        required; otherwise ``ValueError`` is raised.
    factor : float, default ``CONCAVE_HULL_ALPHA_FACTOR``
        Alpha-shape tightness — mirrors ``compute_tin``'s
        ``concave_hull_alpha_factor``.

    Returns
    -------
    list[tuple[float, float]]
        Closed ring of (x, y) vertices WITHOUT a repeated last point.

    Raises
    ------
    ValueError
        If fewer than 3 points are supplied, or if all points are collinear
        (Delaunay cannot triangulate them).
    """
    if len(points) < 3:
        raise ValueError(f"alpha_hull_polygon requires at least 3 points; got {len(points)}")

    pts = np.array(points, dtype=float)

    # deferred: keeps scipy off the boot path — only a real triangulation
    # needs it, and the API import (which registers routers) must not pay it.
    from scipy.spatial import Delaunay  # type: ignore[import-untyped]

    try:
        tri = Delaunay(pts)
    except Exception as err:
        # All-collinear / near-collinear inputs raise QhullError.
        raise ValueError(
            f"alpha_hull_polygon: Delaunay triangulation failed — points may be "
            f"collinear or degenerate ({type(err).__name__}: {err})"
        ) from err

    simplices = tri.simplices  # (M, 3) int

    # Compute circumradius for every triangle — identical math to compute_tin.
    tri_xy = pts[simplices]  # (M, 3, 2)
    edge_lengths = np.linalg.norm(tri_xy - tri_xy[:, [1, 2, 0], :], axis=2)  # (M, 3)
    a, b, c = edge_lengths[:, 0], edge_lengths[:, 1], edge_lengths[:, 2]
    e1 = tri_xy[:, 1, :] - tri_xy[:, 0, :]
    e2 = tri_xy[:, 2, :] - tri_xy[:, 0, :]
    area2 = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    with np.errstate(divide="ignore", invalid="ignore"):
        circumradius = np.where(area2 > 0.0, (a * b * c) / (2.0 * area2), np.inf)
    median_edge = float(np.median(edge_lengths))
    alpha = factor * median_edge
    keep_mask = circumradius <= alpha
    kept = simplices[keep_mask]

    if kept.shape[0] == 0:
        # Degenerate: keep full hull rather than returning an empty ring,
        # mirroring compute_tin's guard.
        kept = simplices

    # Collect boundary edges: an edge is on the boundary when it appears in
    # exactly ONE kept triangle.  Store edges as frozensets of vertex-index
    # pairs so the direction (i→j vs j→i) doesn't matter for counting, but
    # we preserve the directed version for the walk.
    edge_count: dict[frozenset[int], int] = defaultdict(int)
    edge_directed: dict[frozenset[int], tuple[int, int]] = {}
    for tri_row in kept.tolist():
        for i, j in ((tri_row[0], tri_row[1]), (tri_row[1], tri_row[2]), (tri_row[2], tri_row[0])):
            key = frozenset((i, j))
            edge_count[key] += 1
            edge_directed[key] = (i, j)

    boundary_edges = [edge_directed[k] for k, cnt in edge_count.items() if cnt == 1]

    if not boundary_edges:
        raise ValueError("alpha_hull_polygon: no boundary edges found after alpha-shape trim")

    # Walk the boundary edges into one or more closed rings.
    # Build an adjacency map: start → end for boundary edges.  The walk
    # assumes a MANIFOLD boundary — every vertex has exactly one outgoing
    # boundary edge.  An aggressive trim can violate this (two trimmed
    # components pinched at a shared vertex); overwriting silently would
    # drop a chain, so fail loudly instead.
    adj: dict[int, int] = {}
    for src, dst in boundary_edges:
        if src in adj:
            raise ValueError(
                f"alpha_hull_polygon: non-manifold boundary at vertex {src} "
                "(alpha trim pinched the hull); increase the alpha factor"
            )
        adj[src] = dst

    rings: list[list[tuple[float, float]]] = []
    unvisited = set(adj.keys())
    while unvisited:
        start = next(iter(unvisited))
        ring_indices: list[int] = [start]
        cur = adj[start]
        unvisited.discard(start)
        while cur != start and cur in unvisited:
            ring_indices.append(cur)
            unvisited.discard(cur)
            cur = adj.get(cur, start)
        ring_pts = [(float(pts[i, 0]), float(pts[i, 1])) for i in ring_indices]
        rings.append(ring_pts)

    # When multiple rings exist (e.g. a fragmented alpha-shape), return the
    # largest by absolute signed area so callers always get the main hull.
    def _signed_area(ring: list[tuple[float, float]]) -> float:
        n = len(ring)
        area = 0.0
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[(i + 1) % n]
            area += xi * yj - xj * yi
        return area / 2.0

    rings.sort(key=lambda r: abs(_signed_area(r)), reverse=True)
    return rings[0]


# ---------------------------------------------------------------------------
# Deep-reaching mask
# ---------------------------------------------------------------------------


def deep_reaching_mask(
    base_elevs: dict[str, float],
    lowest_band_elev_at: dict[str, float] | None,
    tol_m: float,
) -> dict[str, bool]:
    """Classify each test as deep-reaching or shallow.

    A test is "deep-reaching" when its base elevation reaches (at or below)
    the deepest geological band at that location, within a tolerance.

    Parameters
    ----------
    base_elevs : dict[str, float]
        Mapping ``test_id → base_elevation_m`` (positive-up; usually negative).
    lowest_band_elev_at : dict[str, float] | None
        Mapping ``test_id → elevation_m`` of the lowest geological band at
        each test location.  ``None`` triggers the no-geo fallback.
    tol_m : float
        Tolerance in metres.  A test reaches the band when
        ``base_elev <= lowest_band_elev + tol_m``.  With elevations
        negative-down this means the test's base is at or deeper than the
        band (shifted upward by the tolerance window).

    Returns
    -------
    dict[str, bool]
        ``True`` for every test that reaches deep, ``False`` for shallow.

    Notes
    -----
    The comparison is ``base_elev <= threshold`` where:

    * **Geo present**: ``threshold = lowest_band_elev_at[tid] + tol_m``
    * **No-geo fallback**: ``threshold = min(base_elevs.values()) + tol_m``

    Elevations are negative-down (e.g. -20 m is deeper than -8 m), so
    ``<=`` is the correct "at or deeper than" operator.
    """
    if lowest_band_elev_at is not None:
        # Geo present: each test has its own band reference elevation.
        return {tid: base <= lowest_band_elev_at[tid] + tol_m for tid, base in base_elevs.items()}
    else:
        # No-geo fallback: use the overall deepest base as the reference.
        threshold = min(base_elevs.values()) + tol_m
        return {tid: base <= threshold for tid, base in base_elevs.items()}


# ---------------------------------------------------------------------------
# ModelDomain
# ---------------------------------------------------------------------------


def ring_contains(ring: list[tuple[float, float]], x: float, y: float, tol: float = 0.0) -> bool:
    """Return True when (x, y) is inside *ring*, within an optional tolerance.

    Module-level so the coverage check in :func:`build_model_domain` can ask the
    question BEFORE a :class:`ModelDomain` exists — the alternative was building
    the object and patching ``uncovered_test_ids`` onto it afterwards, which
    made "a ModelDomain always knows its uncovered tests" true only for objects
    that one function built.  :meth:`ModelDomain.contains` delegates here, so
    there is one ray-cast in the codebase, not two.

    Parameters
    ----------
    ring : list[tuple[float, float]]
        Closed ring as (x, y) vertices, WITHOUT a repeated last vertex.
    x, y : float
        Horizontal query coordinates.
    tol : float, default 0.0
        Boundary inclusion tolerance in metres; see
        :meth:`ModelDomain.contains` for why it exists.

    Returns
    -------
    bool
    """
    n = len(ring)
    inside = False
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[(i + 1) % n]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
    if inside or tol <= 0.0:
        return inside
    # Strict parity says outside — but a cell centre within ``tol`` of any
    # boundary edge still overlaps the footprint, so include it.
    return distance_to_ring(ring, x, y) <= tol


def distance_to_ring(ring: list[tuple[float, float]], x: float, y: float) -> float:
    """Return the shortest distance from (x, y) to a closed ring's boundary.

    Minimum over every ring edge of the point-to-segment distance.

    Parameters
    ----------
    ring : list[tuple[float, float]]
        Closed ring as (x, y) vertices, WITHOUT a repeated last vertex.
    x, y : float
        Horizontal query coordinates.

    Returns
    -------
    float
        Shortest Euclidean distance to the closed ring (metres).
    """
    n = len(ring)
    best = math.inf
    for i in range(n):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq <= 0.0:
            # Degenerate (repeated) vertex — distance to the point itself.
            t = 0.0
        else:
            t = ((x - ax) * dx + (y - ay) * dy) / seg_len_sq
            t = max(0.0, min(1.0, t))  # clamp to the segment
        px, py = ax + t * dx, ay + t * dy
        dist = math.hypot(x - px, y - py)
        if dist < best:
            best = dist
    return best


class ModelDomain:
    """Spatial bounds of the loft: footprint + top + deep-base surfaces.

    Constructed by ``build_model_domain``; not instantiated directly.

    Attributes
    ----------
    polygon : list[tuple[float, float]]
        Alpha-hull ring (no repeated last vertex) of all tests' (x, y).
    uncovered_test_ids : tuple[str, ...]
        The ``test_id`` of every input test the returned footprint does NOT
        contain.  Non-empty means the alpha shape fragmented and only its
        largest ring survived, so those investigations get no model at all —
        the labeller's footprint gate runs before its honored-investigation
        check.  Callers MUST surface a non-empty value; a build that models
        half a project and reports success is the failure this list exists to
        prevent.

    Notes
    -----
    ``top_at`` and ``deep_base_at`` return the nearest-vertex elevation when
    the query point falls outside the TIN's footprint, so callers always
    receive a finite value rather than ``None``.  The top surface is built
    from ALL tests; the deep-base surface is built from DEEP-REACHING tests
    only — shallow tests do not locally truncate the model base.
    """

    def __init__(
        self,
        polygon: list[tuple[float, float]],
        top_surface_vertices: list[tuple[float, float, float]],
        top_surface_triangles: list[tuple[int, int, int]],
        base_surface_vertices: list[tuple[float, float, float]],
        base_surface_triangles: list[tuple[int, int, int]],
        uncovered_test_ids: tuple[str, ...] = (),
    ) -> None:
        """Initialise with pre-computed polygon and TIN surfaces.

        Parameters
        ----------
        polygon : list[tuple[float, float]]
            Alpha-hull ring.
        top_surface_vertices : list[tuple[float, float, float]]
            Ground-surface TIN vertices as ``(x_m, y_m, elevation_m)``.
        top_surface_triangles : list[tuple[int, int, int]]
            Ground-surface TIN triangle index triples.
        base_surface_vertices : list[tuple[float, float, float]]
            Deep-base TIN vertices as ``(x_m, y_m, elevation_m)``.
        base_surface_triangles : list[tuple[int, int, int]]
            Deep-base TIN triangle index triples.
        uncovered_test_ids : tuple[str, ...], optional
            Ids of input tests the ``polygon`` does not contain.  Defaults to
            ``()`` (a footprint that covers everything it was built from).
        """
        self.polygon = polygon
        self.uncovered_test_ids = uncovered_test_ids
        self._top = TinSurface(vertices=top_surface_vertices, triangles=top_surface_triangles)
        self._base = TinSurface(vertices=base_surface_vertices, triangles=base_surface_triangles)

    def contains(self, x: float, y: float, tol: float = 0.0) -> bool:
        """Return True when (x, y) is inside the alpha-hull polygon.

        Parameters
        ----------
        x, y : float
            Horizontal query coordinates.
        tol : float, default 0.0
            Boundary inclusion tolerance in metres. When > 0, a point that is
            strictly outside the ring but within ``tol`` of any boundary edge
            is treated as inside.

            Why: the voxel labeller gates each grid column on
            ``contains(cell_centre_x, cell_centre_y)``. Strict ray-casting
            parity is numerically unstable for cell centres that land exactly
            on (or a hair outside) a hull edge — roughly half of the
            on-boundary nodes flip to "outside" and get voided, even though the
            labeller produces a full body stack for them. That left the 2-D
            section fill discontinuous across hull-edge corridors. Passing
            ``tol ≈ half the cell diagonal`` makes a cell whose centre sits on
            or near the boundary count as inside, because the cell itself
            overlaps the data footprint.

        Returns
        -------
        bool
        """
        return ring_contains(self.polygon, x, y, tol)

    def _distance_to_boundary(self, x: float, y: float) -> float:
        """Return the shortest distance from (x, y) to the polygon boundary.

        Minimum over every ring edge of the point-to-segment distance. Used by
        ``contains`` to admit boundary-coincident grid nodes within a tolerance.

        Parameters
        ----------
        x, y : float
            Horizontal query coordinates.

        Returns
        -------
        float
            Shortest Euclidean distance to the closed ring (metres).
        """
        return distance_to_ring(self.polygon, x, y)

    def top_at(self, x: float, y: float) -> float:
        """Return the ground-surface elevation at (x, y).

        Uses TIN interpolation (``evaluate_tin_at``); falls back to the
        nearest vertex when the point is outside the TIN footprint.

        Parameters
        ----------
        x, y : float
            Horizontal query coordinates.

        Returns
        -------
        float
            Surface elevation in metres (positive up).
        """
        result = evaluate_tin_at(self._top, x, y)
        if result is None:
            return nearest_vertex_elevation(self._top.vertices, x, y)
        return result

    def deep_base_at(self, x: float, y: float) -> float:
        """Return the deep-base elevation at (x, y).

        The base TIN is built from deep-reaching tests ONLY (see
        ``build_model_domain``), so shallow tests do not locally truncate
        the model base.  Falls back to nearest vertex when outside the TIN.

        Parameters
        ----------
        x, y : float
            Horizontal query coordinates.

        Returns
        -------
        float
            Base elevation in metres (positive up; usually negative).
        """
        result = evaluate_tin_at(self._base, x, y)
        if result is None:
            return nearest_vertex_elevation(self._base.vertices, x, y)
        return result


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_model_domain(
    tests: list[DomainTest],
    lowest_band_elev_at: dict[str, float] | None = None,
    alpha_factor: float = CONCAVE_HULL_ALPHA_FACTOR,
    tol_m: float = 1.0,
) -> ModelDomain:
    """Build a ``ModelDomain`` from a list of geotechnical tests.

    Parameters
    ----------
    tests : list[DomainTest]
        The participating tests.  At least 3 non-collinear entries are
        required; fewer raises ``ValueError``.
    lowest_band_elev_at : dict[str, float] | None, optional
        Elevation of the lowest geological band at each test (keyed by
        ``test_id``).  Forwarded to ``deep_reaching_mask``; ``None``
        activates the no-geo fallback (deepest-overall threshold).
    alpha_factor : float, default ``CONCAVE_HULL_ALPHA_FACTOR``
        Tightness of the alpha-hull trim.
    tol_m : float, default 1.0
        Depth-reaching tolerance passed to ``deep_reaching_mask``.

    Returns
    -------
    ModelDomain

    Raises
    ------
    ValueError
        If fewer than 3 tests are supplied, if all test locations are
        collinear (Delaunay cannot triangulate them), or if no test reaches
        the lowest geological band within ``tol_m`` (the deep base would
        otherwise be silently built from shallow data).

    Notes
    -----
    With only 1–2 deep-reaching tests no base TIN can triangulate, so
    ``deep_base_at`` degrades to nearest-vertex extrapolation everywhere
    (a step function rather than an interpolated surface).  Acceptable for
    sparse projects; the loft still gets a finite base at every node.
    """
    if len(tests) < 3:
        raise ValueError(f"build_model_domain requires at least 3 tests; got {len(tests)}")

    # Alpha-hull polygon over all test (x, y) positions.
    # This raises ValueError for collinear/degenerate inputs.
    polygon = alpha_hull_polygon([(t.x_m, t.y_m) for t in tests], factor=alpha_factor)

    # Top surface: TIN through ALL tests' surface elevations.
    top_contacts = [
        ContactPoint3D(
            contact_id=t.test_id,
            x_m=t.x_m,
            y_m=t.y_m,
            elevation_m=t.surface_elev_m,
        )
        for t in tests
    ]
    top_tin = compute_tin(top_contacts, concave_hull_alpha_factor=alpha_factor)

    # Deep-base surface: TIN through DEEP-REACHING tests' base elevations.
    base_elevs = {t.test_id: t.base_elev_m for t in tests}
    reach_mask = deep_reaching_mask(
        base_elevs=base_elevs,
        lowest_band_elev_at=lowest_band_elev_at,
        tol_m=tol_m,
    )
    deep_tests = [t for t in tests if reach_mask.get(t.test_id, False)]

    # An empty deep set is only reachable with geo present (the no-geo
    # fallback threshold always admits the deepest test): the lowest band
    # lies deeper than every test reaches.  Silently substituting all tests
    # would build the deep base from shallow data and mask the mismatch —
    # fail loudly instead.
    if not deep_tests:
        raise ValueError(
            "no test reaches the lowest geological band within tolerance "
            f"(tol_m={tol_m}); check lowest_band_elev_at values or increase tol_m"
        )

    base_contacts = [
        ContactPoint3D(
            contact_id=t.test_id,
            x_m=t.x_m,
            y_m=t.y_m,
            elevation_m=t.base_elev_m,
        )
        for t in deep_tests
    ]
    base_tin = compute_tin(base_contacts, concave_hull_alpha_factor=alpha_factor)

    # Coverage check. ``alpha_hull_polygon`` keeps only the LARGEST ring, so an
    # alpha shape that fragments (two clusters further apart than ~alpha) drops
    # the smaller cluster's ring entirely — and the labeller's footprint gate
    # runs before its honored-investigation check, so those tests get no model
    # at all, not even their own logs. Record who was dropped so the caller can
    # say it out loud instead of reporting a complete-looking build.
    #
    # The millimetre tolerance is not cosmetic: every hull vertex IS an input
    # test sitting exactly ON the ring, and strict ray-cast parity reports about
    # half of those as "outside". The tolerance keeps this check about genuine
    # exclusion (hundreds of metres) rather than boundary-parity noise.
    uncovered_test_ids = tuple(
        t.test_id
        for t in tests
        if not ring_contains(polygon, t.x_m, t.y_m, MODEL_DOMAIN_COVERAGE_TOL_M)
    )
    return ModelDomain(
        polygon=polygon,
        top_surface_vertices=list(top_tin.vertices),
        top_surface_triangles=list(top_tin.triangles),
        base_surface_vertices=list(base_tin.vertices),
        base_surface_triangles=list(base_tin.triangles),
        uncovered_test_ids=uncovered_test_ids,
    )
