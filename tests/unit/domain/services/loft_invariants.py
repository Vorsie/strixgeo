"""Geometry-invariant assert helpers + voxel oracle for the loft mesher.

Test-only module of plain functions (NOT pytest test cases).  Imported by
``test_loft_mesher.py`` to pin the three watertightness contracts the loft
builder must satisfy by construction (spec §6):

* :func:`assert_closed_manifold` — every undirected edge is shared by exactly
  two triangles (a closed 2-manifold), and every directed edge appears exactly
  once (consistent outward winding).
* :func:`assert_no_overlap_sampled` — no two DIFFERENT bodies occupy the same
  vertical interval at any sampled (x, y) (no interpenetration).
* :func:`assert_tiles_domain` — at every sampled (x, y) inside the domain the
  union of all meshes' vertical intervals equals the field's
  ``[deep_base_at, top_at]`` extent (the voxel oracle: the field is the
  reference; the meshes must reproduce it with no holes).

The shared primitive is :func:`vertical_ray_intervals`, which ray-casts a
vertical line through one mesh and returns the ``(base, top)`` intervals where
that mesh is solid.  It relies on the **closed-mesh even-crossing property**: a
vertical line through a closed manifold crosses its surface an even number of
times, and the crossings sorted by elevation pair up into solid intervals
(odd-even parity).  A mesh that is NOT closed breaks this assumption — which is
exactly why :func:`assert_closed_manifold` is checked first.

Pure geometry — no I/O, no logging.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence

# Overlap / tiling tolerance.  Interval comparisons looser than this are treated
# as coincident (touching faces of neighbouring bodies do not count as overlap,
# and a sub-tolerance gap does not count as a hole).
TOL: float = 1e-6


# ---------------------------------------------------------------------------
# Manifold / winding
# ---------------------------------------------------------------------------


def assert_closed_manifold(
    vertices: Sequence[tuple[float, float, float]],
    triangles: Sequence[tuple[int, int, int]],
) -> None:
    """Assert the mesh is a closed 2-manifold with consistent outward winding.

    Two checks:

    1. **Closed manifold** — every undirected edge ``{i, j}`` is shared by
       exactly two triangles.  A boundary (open) edge appears once; a
       non-manifold edge appears three or more times.
    2. **Consistent winding** — every DIRECTED edge ``(i, j)`` appears exactly
       once, i.e. each shared edge is traversed in OPPOSITE directions by its
       two triangles (the hallmark of a consistently-oriented closed surface).

    Parameters
    ----------
    vertices : Sequence[tuple[float, float, float]]
        Mesh vertices (unused beyond a non-empty guard; kept for a uniform
        helper signature).
    triangles : Sequence[tuple[int, int, int]]
        Triangle index triples.

    Raises
    ------
    AssertionError
        With a diagnostic naming the first offending edge and its multiplicity.
    """
    assert triangles, "mesh has no triangles"

    undirected: Counter[frozenset[int]] = Counter()
    directed: Counter[tuple[int, int]] = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            undirected[frozenset((u, v))] += 1
            directed[(u, v)] += 1

    for edge, count in undirected.items():
        if count != 2:
            i, j = tuple(edge)
            raise AssertionError(
                f"not a closed manifold: undirected edge {{{i}, {j}}} is shared "
                f"by {count} triangle(s), expected exactly 2"
            )

    for (u, v), count in directed.items():
        if count != 1:
            raise AssertionError(
                f"inconsistent winding: directed edge ({u} -> {v}) appears "
                f"{count} time(s), expected exactly 1 (its two triangles should "
                f"traverse the shared edge in opposite directions)"
            )


# ---------------------------------------------------------------------------
# Vertical ray casting
# ---------------------------------------------------------------------------


def _point_in_triangle_2d(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    cx: float,
    cy: float,
) -> bool:
    """Return True iff (px, py) lies inside triangle (a, b, c) in the xy-plane.

    Barycentric sign test; a point on an edge counts as inside (``>= -eps``) so
    a ray skimming a shared triangle edge is not silently dropped.  The caller
    deduplicates near-coincident crossings so an edge-grazing double count is
    collapsed before pairing.
    """
    # Degenerate (zero-area) footprint never contains a point.
    denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denom) < 1e-15:
        return False
    eps = 1e-12
    la = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
    lb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
    lc = 1.0 - la - lb
    return la >= -eps and lb >= -eps and lc >= -eps


def vertical_ray_intervals(
    vertices: Sequence[tuple[float, float, float]],
    triangles: Sequence[tuple[int, int, int]],
    x: float,
    y: float,
) -> list[tuple[float, float]]:
    """Return the solid ``(base, top)`` intervals of a mesh along the vertical
    line through ``(x, y)``.

    Casts a vertical ray (the +z line at ``(x, y)``), collects the z-elevation
    of every triangle whose 2-D footprint contains ``(x, y)``, deduplicates
    near-coincident crossings (an edge shared by two triangles is hit by both),
    sorts them, and pairs them odd-even into solid intervals.

    Even-odd assumption
    -------------------
    A closed manifold is crossed an EVEN number of times by any line in general
    position; consecutive crossings (sorted) bound alternating solid/void
    spans, so pairing ``(crossings[0], crossings[1])``,
    ``(crossings[2], crossings[3])``, … recovers the solid intervals.  This
    holds only for a CLOSED mesh — assert that first.

    Parameters
    ----------
    vertices : Sequence[tuple[float, float, float]]
        Mesh vertices ``(x, y, z)``.
    triangles : Sequence[tuple[int, int, int]]
        Triangle index triples.
    x, y : float
        Map-plane query coordinates.

    Returns
    -------
    list[tuple[float, float]]
        ``(base, top)`` intervals (base below top), ordered shallow → deep is
        NOT guaranteed; sort if order matters.  Empty when the ray misses the
        mesh footprint.
    """
    zs: list[float] = []
    for a, b, c in triangles:
        ax, ay, az = vertices[a]
        bx, by, bz = vertices[b]
        cx, cy, cz = vertices[c]
        if not _point_in_triangle_2d(x, y, ax, ay, bx, by, cx, cy):
            continue
        # Planar interpolation of z at (x, y) within the triangle.  Solve the
        # barycentric weights again (cheap) and blend the corner elevations.
        denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(denom) < 1e-15:
            continue  # vertical / zero-area triangle contributes no crossing
        la = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
        lb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
        lc = 1.0 - la - lb
        zs.append(la * az + lb * bz + lc * cz)

    if not zs:
        return []

    zs.sort()
    # Deduplicate crossings that coincide within tolerance: a shared horizontal
    # edge is hit by both its triangles, doubling the crossing count.  Collapsing
    # near-equal crossings restores the even-odd pairing.
    deduped: list[float] = [zs[0]]
    for z in zs[1:]:
        if abs(z - deduped[-1]) > TOL:
            deduped.append(z)

    # Even-odd pairing.  A closed manifold (the documented precondition) always
    # yields an even crossing count, so the ``len - 1`` stop never drops a real
    # interval.  An ODD count can only mean the mesh under test is not closed (or
    # the ray exactly grazed a vertex) — the trailing crossing is then dropped by
    # design, which surfaces as a tiling/overlap assertion failure downstream
    # rather than a silent wrong answer here.
    intervals: list[tuple[float, float]] = []
    for k in range(0, len(deduped) - 1, 2):
        base, top = deduped[k], deduped[k + 1]
        if top - base > TOL:
            intervals.append((base, top))
    return intervals


# ---------------------------------------------------------------------------
# No-overlap (pairwise, sampled)
# ---------------------------------------------------------------------------


def _intervals_overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Return the overlap length of two ``(base, top)`` intervals (0 if disjoint)."""
    lo = max(a[0], b[0])
    hi = min(a[1], b[1])
    return max(0.0, hi - lo)


