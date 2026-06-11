"""Label each investigation hole by the competitor body directly above/below the shared body.

This module extracts the per-hole labels that mark which competing body sits
immediately above or below a shared body at each investigation.  These labels are
the input to the facies-boundary subdivision step, which divides the shared body's
footprint triangulation at midpoint (2-way) / circumcenter (3-way Voronoi)
boundaries into a shared-vertex planar partition.  Pure: no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.litho_contact_surfaces import LayerSpan
from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D


def competitor_labels_above(body_id: str, columns: dict[str, list[LayerSpan]]) -> dict[str, str]:
    """Label each shared-body hole by the body directly ABOVE it there.

    Parameters
    ----------
    body_id : str
        The shared body whose footprint is being labelled.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first (largest ``top_elev`` first).

    Returns
    -------
    dict[str, str]
        ``inv_id -> upper_body_id`` for every hole where ``body_id`` has a body
        directly above it. Holes where it reaches the surface (nothing above) are
        omitted (no competitor there).

    Notes
    -----
    A body is assumed to occur at most once per investigation in the facies context.
    A body that appears both above and below a thin unit (same ``body_id`` bracketing
    a thin layer) is an enclosed-lens / matrix case handled by the lens path, not
    here.  If a body does occur more than once in a column the loop records each
    match in turn, so the **deepest** occurrence's upper neighbour is what survives
    in the output dict.
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i > 0:
                out[inv] = spans[i - 1].body_id
    return out


