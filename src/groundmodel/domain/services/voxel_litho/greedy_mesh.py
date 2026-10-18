"""Greedy-mesh the per-direction voxel boundary faces to slash the triangle count.

Task 4's :func:`~groundmodel.domain.services.voxel_litho.extract_body_solids.extract_body_solids`
emits ONE quad (two triangles) per boundary voxel face — correct and watertight,
but heavy (real ``test.strix`` at 8 m: 30 bodies, ~25 k triangles; at 2 m,
~692 k).  This module collapses coplanar, same-body, same-direction boundary
faces into maximal axis-aligned rectangles (classic greedy meshing), so a flat
10x10-cell face that naively emitted 200 triangles emits far fewer.  The merge
moves NO surface — every merged rectangle is the exact union of the cell faces it
replaces — so watertightness and on-label fidelity are preserved.

The hard part — T-junctions
----------------------------
Merging coplanar boundary faces into maximal rectangles is the easy 90 %.  The
load-bearing difficulty is that on a concave / stepped body a merged face's long
edge abuts perpendicular wall faces whose corner vertices land in the MIDDLE of
that long edge.  A naive 2-triangle-per-rectangle emission then leaves that long
edge shared by 2 triangles while each perpendicular sub-segment is shared by only
1 → a **T-junction**, which
:func:`~tests.unit.domain.services.voxel_litho.strat_invariants.assert_closed_manifold`
rejects (it requires EXACTLY two triangles per undirected edge).  Synthetic clean
boxes never hit this; real blobby bodies hit it in their hundreds (the un-handled
naive merge left 1137 one-triangle edges on a single real ``test.strix`` body).

Strategy chosen: **subdivide-then-pinch-split (Strategy A — T-junction-free by
construction).**  Two ideas combine:

1. **Perimeter subdivision.**  Before triangulating, collect every lattice node
   that is a corner of ANY merged boundary rectangle (across all six face
   directions) into one set.  Emit each rectangle by walking its four edges and
   inserting a vertex at every such node that lies on the edge, then fan-
   triangulating the resulting subdivided polygon.  A perpendicular wall's corner
   on a merged edge is, by definition, a rectangle corner, so it is in the set and
   becomes a SHARED vertex → the merged edge is split into unit sub-edges that
   each pair with the wall's edge.  No T-junction can survive.  Every inserted
   node lies exactly on the original rectangle edge, so the surface does not move.

2. **Diagonal-pinch midpoint split.**  Perimeter subdivision removes every
   one-triangle (T-junction) edge but leaves the residual FOUR-triangle edges of a
   genuine 3-D self-touch (two boundary sheets of the same body meeting along a
   lattice edge — a diagonal voxel touch).  These are resolved by the SAME
   :func:`~groundmodel.domain.services.voxel_litho.extract_body_solids._split_pinched_edges_by_midpoint`
   Task 4 built for the per-cell path: each clean ``2-forward + 2-reverse`` edge is
   split at a coincident midpoint per dihedral pair.  (The greedy path uses ONLY
   the midpoint split, NOT the sheet-re-key pass 1 of ``_split_pinched_sheets`` —
   the re-key can perturb the already-correct subdivided topology and is
   unnecessary because subdivision leaves no odd-multiplicity edges.)

Validated on real ``test.strix``: both bodies that broke the naive merge become
closed 2-manifolds with byte-identical ``vertical_ray_intervals`` to the
un-merged mesh.

Known minor limit — sliver triangles
-------------------------------------
The fan apex of :func:`triangulate_subdivided_rect` is a corner that lies ON its
two (now subdivided) incident edges, so the fan emits some zero-area (collinear)
triangles along those edges.  They are geometrically inert — they move no
surface, ray-casting ignores them, and they keep the mesh a closed 2-manifold (a
correct watertight solid) — but they inflate the triangle count modestly (~13 %
of the merged triangles on the two real ``test.strix`` bodies measured) and are
load-bearing (each carries a unit boundary sub-edge that pairs with a neighbour,
so they cannot simply be filtered).  Eliminating them needs a degenerate-free
convex re-triangulation that adds NO interior Steiner vertices (interior cuts
re-introduce T-junctions with the perpendicular faces — verified empirically), so
it is deferred as a quality refinement, not a correctness fix.

Pure domain module — numpy + a Numba-JIT'd hot kernel
(:func:`_maximal_rectangles_kernel`, compiled lazily by
:func:`_maximal_rectangles_compiled` so Numba stays off the API boot path), no
I/O, no logging, no framework imports.  The functions compute; they do not act,
so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Callable

__all__ = ["maximal_rectangles", "subdivision_nodes", "triangulate_subdivided_rect"]


def _maximal_rectangles_kernel(mask: np.ndarray) -> np.ndarray:  # pragma: no cover - njit kernel
    """Native greedy maximal-rectangle cover — returns an ``(N, 4)`` int64 array.

    Identical raster-scan greedy semantics to the scalar reference (pinned
    byte-identical by ``test_greedy_mesh``), compiled to native code with Numba
    (see :func:`_maximal_rectangles_compiled`) because this is the voxel build's
    dominant hotspot — mesh extraction was 93.6 % ``maximal_rectangles`` (measured
    38.6x faster than the pure-numpy version over the real ``test.strix``
    workload, 0 rectangle mismatches over 113,796 masks).  ``cache=True`` on the
    compiled dispatcher persists the kernel so only the first call of a session
    pays the ~0.6 s JIT warm-up.

    The public :func:`maximal_rectangles` wraps this: it supplies a contiguous
    ``bool`` array and converts the ``(N, 4)`` result to the list-of-tuples the
    mesher consumes.  Rectangles are ``(u0, v0, u1, v1)`` half-open ranges in
    raster-scan order.
    """
    nu, nv = mask.shape
    remaining = mask.copy()
    # Upper bound on rectangle count (each covers >= 1 True cell) for the output
    # array — Numba nopython mode needs a preallocated array, not a growable list.
    cap = 0
    for u in range(nu):
        for v in range(nv):
            if remaining[u, v]:
                cap += 1
    out = np.empty((cap if cap > 0 else 1, 4), np.int64)
    count = 0
    for u0 in range(nu):
        any_row = False
        for v in range(nv):
            if remaining[u0, v]:
                any_row = True
                break
        if not any_row:
            continue  # whole row already consumed / empty
        v0 = 0
        while v0 < nv:
            if not remaining[u0, v0]:
                v0 += 1
                continue
            # Grow RIGHT along the anchor row while True.
            v1 = v0
            while v1 < nv and remaining[u0, v1]:
                v1 += 1
            # Grow DOWN while every cell of the next row over [v0, v1) is True.
            u1 = u0 + 1
            cont = True
            while u1 < nu and cont:
                for vv in range(v0, v1):
                    if not remaining[u1, vv]:
                        cont = False
                        break
                if cont:
                    u1 += 1
            out[count, 0] = u0
            out[count, 1] = v0
            out[count, 2] = u1
            out[count, 3] = v1
            count += 1
            for uu in range(u0, u1):
                for vv in range(v0, v1):
                    remaining[uu, vv] = False
            v0 = v1
    return out[:count]


@functools.lru_cache(maxsize=1)
def _maximal_rectangles_compiled() -> Callable[[np.ndarray], np.ndarray]:
    """Numba-compile :func:`_maximal_rectangles_kernel` on first use, cached.

    deferred: keeps numba/llvmlite off the boot path.  Importing this module —
    which the API does at boot to register the routers — must NOT import Numba:
    its llvmlite/LLVM load is a large slice of the packaged cold-start budget
    (+119 MB of shared libraries scanned off disk on first touch), and boot never
    meshes anything.  The first voxel Build pays the Numba import plus the ~0.6 s
    JIT warm-up; boot pays nothing.  ``cache=True`` persists the compiled kernel
    across sessions exactly as the old module-level ``@njit`` decorator did, so
    the mesh output stays byte-identical to the pre-deferral build.

    Returns
    -------
    Callable[[numpy.ndarray], numpy.ndarray]
        The compiled Numba dispatcher for the greedy raster-scan kernel.
    """
    from numba import njit  # deferred: keeps numba/llvmlite off the boot path

    return njit(cache=True)(_maximal_rectangles_kernel)


def maximal_rectangles(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Cover the ``True`` cells of a 2-D boolean mask with maximal axis-aligned rectangles.

    Greedy meshing's core primitive.  Repeatedly grows the largest rectangle
    anchored at the first (raster-scan) uncovered ``True`` cell: extend it as far
    right as the row of ``True`` cells allows, then extend it downward as long as
    every cell of the next row over that column span is also ``True`` and
    uncovered.  Mark the rectangle's cells covered and repeat until no ``True``
    cell remains.  The returned rectangles exactly partition the ``True`` cells
    (no overlap, full coverage).

    This is greedy (each step takes the maximal rectangle at the current anchor),
    not provably minimum, but it collapses a full ``n x m`` mask to a SINGLE
    rectangle and an L-shape to two — which is all the per-plane boundary-face
    sets need.

    Parameters
    ----------
    mask : numpy.ndarray
        Shape ``(nu, nv)`` boolean array; ``True`` where a face is present.

    Returns
    -------
    list of (int, int, int, int)
        Rectangles as ``(u0, v0, u1, v1)`` half-open cell ranges: the rectangle
        covers cells ``u in [u0, u1)`` and ``v in [v0, v1)``.  Empty list for an
        all-``False`` mask.  Raster-scan deterministic order.
    """
    # The greedy raster-scan runs in the Numba-JIT'd kernel (the build's dominant
    # hotspot — 38.6x faster than the pure-numpy version on the real workload,
    # byte-identical rectangles), compiled lazily on first use by
    # ``_maximal_rectangles_compiled`` so Numba stays off the API boot path.
    # Supply a CONTIGUOUS ``bool`` array (the mesher passes strided 2-D slices of
    # the 3-D boundary mask) and convert the ``(N, 4)`` result to the
    # list-of-tuples the callers consume.
    contiguous = np.ascontiguousarray(mask, dtype=np.bool_)
    rects = _maximal_rectangles_compiled()(contiguous)
    return [(int(r[0]), int(r[1]), int(r[2]), int(r[3])) for r in rects]