def assert_no_overlap_sampled(
    meshes: Sequence[object],
    samples: Sequence[tuple[float, float]],
) -> None:
    """Assert no two DIFFERENT bodies' meshes interpenetrate at any sample.

    For each ``(x, y)`` sample, gather every mesh's vertical intervals and
    assert that intervals belonging to DIFFERENT bodies do not overlap by more
    than :data:`TOL`.

    Parameters
    ----------
    meshes : Sequence[object]
        Objects exposing ``body_id``, ``vertices``, ``triangles`` (e.g.
        :class:`LithoBodyMesh`).
    samples : Sequence[tuple[float, float]]
        Map-plane ``(x, y)`` query points.

    Raises
    ------
    AssertionError
        Naming the sample, the two bodies, and the overlap length.
    """
    for x, y in samples:
        per_body: list[tuple[str, tuple[float, float]]] = []
        for m in meshes:
            body_id = getattr(m, "body_id")
            for iv in vertical_ray_intervals(m.vertices, m.triangles, x, y):  # type: ignore[attr-defined]
                per_body.append((body_id, iv))
        for i in range(len(per_body)):
            for j in range(i + 1, len(per_body)):
                bid_i, iv_i = per_body[i]
                bid_j, iv_j = per_body[j]
                if bid_i == bid_j:
                    continue
                ov = _intervals_overlap(iv_i, iv_j)
                if ov > TOL:
                    raise AssertionError(
                        f"overlap at ({x:.3f}, {y:.3f}): body {bid_i!r} interval "
                        f"{iv_i} overlaps body {bid_j!r} interval {iv_j} by "
                        f"{ov:.6f} m (> {TOL})"
                    )