def competitor_labels_below(body_id: str, columns: dict[str, list[LayerSpan]]) -> dict[str, str]:
    """Label each shared-body hole by the body directly BELOW it there.

    Mirror of :func:`competitor_labels_above`; omits holes where the body is the
    deepest (nothing below).

    Parameters
    ----------
    body_id : str
        The shared body whose footprint is being labelled.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first (largest ``top_elev`` first).

    Returns
    -------
    dict[str, str]
        ``inv_id -> lower_body_id`` for every hole where ``body_id`` has a body
        directly below it. Holes where the shared body is the deepest span are
        omitted (no competitor there).

    Notes
    -----
    Same single-occurrence assumption as :func:`competitor_labels_above`: a body
    that brackets a thin unit (same ``body_id`` above and below) is an enclosed-lens
    / matrix case, not a facies case.  When a body does appear more than once, the
    deepest occurrence's lower neighbour survives in the output dict.
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i + 1 < len(spans):
                out[inv] = spans[i + 1].body_id
    return out


def circumcenter(
    a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]
) -> tuple[float, float]:
    """Return the triangle's circumcenter, clamped inside if it falls outside.

    The circumcenter is equidistant from all three vertices — the true Voronoi
    point — so the three perpendicular bisectors (each crossing its edge at the
    midpoint) meet there, consistent with the 2-way midpoint rule. For an obtuse
    triangle the circumcenter lies outside; we clamp it to the triangle via
    barycentric coordinates so the partition stays inside and non-overlapping.

    Parameters
    ----------
    a, b, c : tuple[float, float]
        Triangle vertices ``(x, y)``.

    Returns
    -------
    tuple[float, float]
        The (possibly clamped) junction point.
    """
    ax, ay = a
    bx, by = b
    cx, cy = c
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:  # degenerate / collinear -> centroid fallback
        # d = 4 × signed_area, so the threshold is ~signed_area < 2.5e-13 m²,
        # unreachable for real geotech coordinates (d is typically 1e3–1e10).
        return ((ax + bx + cx) / 3.0, (ay + by + cy) / 3.0)
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    l1 = ((by - cy) * (ux - cx) + (cx - bx) * (uy - cy)) / det
    l2 = ((cy - ay) * (ux - cx) + (ax - cx) * (uy - cy)) / det
    l3 = 1.0 - l1 - l2
    if min(l1, l2, l3) >= 0.0:
        return (ux, uy)
    l1, l2, l3 = (max(0.0, l1), max(0.0, l2), max(0.0, l3))
    s = l1 + l2 + l3
    l1, l2, l3 = l1 / s, l2 / s, l3 / s
    return (l1 * ax + l2 * bx + l3 * cx, l1 * ay + l2 * by + l3 * cy)


class _PartitionAccumulator:
    """Build the shared-vertex planar partition triangle by triangle.

    Owns the 2D vertex pool (holes first, then midpoints + junctions), dedupes
    edge midpoints by their undirected edge so adjacent triangles reference the
    SAME midpoint (walls coincide), and groups sub-triangles by competitor label.

    Parameters
    ----------
    hole_coords : list[tuple[float, float]]
        The footprint hole coordinates; become vertices ``0 .. len-1``.
    """

    def __init__(self, hole_coords: list[tuple[float, float]]) -> None:
        self.vertices: list[tuple[float, float]] = list(hole_coords)
        self._mid: dict[frozenset[int], int] = {}
        self.regions: dict[str, list[tuple[int, int, int]]] = {}

    def _add(self, p: tuple[float, float]) -> int:
        """Append a new vertex and return its index.

        Parameters
        ----------
        p : tuple[float, float]
            The ``(x, y)`` coordinate to append.

        Returns
        -------
        int
            Index of the newly added vertex in ``self.vertices``.
        """
        self.vertices.append(p)
        return len(self.vertices) - 1

    def _midpoint(self, i: int, j: int) -> int:
        """Return the index of the midpoint vertex between vertices ``i`` and ``j``.

        Deduplicates by undirected edge — if ``_midpoint(i, j)`` was already
        called (or ``_midpoint(j, i)``), the cached index is returned so that
        adjacent triangles share the exact same vertex object.

        Parameters
        ----------
        i, j : int
            Vertex indices into ``self.vertices``.

        Returns
        -------
        int
            Index of the midpoint vertex in ``self.vertices``.
        """
        key = frozenset((i, j))
        idx = self._mid.get(key)
        if idx is None:
            xi, yi = self.vertices[i]
            xj, yj = self.vertices[j]
            idx = self._add(((xi + xj) / 2.0, (yi + yj) / 2.0))
            self._mid[key] = idx
        return idx

    def _emit(self, label: str, tri: tuple[int, int, int]) -> None:
        """Append a sub-triangle to the region list for ``label``.

        Parameters
        ----------
        label : str
            The competitor body label this sub-triangle belongs to.
        tri : tuple[int, int, int]
            Vertex indices of the sub-triangle.
        """
        self.regions.setdefault(label, []).append(tri)

    def subdivide(self, tri: tuple[int, int, int], labels: tuple[str, str, str]) -> None:
        """Subdivide one footprint triangle by its three vertex labels.

        - **all-equal**: whole triangle emitted to that label.
        - **one-odd** (2 distinct labels): the odd vertex gets a single sub-triangle
          bounded by the midpoints of its two incident edges; the majority label
          gets the remaining two sub-triangles.
        - **all-distinct** (3 labels): three pairs of sub-triangles meeting at the
          circumcenter junction (Voronoi decomposition), one pair per label.

        Midpoints are cached by undirected edge so adjacent triangles that share
        an edge produce the identical midpoint vertex index, ensuring facies walls
        coincide when the full mesh is assembled.

        Parameters
        ----------
        tri : tuple[int, int, int]
            Vertex indices into ``self.vertices``.
        labels : tuple[str, str, str]
            Competitor label of each vertex, in the same order as ``tri``.
        """
        i, j, k = tri
        la, lb, lc = labels
        if la == lb == lc:
            self._emit(la, (i, j, k))
            return
        if len({la, lb, lc}) == 2:
            # Rotate so the odd vertex is always ``k`` (label ``lc``).
            # Original layout: (i=la, j=lb, k=lc). la==lb means lc is odd;
            # la==lc means lb is odd (swap j↔k); lb==lc means la is odd (rotate).
            if la == lc:  # b (j) is the odd vertex
                i, j, k, la, lb, lc = i, k, j, la, lc, lb
            elif lb == lc:  # a (i) is the odd vertex
                i, j, k, la, lb, lc = j, k, i, lb, lc, la
            # k is now the odd vertex with label lc; la == lb is the majority.
            m_ik = self._midpoint(i, k)
            m_jk = self._midpoint(j, k)
            self._emit(lc, (k, m_jk, m_ik))  # odd vertex's cell: one triangle
            self._emit(la, (i, j, m_jk))  # majority cell: two triangles
            self._emit(la, (i, m_jk, m_ik))
            return
        # Three distinct labels: compute edge midpoints first (they may be shared
        # with adjacent triangles), then add the circumcenter junction last so it
        # occupies the highest index in self.vertices at emit time.
        m_ij = self._midpoint(i, j)
        m_jk = self._midpoint(j, k)
        m_ki = self._midpoint(k, i)
        # Circumcenter junctions are NOT cached: each footprint triangle contributes
        # exactly one junction, so deduplication would never fire.  Only edge
        # midpoints need the cache because they are shared by adjacent triangles.
        j_idx = self._add(circumcenter(self.vertices[i], self.vertices[j], self.vertices[k]))
        self._emit(la, (i, m_ij, j_idx))  # vertex i Voronoi region (two tris)
        self._emit(la, (i, j_idx, m_ki))
        self._emit(lb, (j, m_jk, j_idx))  # vertex j Voronoi region (two tris)
        self._emit(lb, (j, j_idx, m_ij))
        self._emit(lc, (k, m_ki, j_idx))  # vertex k Voronoi region (two tris)
        self._emit(lc, (k, j_idx, m_jk))


@dataclass(frozen=True)
class FaciesPartition:
    """A planar partition of a shared body's footprint among its competitors.

    Parameters
    ----------
    vertices : list[tuple[float, float]]
        Shared 2D vertex pool (holes first, then midpoints + junctions).
    regions : dict[str, list[tuple[int, int, int]]]
        ``competitor_body_id -> plan triangles`` (indices into ``vertices``).
    hole_vertex : dict[str, int]
        ``inv_id -> vertex index`` for each **labelled** hole (those present in
        ``labels``).  Holes present in ``coords`` but absent from ``labels`` are
        not included — in production ``labels`` from
        :func:`competitor_labels_above` / :func:`competitor_labels_below` is a
        subset of ``coords``.
    """

    vertices: list[tuple[float, float]]
    regions: dict[str, list[tuple[int, int, int]]]
    hole_vertex: dict[str, int]


def partition_footprint(
    coords: dict[str, tuple[float, float]], labels: dict[str, str]
) -> FaciesPartition:
    """Partition the labelled footprint among competitors at midpoint/Voronoi lines.

    Triangulates the labelled holes (via :func:`compute_tin`), then subdivides each
    triangle by its vertices' labels into a shared-vertex partition.

    The vertex order returned by :func:`compute_tin` matches the input order of the
    supplied ``ContactPoint3D`` list (no deduplication fires because the footprint
    holes have distinct (x, y) coordinates).  This means triangle index ``a`` from
    ``tin.triangles`` directly indexes ``holes[a]``, so the label lookup is
    ``labels[holes[a]]`` without any coordinate remap.

    Parameters
    ----------
    coords : dict[str, tuple[float, float]]
        ``inv_id -> (x, y)`` for the shared body's footprint.
    labels : dict[str, str]
        ``inv_id -> competitor_body_id`` (from :func:`competitor_labels_above` or
        :func:`competitor_labels_below`).

    Returns
    -------
    FaciesPartition
        The partition; empty ``regions`` if fewer than 3 labelled holes.
    """
    # Sort for deterministic order; ContactPoint3D inputs are built in this
    # order so tin.vertices[i] corresponds to holes[i] (order preserved by
    # compute_tin when no duplicates are present — verified by live probe).
    holes = sorted(labels)
    if len(holes) < 3:
        return FaciesPartition([], {}, {})
    tin = compute_tin(
        [
            ContactPoint3D(
                contact_id=h,
                x_m=coords[h][0],
                y_m=coords[h][1],
                elevation_m=0.0,
            )
            for h in holes
        ]
    )
    # Defensive guard: compute_tin may have dropped or collapsed points (NaN,
    # duplicate (x,y), or all-collinear → QhullError caught internally).  When
    # that happens tin.vertices is shorter than `holes`, so the index assumption
    # ``tin.vertices[i] == holes[i]`` no longer holds.  A silently-wrong
    # partition is worse than an empty one, so bail out here.
    if len(tin.vertices) != len(holes):
        return FaciesPartition([], {}, {})

    hole_coords = [coords[h] for h in holes]
    acc = _PartitionAccumulator(hole_coords)
    for a, b, c in tin.triangles:
        acc.subdivide(
            (a, b, c),
            (labels[holes[a]], labels[holes[b]], labels[holes[c]]),
        )
    hole_vertex = {h: i for i, h in enumerate(holes)}
    return FaciesPartition(acc.vertices, acc.regions, hole_vertex)
