"""Shared geometry-test helpers for litho-3D mesh unit tests.

Pure functions only — no I/O, no DB, no logging.  Imported by the loft mesher
tests (``services/test_loft_mesher.py``) so each mesh/ray helper has a single
source of truth.
"""

from __future__ import annotations

from collections import Counter

from groundmodel.domain.services.litho_body_pick import BodyLayerPick


def make_pick(
    inv: str,
    x: float,
    y: float,
    body: str,
    top_d: float,
    base_d: float,
    surf: float = 0.0,
    fm: str = "f",
) -> BodyLayerPick:
    """Build a :class:`BodyLayerPick` from positional shorthand.

    Parameters
    ----------
    inv : str
        Investigation identifier.
    x : float
        Easting of the investigation, metres.
    y : float
        Northing of the investigation, metres.
    body : str
        Body identifier (``body_id``).
    top_d : float
        Top depth below surface, metres (positive down).
    base_d : float
        Base depth below surface, metres (positive down).
    surf : float, optional
        Surface elevation, metres above datum.  Defaults to ``0.0``.
    fm : str, optional
        Formation identifier (``formation_id``).  Defaults to ``"f"``.

    Returns
    -------
    BodyLayerPick
        Fully populated pick dataclass.
    """
    return BodyLayerPick(
        investigation_id=inv,
        x_m=x,
        y_m=y,
        surface_elev_m=surf,
        body_id=body,
        formation_id=fm,
        top_depth_m=top_d,
        base_depth_m=base_d,
    )


def is_closed_manifold(triangles: list[tuple[int, int, int]]) -> bool:
    """Return True iff every undirected edge is shared by exactly 2 triangles.

    A closed 2-manifold (watertight mesh) has no boundary edges — every edge
    appears in exactly two triangles.

    Parameters
    ----------
    triangles : list[tuple[int, int, int]]
        Triangle index triples.

    Returns
    -------
    bool
        ``True`` when the mesh is a closed 2-manifold; ``False`` otherwise or
        when *triangles* is empty.
    """
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[frozenset((u, v))] += 1
    return len(triangles) > 0 and all(ct == 2 for ct in ec.values())


def is_consistently_wound(triangles: list[tuple[int, int, int]]) -> bool:
    """Return True iff every directed edge appears exactly once.

    In a consistently-wound closed mesh every interior edge is traversed once
    in each direction (u→v and v→u across the two adjacent triangles), so the
    directed count for every ordered pair equals exactly 1.

    Use together with :func:`is_closed_manifold`; this check alone does not
    detect boundary (open) edges.

    Parameters
    ----------
    triangles : list[tuple[int, int, int]]
        Triangle index triples.

    Returns
    -------
    bool
        ``True`` when winding is consistent; ``False`` otherwise or when
        *triangles* is empty.
    """
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(u, v)] += 1
    return len(triangles) > 0 and all(ct == 1 for ct in ec.values())


def ray_hits(
    vertices: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
    p: tuple[float, float, float],
) -> int:
    """Count ray–triangle intersections from *p* (Möller–Trumbore).

    The ray direction is chosen to be generic (irrational components) so it is
    in general position relative to any well-formed test mesh — it almost never
    passes exactly through a shared edge or vertex, which would double-count
    and flip the inside/outside parity.

    Parameters
    ----------
    vertices : list[tuple[float, float, float]]
        Mesh vertex list; each element is ``(x, y, z)``.
    triangles : list[tuple[int, int, int]]
        Triangle index triples indexing into *vertices*.
    p : tuple[float, float, float]
        Ray origin ``(x, y, z)``.

    Returns
    -------
    int
        Number of forward intersections (``t > eps``).
    """
    ox, oy, oz = p
    # Generic (non-axis-aligned, incommensurate) ray direction so the ray almost
    # never passes exactly through a triangle shared-edge/vertex (which would
    # double-count and flip the inside/outside parity). General-position trick.
    d = (1.0, 0.4142135623730951, 0.7320508075688772)
    eps = 1e-9
    hits = 0
    for a, b, c in triangles:
        v0, v1, v2 = vertices[a], vertices[b], vertices[c]
        e1 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
        e2 = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
        h = (d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0])
        det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
        if -eps < det < eps:
            continue
        inv = 1.0 / det
        s = (ox - v0[0], oy - v0[1], oz - v0[2])
        u = inv * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2])
        if u < -eps or u > 1 + eps:
            continue
        q = (s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0])
        v = inv * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2])
        if v < -eps or u + v > 1 + eps:
            continue
        t = inv * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2])
        if t > eps:
            hits += 1
    return hits


def inside(
    vertices: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
    p: tuple[float, float, float],
) -> bool:
    """Return True iff point *p* is inside the closed mesh (odd crossing parity).

    Parameters
    ----------
    vertices : list[tuple[float, float, float]]
        Mesh vertex list.
    triangles : list[tuple[int, int, int]]
        Triangle index triples indexing into *vertices*.
    p : tuple[float, float, float]
        Query point ``(x, y, z)``.

    Returns
    -------
    bool
        ``True`` when *p* is inside the mesh.
    """
    return ray_hits(vertices, triangles, p) % 2 == 1
