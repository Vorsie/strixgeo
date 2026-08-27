"""Relax the voxel mesher's staircase into a smooth surface (debt #220 prototype).

:func:`~groundmodel.domain.services.voxel_litho.extract_body_solids.extract_body_solids`
returns bodies whose boundary is made of axis-aligned voxel faces.  That is
faithful — every face sits exactly on the labelling — but a contact that dips
across the model is drawn as a staircase, and on a section the treads and risers
read as blockiness rather than geology.

This module is a POST-PROCESS on those meshes.  It changes no label, no
triangle, and no body identity: it moves vertices and nothing else.  Nothing in
the production build path calls it — it is reached only from the #220 prototype
driver — so the default model is bit-for-bit what it was.

Why a relaxation and not a re-extraction
----------------------------------------
The owner's #220 note asks for surfaces through the MIDPOINTS of the voxel faces
that separate two bodies.  Marching cubes computes those midpoints directly, but
it does so per body from a binary indicator, and where three or more bodies meet
at a voxel corner the per-body surfaces disagree — the model gaps and overlaps
at exactly the triple junctions a stratigraphic model is full of.  It also
discards the greedy merge, multiplying the triangle count of the on-click Build.

A relaxation keeps both properties for free.  The mesher already welds abutting
bodies by giving them COINCIDENT faces, so this module welds every body's
vertices into one global set of world POSITIONS, relaxes those positions once,
and writes the same result back to every body that touched each position.  A
contact therefore moves as one surface for both of its bodies: no crack can open
and neither body can cross the other.  Because the triangle lists are untouched,
each body is still the closed 2-manifold the mesher made it.

The relaxation is Taubin's ``lambda|mu`` pair rather than a plain Laplacian —
see :mod:`~groundmodel.domain.services.voxel_litho.smooth_body_solids_constants`
for why a plain Laplacian would shrink every body on every pass.  On top of it
sits the faithfulness bound: no vertex may end further than half a voxel from
where the mesher put it, on any axis.  Half a voxel is the quantisation error
being corrected, so the smoother can never claim more ground than the
voxelisation cost.

What it does NOT do, stated so the trade is visible: it does not know where the
true contact is, only that a staircase is not it.  A genuinely sharp feature —
a fault, a hard pinch-out edge — is relaxed along with the artefacts, bounded by
the same half-voxel budget.

Pure domain module — numpy only, no I/O, no logging.  It computes; it does not
act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from groundmodel.domain.services.voxel_litho.smooth_body_solids_constants import (
    DEFAULT_ITERATIONS,
    DISPLACEMENT_BUDGET,
    TAUBIN_LAMBDA,
    TAUBIN_MU,
)
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

__all__ = [
    "boundary_area_m2",
    "canonicalise_shared_diagonals",
    "signed_volume_m3",
    "smooth_body_solids",
]


def _rectangle_corners(
    points: list[tuple[float, float, float]],
) -> tuple[int, tuple[int, int]] | None:
    """Classify four positions as one axis-aligned rectangle, or reject them.

    Parameters
    ----------
    points : list of (float, float, float)
        Four candidate corner positions.

    Returns
    -------
    tuple or None
        ``(axis, free_axes)`` where ``axis`` is the constant axis of the plane
        the rectangle lies in; ``None`` when the four points are not the corners
        of one axis-aligned rectangle.
    """
    if len(points) != 4:
        return None
    columns = list(zip(*points))
    flat = [k for k in range(3) if len(set(columns[k])) == 1]
    if len(flat) != 1:
        return None
    axis = flat[0]
    first, second = (k for k in range(3) if k != axis)
    # A rectangle offers exactly two values on each free axis and every one of
    # the four combinations exactly once; a bent or degenerate quad does not.
    if len(set(columns[first])) != 2 or len(set(columns[second])) != 2:
        return None
    if len({(p[first], p[second]) for p in points}) != 4:
        return None
    return axis, (first, second)


def _traversal(triangle: tuple[int, int, int], u: int, v: int) -> tuple[int, int, int] | None:
    """Return ``(tail, head, opposite)`` for the way a triangle walks edge ``{u, v}``.

    Parameters
    ----------
    triangle : tuple of int
        The triangle's vertex indices, in winding order.
    u, v : int
        The two ends of the shared edge, in no particular order.

    Returns
    -------
    tuple of int or None
        The edge as the triangle traverses it plus its third vertex; ``None``
        when the triangle does not carry the edge at all.
    """
    a, b, c = triangle
    for tail, head, opposite in ((a, b, c), (b, c, a), (c, a, b)):
        if {tail, head} == {u, v}:
            return tail, head, opposite
    return None


def canonicalise_shared_diagonals(meshes: Sequence[LithoBodyMesh]) -> list[LithoBodyMesh]:
    """Make abutting bodies cut a shared voxel face along the SAME diagonal.

    The mesher emits a shared face into both of the bodies it separates and
    triangulates each copy from that body's own outward corner order, which runs
    the opposite way round on the two sides.  Both copies therefore split the
    square along the OPPOSITE diagonal.  While every corner is on the lattice the
    square is flat and the two splits describe the same surface, so nothing is
    wrong — but a smoother moves the corners, the square stops being flat, and
    the two bodies' surfaces part company: they gap along the contact and
    interpenetrate beside it, by up to a quarter of a voxel.

    This pass re-cuts every square along the diagonal whose lower-sorting corner
    position is smallest.  That choice is a property of the POSITIONS, not of the
    body, so both sides reach it independently and agree.  No vertex moves and no
    triangle is added or dropped: on an un-smoothed model the output is the same
    surface, cut differently.

    Only faces that pair cleanly are touched.  A triangle the mesher's pinch
    repair has already re-cut, or one whose partner has been claimed, is left
    exactly as it was — churning geometry the pass does not understand would
    trade a known defect for an unknown one.

    Parameters
    ----------
    meshes : Sequence[LithoBodyMesh]
        The mesher's per-body solids.  Intended for the un-merged extraction
        (``extract_body_solids(grid, greedy=False)``): a greedy-merged face can
        span several partners at once and has no single partner to agree with.

    Returns
    -------
    list of LithoBodyMesh
        One mesh per input body, in the input order, same vertices, re-cut
        triangles.
    """
    out: list[LithoBodyMesh] = []
    for mesh in meshes:
        verts = mesh.vertices
        edge_tris: dict[tuple[int, int], list[int]] = {}
        for index, (a, b, c) in enumerate(mesh.triangles):
            for u, v in ((a, b), (b, c), (c, a)):
                edge_tris.setdefault((u, v) if u < v else (v, u), []).append(index)

        claimed: set[int] = set()
        triangles = list(mesh.triangles)
        for (u, v), incident in edge_tris.items():
            if len(incident) != 2:
                continue
            first, second = incident
            if first in claimed or second in claimed:
                continue
            # The shared edge's DIRECTION as the first triangle traverses it is
            # what fixes the quad's orientation; the edge key is sorted by index
            # and cannot say which way round the square goes.  Reading it from
            # the sorted key instead re-cuts half the squares inside out.
            corner = _traversal(triangles[first], u, v)
            if corner is None:
                continue
            tail, head, p = corner
            q = next((w for w in triangles[second] if w not in (u, v)), None)
            if q is None or q == p:
                continue
            shape = _rectangle_corners([verts[u], verts[v], verts[p], verts[q]])
            if shape is None:
                continue
            _axis, free = shape
            # The shared edge is the square's DIAGONAL only when its two ends
            # differ on both free axes; when they differ on one it is a side, and
            # the two triangles belong to neighbouring squares, not to one.
            if any(verts[u][k] == verts[v][k] for k in free):
                continue
            claimed.update((first, second))
            # Of a rectangle's two diagonals, the one through the lowest-sorting
            # corner is the same diagonal whichever body is asking — which is the
            # entire point.
            if min(verts[u], verts[v]) <= min(verts[p], verts[q]):
                continue  # the mesher already chose it here
            # Quad boundary head -> p -> tail -> q -> head; re-cut along p--q.
            triangles[first] = (head, p, q)
            triangles[second] = (p, tail, q)

        out.append(
            LithoBodyMesh(
                body_id=mesh.body_id,
                formation_id=mesh.formation_id,
                vertices=mesh.vertices,
                triangles=triangles,
                is_flagged=mesh.is_flagged,
            )
        )
    return out


def signed_volume_m3(mesh: LithoBodyMesh) -> float:
    """Enclosed volume of a closed, outward-wound mesh, by the divergence theorem.

    Sums the signed volume of the tetrahedra spanned by the origin and each
    triangle: ``V = 1/6 * sum(a . (b x c))``.  Exact for any closed mesh
    regardless of shape, so it measures a voxel body's cell count and its
    smoothed counterpart on the same footing — which is what makes a volume
    delta between them a statement about the smoother rather than about the
    metric.

    Parameters
    ----------
    mesh : LithoBodyMesh
        A closed, outward-wound body mesh.  An empty mesh measures ``0.0``.

    Returns
    -------
    float
        Enclosed volume in cubic metres.  Positive for outward winding.
    """
    if not mesh.triangles:
        return 0.0
    verts = np.asarray(mesh.vertices, dtype=float)
    tris = np.asarray(mesh.triangles, dtype=np.int64)
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def boundary_area_m2(mesh: LithoBodyMesh) -> float:
    """Total surface area of a mesh's triangles, in square metres.

    A staircase covers strictly more surface than the ramp between its own two
    ends, so this is the direct measure of how much of the blockiness is left.

    Parameters
    ----------
    mesh : LithoBodyMesh
        Any triangle mesh.  An empty mesh measures ``0.0``.

    Returns
    -------
    float
        Summed triangle area in square metres.
    """
    if not mesh.triangles:
        return 0.0
    verts = np.asarray(mesh.vertices, dtype=float)
    tris = np.asarray(mesh.triangles, dtype=np.int64)
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    return float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() / 2.0)


def _weld_positions(
    meshes: Sequence[LithoBodyMesh],
) -> tuple[np.ndarray, np.ndarray, list[slice]]:
    """Fuse every body's vertices into one set of distinct world positions.

    Abutting bodies carry COINCIDENT faces — the mesher derives every vertex
    from the same shared corner-coordinate arrays, so two bodies meeting at a
    contact hold bit-identical float triples there.  Grouping on the exact
    triple therefore recovers the model's contact surfaces without a tolerance,
    and moving a group moves both of its bodies identically.

    Parameters
    ----------
    meshes : Sequence[LithoBodyMesh]
        The bodies to weld, in the order their slices are returned.

    Returns
    -------
    tuple
        ``(positions, node_of_vertex, spans)`` — the ``(M, 3)`` distinct
        positions, the ``(N,)`` map from stacked vertex index to position index,
        and one slice per body into that stacked index space.
    """
    spans: list[slice] = []
    start = 0
    blocks: list[np.ndarray] = []
    for mesh in meshes:
        block = np.asarray(mesh.vertices, dtype=float).reshape(-1, 3)
        blocks.append(block)
        spans.append(slice(start, start + len(block)))
        start += len(block)
    stacked = np.vstack(blocks) if blocks else np.zeros((0, 3), dtype=float)
    positions, node_of_vertex = np.unique(stacked, axis=0, return_inverse=True)
    return positions, node_of_vertex.ravel(), spans


def _neighbour_sums(edges: np.ndarray, counts: np.ndarray, positions: np.ndarray) -> np.ndarray:
    """Mean neighbour position of every node, or its own position when isolated.

    Parameters
    ----------
    edges : numpy.ndarray
        Shape ``(E, 2)`` distinct undirected edges as node-index pairs.
    counts : numpy.ndarray
        Shape ``(M,)`` valence of each node, pre-computed from ``edges``.
    positions : numpy.ndarray
        Shape ``(M, 3)`` current node positions.

    Returns
    -------
    numpy.ndarray
        Shape ``(M, 3)`` neighbour means.
    """
    totals = np.zeros_like(positions)
    np.add.at(totals, edges[:, 0], positions[edges[:, 1]])
    np.add.at(totals, edges[:, 1], positions[edges[:, 0]])
    safe = np.where(counts > 0, counts, 1)[:, None]
    return np.where(counts[:, None] > 0, totals / safe, positions)


def _distinct_edges(
    meshes: Sequence[LithoBodyMesh],
    node_of_vertex: np.ndarray,
    spans: Sequence[slice],
    n_nodes: int,
) -> np.ndarray:
    """Collect the distinct undirected edges of the whole model's boundary complex.

    The union across bodies is deliberate: at a contact both bodies contribute
    the same edges, and away from it each contributes its own, so a node on a
    contact is relaxed against every surface that actually meets there rather
    than against one body's private view of it.

    Parameters
    ----------
    meshes : Sequence[LithoBodyMesh]
        The bodies whose triangles supply the edges.
    node_of_vertex : numpy.ndarray
        Stacked-vertex-index to node-index map from :func:`_weld_positions`.
    spans : Sequence[slice]
        One slice per body into the stacked index space.
    n_nodes : int
        Number of distinct node positions, used to key an edge as one integer.

    Returns
    -------
    numpy.ndarray
        Shape ``(E, 2)`` distinct edges, each ``(low, high)`` node indices.
    """
    pairs: list[np.ndarray] = []
    for mesh, span in zip(meshes, spans):
        if not mesh.triangles:
            continue
        nodes = node_of_vertex[span][np.asarray(mesh.triangles, dtype=np.int64)]
        pairs.append(np.vstack((nodes[:, [0, 1]], nodes[:, [1, 2]], nodes[:, [2, 0]])))
    if not pairs:
        return np.zeros((0, 2), dtype=np.int64)
    raw = np.vstack(pairs)
    low = np.minimum(raw[:, 0], raw[:, 1])
    high = np.maximum(raw[:, 0], raw[:, 1])
    # One integer per edge beats a lexicographic unique over a two-column array:
    # the real model offers ~1.6 M edge instances per build and the flat key is
    # the difference between a sort on 3-tuples and a sort on scalars.
    keys = np.unique(low.astype(np.int64) * n_nodes + high.astype(np.int64))
    return np.stack((keys // n_nodes, keys % n_nodes), axis=1)


def _pin_mask(
    positions: np.ndarray,
    pin_columns: Sequence[tuple[float, float]] | None,
    pin_radius_m: float,
) -> np.ndarray:
    """Boolean mask of the nodes held exactly, by map-plane proximity to a column.

    Parameters
    ----------
    positions : numpy.ndarray
        Shape ``(M, 3)`` node positions.
    pin_columns : Sequence of (float, float) or None
        Map-plane ``(x, y)`` of each column whose ground is evidence rather than
        estimate.  ``None`` or empty pins nothing.
    pin_radius_m : float
        Radius around each column within which nodes are held.

    Returns
    -------
    numpy.ndarray
        Shape ``(M,)`` bool, ``True`` where the node must not move.
    """
    mask = np.zeros(len(positions), dtype=bool)
    if not pin_columns or pin_radius_m <= 0.0:
        return mask
    for px, py in pin_columns:
        dx = positions[:, 0] - px
        dy = positions[:, 1] - py
        mask |= (dx * dx + dy * dy) <= pin_radius_m * pin_radius_m
    return mask


def smooth_body_solids(
    meshes: Sequence[LithoBodyMesh],
    *,
    spacing_m: tuple[float, float, float],
    iterations: int = DEFAULT_ITERATIONS,
    lambda_step: float = TAUBIN_LAMBDA,
    mu_step: float = TAUBIN_MU,
    displacement_budget: float = DISPLACEMENT_BUDGET,
    pin_columns: Sequence[tuple[float, float]] | None = None,
    pin_radius_m: float = 0.0,
) -> list[LithoBodyMesh]:
    """Relax voxel bodies off their staircase, bounded by half a voxel per axis.

    Welds every body's vertices into one set of distinct world positions (so a
    contact is a single surface shared by its two bodies), runs ``iterations``
    Taubin ``lambda|mu`` passes over the resulting boundary complex, clamps each
    node's total displacement to ``displacement_budget`` of a voxel edge per
    axis, and writes the moved positions back into every body that touched them.

    Topology is untouched: the returned meshes carry the SAME triangle lists and
    the same vertex counts, so each body is still the closed 2-manifold the
    mesher produced and no two bodies can interpenetrate across a shared contact.

    Parameters
    ----------
    meshes : Sequence[LithoBodyMesh]
        The mesher's per-body solids.  Empty bodies pass through untouched.
    spacing_m : tuple of (float, float, float)
        Voxel edge lengths ``(x, y, z)`` in metres — the grid the bodies were
        extracted from.  The vertical is usually far finer than the horizontal,
        so the budget is applied per axis rather than as one scalar.
    iterations : int, default ``DEFAULT_ITERATIONS``
        Number of ``lambda|mu`` pairs.  ``0`` returns the input unchanged, which
        is the opt-out.
    lambda_step, mu_step : float
        The Taubin pair.  ``mu_step`` must be negative with ``|mu| > lambda`` or
        the filter shrinks each body on every pass.
    displacement_budget : float, default ``DISPLACEMENT_BUDGET``
        Fraction of a voxel edge a node may move, per axis.
    pin_columns : Sequence of (float, float) or None
        Map-plane positions whose ground is held exactly — an honoured
        investigation's own column, where the model was told the answer rather
        than estimating it.
    pin_radius_m : float, default ``0.0``
        Radius of that hold.  Zero pins nothing even when columns are supplied.
        A hold can only catch vertices that EXIST: the greedy merge collapses a
        flat stretch of surface into one rectangle, so a column sitting mid-face
        is pinned in name only.  Callers that depend on the hold must count the
        nodes it actually caught rather than assume the radius covered any.

    Returns
    -------
    list of LithoBodyMesh
        One mesh per input body, in the input order, with relaxed vertices.

    Raises
    ------
    ValueError
        If ``iterations`` is negative, or ``spacing_m`` carries a non-positive
        edge length (the budget would then be zero or inverted).
    """
    if iterations < 0:
        raise ValueError(f"iterations must be >= 0, got {iterations}")
    if len(spacing_m) != 3 or any(s <= 0.0 for s in spacing_m):
        raise ValueError(f"spacing_m must be three positive edge lengths, got {spacing_m}")
    if iterations == 0 or not meshes:
        return list(meshes)

    original, node_of_vertex, spans = _weld_positions(meshes)
    if not len(original):
        return list(meshes)

    edges = _distinct_edges(meshes, node_of_vertex, spans, len(original))
    counts = np.zeros(len(original), dtype=np.int64)
    np.add.at(counts, edges[:, 0], 1)
    np.add.at(counts, edges[:, 1], 1)

    # Relax in VOXEL units, not metres.  The production grid is 2 m across and
    # 0.25 m tall, so in metres a horizontal mesh edge outweighs a vertical one
    # eight to one and the neighbour average drags every vertex sideways: the
    # first real-model run saturated the horizontal budget at a full metre on
    # every axis-x/y vertex while the vertical barely moved, and small bodies
    # lost up to half their volume to the lateral pull.  Dividing by the voxel
    # edge makes one step in any direction cost the same, which is the space the
    # quantisation error lives in and therefore the space the correction belongs
    # in.  It also makes the displacement budget one uniform number.
    scale = np.asarray(spacing_m, dtype=float)
    start = original / scale
    positions = start.copy()
    for _ in range(iterations):
        positions += lambda_step * (_neighbour_sums(edges, counts, positions) - positions)
        positions += mu_step * (_neighbour_sums(edges, counts, positions) - positions)

    # The bound is on the TOTAL displacement, not on any single pass: what the
    # model promises is that no contact ended further than the quantisation error
    # from where the labelling put it, however it got there.
    # Added to the ORIGINAL metres rather than scaling the relaxed voxel-space
    # position back: a node that did not move must come back bit-identical, and
    # a divide-then-multiply round trip does not promise that.
    delta = np.clip(positions - start, -displacement_budget, displacement_budget)
    positions = original + delta * scale

    held = _pin_mask(original, pin_columns, pin_radius_m)
    if held.any():
        positions[held] = original[held]

    return [
        LithoBodyMesh(
            body_id=mesh.body_id,
            formation_id=mesh.formation_id,
            vertices=[
                (float(x), float(y), float(z)) for x, y, z in positions[node_of_vertex[span]]
            ],
            triangles=mesh.triangles,
            is_flagged=mesh.is_flagged,
        )
        for mesh, span in zip(meshes, spans)
    ]