def subdivision_nodes(
    faces: list[tuple[tuple[int, int, int], ...]],
) -> set[tuple[int, int, int]]:
    """Collect every lattice node that is a corner of any merged boundary rectangle.

    These are the perimeter-subdivision points (Strategy A): a node that is a
    corner of one rectangle but lands in the INTERIOR of another rectangle's edge
    is exactly a T-junction site.  Inserting a vertex there on the long edge makes
    it a shared, paired vertex.  Because the set is the union over ALL six face
    directions, a perpendicular wall's corner touching a coplanar cap's merged
    edge is included, which is the case that breaks the naive merge.

    Parameters
    ----------
    faces : list of tuple of (int, int, int)
        The merged boundary rectangles, four lattice nodes each (outward-CCW).

    Returns
    -------
    set of (int, int, int)
        Every distinct corner lattice node across all rectangles.
    """
    nodes: set[tuple[int, int, int]] = set()
    for face in faces:
        nodes.update(face)
    return nodes


def triangulate_subdivided_rect(
    face: tuple[tuple[int, int, int], ...],
    subdiv: set[tuple[int, int, int]],
) -> list[tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]]:
    """Fan-triangulate a merged rectangle, splitting each edge at every subdivision node on it.

    Walks the rectangle's four edges (in the given outward-CCW order) and builds the
    ordered perimeter node list: each edge's tail corner, plus every node of
    ``subdiv`` that lies strictly between the edge's endpoints (in lattice steps).
    The convex rectangle polygon is then fan-triangulated from the first perimeter
    node — all triangles outward-wound (the fan of a convex CCW polygon preserves
    the winding).  Every inserted node is collinear on the edge, so the emitted
    triangles cover exactly the rectangle (no surface moves) and every unit
    sub-edge appears as a triangle edge that pairs with the perpendicular wall.

    Sliver triangles
    ----------------
    Because the fan apex is a corner that lies ON its two incident (now subdivided)
    edges, the fan produces some zero-area (collinear) triangles along those two
    edges.  They are geometrically inert — they move no surface, ray-casting
    ignores them, and they keep the result a closed 2-manifold (in fact they are
    structurally load-bearing: each carries a unit boundary sub-edge that must pair
    with a neighbour, so they MUST NOT be filtered out).  Eliminating them
    altogether needs a degenerate-free convex re-triangulation that does not
    introduce interior Steiner vertices (which would re-introduce T-junctions with
    perpendicular faces); that is deferred (a documented minor quality limit, not a
    correctness defect — see the module docstring).

    Parameters
    ----------
    face : tuple of (int, int, int)
        The rectangle's four lattice-node corners, outward-CCW.
    subdiv : set of (int, int, int)
        The global set of subdivision lattice nodes (see :func:`subdivision_nodes`).

    Returns
    -------
    list of (node, node, node)
        Outward-wound triangles as triples of lattice nodes.
    """
    corners = [np.asarray(c, dtype=int) for c in face]
    perim: list[tuple[int, int, int]] = []
    for s in range(4):
        p0 = corners[s]
        p1 = corners[(s + 1) % 4]
        step = np.sign(p1 - p0).astype(int)
        n_steps = int(np.abs(p1 - p0).sum())
        # Walk tail-inclusive, head-exclusive (the head is the next edge's tail).
        for t in range(n_steps):
            node = (int(p0[0] + step[0] * t), int(p0[1] + step[1] * t), int(p0[2] + step[2] * t))
            # Always keep the corner (t == 0); keep interior nodes only when a
            # rectangle corner sits there (a T-junction site).
            if t == 0 or node in subdiv:
                perim.append(node)

    triangles: list[tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]] = []
    for t in range(1, len(perim) - 1):
        triangles.append((perim[0], perim[t], perim[t + 1]))
    return triangles