# ---------------------------------------------------------------------------
# Tiles the domain (voxel oracle)
# ---------------------------------------------------------------------------


def assert_tiles_domain(
    meshes: Sequence[object],
    field: object,
    samples: Sequence[tuple[float, float]],
    extent_tol: float = TOL,
) -> None:
    """Assert the meshes tile the field's extent at every in-domain sample.

    The field is the reference (the voxel oracle).  At each in-domain sample two
    properties are checked:

    1. **No interior hole (the watertightness property, ALWAYS strict to**
       :data:`TOL` **).**  The union of all meshes' vertical intervals must be a
       single CONTIGUOUS span — there may be no gap BETWEEN bodies.  This is the
       construction guarantee and never tolerates slack.
    2. **Extent agreement (within** ``extent_tol`` **).**  The union's
       ``[base, top]`` envelope must match the field's
       ``[deepest base, shallowest top]``.

    Why ``extent_tol`` is separate
    ------------------------------
    The mesh is a piecewise-linear interpolation of the field over the MESH
    triangulation, while the oracle evaluates the field directly.  The two
    agree EXACTLY only at shared nodes; between nodes, where the deep-base /
    band surfaces curve, the coarse mesh's linear span diverges from the field
    by an interpolation error bounded by the surface's curvature over the grid
    spacing — not a hole, just a sampling difference.  Tests on a FLAT-surface
    fixture pass the default :data:`TOL`; a curved-surface fixture passes a
    realistic ``extent_tol`` (≈ grid spacing × max slope).  The interior-hole
    check stays strict regardless, so a real tiling defect is never masked.

    Samples outside ``field.domain.polygon`` are skipped; a sample whose field
    stack is empty (degenerate interval) is also skipped.

    Parameters
    ----------
    meshes : Sequence[object]
        Objects exposing ``vertices`` / ``triangles``.
    field : object
        A ``LoftField`` exposing ``stack_at(x, y)`` and ``domain.contains``.
    samples : Sequence[tuple[float, float]]
        Map-plane ``(x, y)`` query points.
    extent_tol : float, default :data:`TOL`
        Tolerance for the union-vs-field ENVELOPE comparison (the interior-hole
        check ignores this and stays strict).

    Raises
    ------
    AssertionError
        Naming the sample and the discrepancy (missing coverage, interior hole,
        or envelope mismatch beyond ``extent_tol``).
    """
    domain = getattr(field, "domain")
    for x, y in samples:
        if not domain.contains(x, y):
            continue
        stack = field.stack_at(x, y)  # type: ignore[attr-defined]
        if not stack:
            continue
        field_top = max(e.top_elev for e in stack)
        field_base = min(e.base_elev for e in stack)

        union = _union_intervals(
            [iv for m in meshes for iv in vertical_ray_intervals(m.vertices, m.triangles, x, y)]  # type: ignore[attr-defined]
        )
        if not union:
            raise AssertionError(
                f"no mesh coverage at ({x:.3f}, {y:.3f}) but the field has a "
                f"stack spanning [{field_base:.3f}, {field_top:.3f}]"
            )
        union_top = max(top for _base, top in union)
        union_base = min(base for base, _top in union)

        # (1) No interior hole — ALWAYS strict.  The union must be one
        # contiguous span (sum of merged interval lengths == envelope length).
        merged_len = sum(top - base for base, top in union)
        if abs(merged_len - (union_top - union_base)) > TOL:
            raise AssertionError(
                f"interior hole at ({x:.3f}, {y:.3f}): union covers {merged_len:.6f} m "
                f"of the [{union_base:.3f}, {union_top:.3f}] span "
                f"({union_top - union_base:.6f} m) — there is a gap between bodies"
            )

        # (2) Envelope agreement — within extent_tol (interpolation slack).
        if abs(union_top - field_top) > extent_tol or abs(union_base - field_base) > extent_tol:
            raise AssertionError(
                f"extent mismatch at ({x:.3f}, {y:.3f}): meshes span "
                f"[{union_base:.3f}, {union_top:.3f}] but field spans "
                f"[{field_base:.3f}, {field_top:.3f}] (tol {extent_tol})"
            )


def _union_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Merge a list of ``(base, top)`` intervals into disjoint sorted spans.

    Touching intervals (gap ≤ :data:`TOL`) are merged so the band-to-band
    seams of a tiling do not register as holes.
    """
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged: list[tuple[float, float]] = [ordered[0]]
    for base, top in ordered[1:]:
        last_base, last_top = merged[-1]
        if base <= last_top + TOL:
            merged[-1] = (last_base, max(last_top, top))
        else:
            merged.append((base, top))
    return merged
