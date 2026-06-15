"""Extract a watertight per-body triangle mesh from a labelled voxel grid.

This is the mesher of the voxel-litho builder (spec §"B. extract_body_solids").
Task 3's :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`
labels every voxel of a regular 3-D grid with the body that fills it; here we
extract, for each body, the boundary of its voxel set as a closed 2-manifold
triangle mesh.  "Label space, then extract boundaries" makes the result
watertight AND faithful by construction: a labelling of space is a partition, so
each body's voxel-set boundary is closed, and because any voxel can carry any
body the extracted geometry represents interfingering / pinch-out exactly (the
implicit field could not).

The boundary is the 3-D analogue of the 2-D-raster XOR-mask boundary in
``strat_field.body_assembly._build_component_mesh``: a voxel face appears in the
mesh iff the body is present on one side of the face and absent on the other (the
``present & ~shift(present)`` rule).  Every interior face cancels (present on
both sides), every boundary face appears once → closed by construction.

Unlike the 2-D version (top / bottom always boundary + 4 XOR side faces), all
SIX directions here use the XOR rule, because z is now a real grid axis: a body
can occupy two disconnected z-spans at one ``(x, y)`` (vertical interfingering),
so the ±z faces are NOT always-boundary.

Vertex welding is NOT a naive global weld by lattice node ``(ni, nj, nk)``: a
diagonal voxel touch (two same-body cells meeting only along a lattice edge)
would fuse four boundary faces onto one shared edge → a non-manifold edge.
Instead the weld (1) unions corner instances only across manifold seams (two-face
edges) plus the dihedral of each cell at a four-face touch, (2) re-keys vertices
per connected boundary SHEET so two sheets meeting only at a pinch separate, and
(3) splits any residual four-triangle edge (an intrinsic single-fan 3-D self-
touch) by giving each dihedral pair its own coincident edge-midpoint.  The result
is a closed 2-manifold — exactly two triangles per undirected edge — that still
sits exactly on the labels (every duplicate / midpoint is geometrically
coincident), validated on real ``test.strix`` data.

Triangle count is intentionally large (one face quad → two triangles per
boundary voxel face); greedy meshing to reduce it is a separate task and is NOT
done here.

Pure domain module — numpy only, no I/O, no logging, no framework imports.  The
function computes; it does not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.voxel_litho.voxel_types import LabelGrid
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

__all__ = ["extract_body_solids"]


def _corner_coords(g: np.ndarray) -> np.ndarray:
    """Return the ``n+1`` cell-corner coordinates for ``n`` ascending cell centres.

    A regular grid voxel ``i`` is centred at ``g[i]`` and spans ``[g[i] - h/2,
    g[i] + h/2]`` where ``h`` is the (assumed uniform) spacing ``g[1] - g[0]``.
    The corner array therefore has the cell-face elevations: ``cx[i] = g[i] -
    h/2`` for ``i < n`` and ``cx[n] = g[n-1] + h/2``.  Adjacent cells share a
    corner coordinate exactly (bit-identical), which is what makes neighbouring
    bodies' touching faces weld watertight.

    Parameters
    ----------
    g : numpy.ndarray
        Shape ``(n,)`` ascending grid-node (cell-centre) coordinates.  ``n >= 1``.

    Returns
    -------
    numpy.ndarray
        Shape ``(n + 1,)`` cell-corner coordinates.
    """
    n = len(g)
    # Uniform spacing; for a single-cell axis fall back to a unit half-width so
    # the corner array is still well-formed (degenerate but valid).
    h = float(g[1] - g[0]) if n > 1 else 1.0
    corners = np.empty(n + 1, dtype=float)
    corners[:n] = g - h / 2.0
    corners[n] = g[n - 1] + h / 2.0
    return corners


def _build_body_mesh(
    present: np.ndarray,
    cx: np.ndarray,
    cy: np.ndarray,
    cz: np.ndarray,
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Build the closed-manifold boundary mesh of one body's voxel set.

    Classifies every voxel face as interior (the body is present on both sides →
    the face cancels) or boundary (present on exactly one side → the face is
    emitted), per direction, via the XOR-presence rule ``present & ~shift``.
    Pads the presence mask with ``False`` on every side so a body voxel on the
    grid edge correctly sees an absent neighbour beyond the grid.

    Winding convention (outward-facing, CCW from outside; the 3-D generalisation
    of ``body_assembly._build_component_mesh`` — its top/bottom/N/S/W/E windings
    with ``layer`` promoted to the third corner axis ``nk``)
    --------------------------------------------------------------------------
    A voxel ``(i, j, k)`` spans corners ``[i..i+1] x [j..j+1] x [k..k+1]``.

    * **+z (top)**    at ``nk = k+1``, outward +z:
      ``(i,j,k+1) -> (i+1,j,k+1) -> (i+1,j+1,k+1) -> (i,j+1,k+1)``
    * **-z (bottom)** at ``nk = k``,   outward -z (reverse of top):
      ``(i,j,k) -> (i,j+1,k) -> (i+1,j+1,k) -> (i+1,j,k)``
    * **-y (south)**  at ``nj = j``,   outward -y:
      ``(i,j,k) -> (i+1,j,k) -> (i+1,j,k+1) -> (i,j,k+1)``
    * **+y (north)**  at ``nj = j+1``, outward +y:
      ``(i+1,j+1,k) -> (i,j+1,k) -> (i,j+1,k+1) -> (i+1,j+1,k+1)``
    * **-x (west)**   at ``ni = i``,   outward -x:
      ``(i,j+1,k) -> (i,j,k) -> (i,j,k+1) -> (i,j+1,k+1)``
    * **+x (east)**   at ``ni = i+1``, outward +x:
      ``(i+1,j,k) -> (i+1,j+1,k) -> (i+1,j+1,k+1) -> (i+1,j,k+1)``

    Parameters
    ----------
    present : numpy.ndarray
        Shape ``(nx, ny, nz)`` bool mask: ``True`` where this body fills the voxel.
    cx, cy, cz : numpy.ndarray
        Corner-coordinate arrays (length ``nx+1`` / ``ny+1`` / ``nz+1``).

    Returns
    -------
    (list of (float, float, float), list of (int, int, int))
        The welded vertices and outward-wound triangles of the closed solid.
        Vertex order is first-touch over the face directions in the fixed order
        ``+z, -z, -y, +y, -x, +x`` (raster scan, C-order, within each) —
        deterministic.  Empty lists when the body has no voxel.
    """
    if not present.any():
        return [], []

    # Pad with False so a body voxel on the grid edge sees an absent neighbour
    # beyond the grid (its outward face is a boundary face).
    padded = np.pad(present, pad_width=1, mode="constant", constant_values=False)
    interior = padded[1:-1, 1:-1, 1:-1]  # == present

    # Boundary faces per direction: present here AND the neighbour in that
    # direction is absent.  Slicing the padded mask gives the shifted neighbour.
    top_mask = interior & ~padded[1:-1, 1:-1, 2:]  # +z neighbour (k+1) absent
    bottom_mask = interior & ~padded[1:-1, 1:-1, :-2]  # -z neighbour (k-1) absent
    south_mask = interior & ~padded[1:-1, :-2, 1:-1]  # -y neighbour (j-1) absent
    north_mask = interior & ~padded[1:-1, 2:, 1:-1]  # +y neighbour (j+1) absent
    west_mask = interior & ~padded[:-2, 1:-1, 1:-1]  # -x neighbour (i-1) absent
    east_mask = interior & ~padded[2:, 1:-1, 1:-1]  # +x neighbour (i+1) absent

    # ------------------------------------------------------------------
    # Step 1: emit every boundary quad as four lattice-node corners (outward-CCW).
    #
    # Each quad's corners are the lattice nodes (ni, nj, nk).  Vertex welding
    # happens in step 2 (the half-edge orbit walk), NOT a naive global weld by
    # (ni, nj, nk): a global weld would fuse a diagonal voxel touch into a
    # four-face non-manifold edge.
    # ------------------------------------------------------------------
    faces: list[tuple[tuple[int, int, int], ...]] = []  # 4 lattice nodes per face
    face_cell: list[tuple[int, int, int]] = []  # source voxel cell (i, j, k) per face

    # The face loops run in a fixed direction order; within each, ``np.where``
    # yields C-order (raster-scan) indices, so the order is deterministic.  Each
    # face records its source cell ``(i, j, k)`` for the diagonal-touch weld
    # (top/north/east faces sit on the ``+1`` corner, so the cell is NOT the face's
    # min corner — it is tracked explicitly here).

    ti, tj, tk = (a.tolist() for a in np.where(top_mask))
    for i, j, k in zip(ti, tj, tk):  # +z (top): outward +z, CCW from above.
        faces.append(((i, j, k + 1), (i + 1, j, k + 1), (i + 1, j + 1, k + 1), (i, j + 1, k + 1)))
        face_cell.append((i, j, k))

    bi, bj, bk = (a.tolist() for a in np.where(bottom_mask))
    for i, j, k in zip(bi, bj, bk):  # -z (bottom): outward -z, reverse of top.
        faces.append(((i, j, k), (i, j + 1, k), (i + 1, j + 1, k), (i + 1, j, k)))
        face_cell.append((i, j, k))

    si, sj, sk = (a.tolist() for a in np.where(south_mask))
    for i, j, k in zip(si, sj, sk):  # -y (south): outward -y.
        faces.append(((i, j, k), (i + 1, j, k), (i + 1, j, k + 1), (i, j, k + 1)))
        face_cell.append((i, j, k))

    ni_, nj_, nk_ = (a.tolist() for a in np.where(north_mask))
    for i, j, k in zip(ni_, nj_, nk_):  # +y (north): outward +y.
        faces.append(((i + 1, j + 1, k), (i, j + 1, k), (i, j + 1, k + 1), (i + 1, j + 1, k + 1)))
        face_cell.append((i, j, k))

    wi, wj, wk = (a.tolist() for a in np.where(west_mask))
    for i, j, k in zip(wi, wj, wk):  # -x (west): outward -x.
        faces.append(((i, j + 1, k), (i, j, k), (i, j, k + 1), (i, j + 1, k + 1)))
        face_cell.append((i, j, k))

    ei, ej, ek = (a.tolist() for a in np.where(east_mask))
    for i, j, k in zip(ei, ej, ek):  # +x (east): outward +x.
        faces.append(((i + 1, j, k), (i + 1, j + 1, k), (i + 1, j + 1, k + 1), (i + 1, j, k + 1)))
        face_cell.append((i, j, k))

    return _weld_and_triangulate(faces, face_cell, cx, cy, cz)


# ---------------------------------------------------------------------------
# Manifold-safe vertex weld
# ---------------------------------------------------------------------------


def _weld_and_triangulate(
    faces: list[tuple[tuple[int, int, int], ...]],
    face_cell: list[tuple[int, int, int]],
    cx: np.ndarray,
    cy: np.ndarray,
    cz: np.ndarray,
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Weld per-face corners into a closed 2-manifold and triangulate.

    Each face starts with four independent corner instances; instances of the
    SAME lattice node are merged (union-find) across MANIFOLD seams:

    * a lattice edge shared by exactly two faces is an ordinary seam — weld the
      two faces' matching endpoint instances; and
    * a lattice edge shared by FOUR faces is a diagonal voxel touch (two same-body
      cells meeting only along that edge, the other two cells absent) — weld each
      source cell's own two faces (closing its dihedral) but never across the two
      cells, so the two boundary sheets pinch apart there.

    A naive global weld by ``(ni, nj, nk)`` would instead fuse all four faces of a
    diagonal touch onto one vertex pair → an edge incident to four triangles,
    which ``assert_closed_manifold`` rejects.  A genuinely intrinsic 3-D pinch (two
    same-body cells touching only along an edge yet reconnected elsewhere into one
    fan) that survives this weld is repaired by :func:`_split_pinched_sheets`.

    Parameters
    ----------
    faces : list of tuple of (int, int, int)
        Boundary quads, four lattice nodes each, outward-CCW.
    face_cell : list of (int, int, int)
        The source voxel cell ``(i, j, k)`` of each face (parallel to ``faces``),
        used to group the four faces of a diagonal-touch edge by cell.
    cx, cy, cz : numpy.ndarray
        Corner-coordinate arrays (length ``nx+1`` / ``ny+1`` / ``nz+1``).

    Returns
    -------
    (list of (float, float, float), list of (int, int, int))
        The welded vertices and outward-wound triangles of the closed solid.
    """
    n_faces = len(faces)
    n_inst = n_faces * 4  # corner-instance id = face_index * 4 + local_corner
    parent = list(range(n_inst))

    def _find(a: int) -> int:
        """Union-find root with path compression."""
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    def _union(a: int, b: int) -> None:
        """Merge the sets containing instances ``a`` and ``b`` (lower root wins)."""
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    def _weld_edge(fa: int, la: int, fb: int, lb: int) -> None:
        """Weld both shared-edge endpoint instances between two faces of a seam.

        ``la`` / ``lb`` are the local corners where each face's directed edge
        begins; the two faces visit the same two lattice nodes (opposite order).
        """
        if faces[fa][la] == faces[fb][lb]:
            _union(fa * 4 + la, fb * 4 + lb)
            _union(fa * 4 + (la + 1) % 4, fb * 4 + (lb + 1) % 4)
        else:  # reverse traversal — the ordinary manifold case
            _union(fa * 4 + la, fb * 4 + (lb + 1) % 4)
            _union(fa * 4 + (la + 1) % 4, fb * 4 + lb)

    # Map each UNDIRECTED lattice edge to the (face_index, tail_local) incidences.
    edge_faces: dict[frozenset[tuple[int, int, int]], list[tuple[int, int]]] = {}
    for fi, face in enumerate(faces):
        for lc in range(4):
            key = frozenset((face[lc], face[(lc + 1) % 4]))
            edge_faces.setdefault(key, []).append((fi, lc))

    for incidences in edge_faces.values():
        if len(incidences) == 2:
            (fa, la), (fb, lb) = incidences
            _weld_edge(fa, la, fb, lb)
        elif len(incidences) == 4:
            by_cell: dict[tuple[int, int, int], list[tuple[int, int]]] = {}
            for fi, lc in incidences:
                by_cell.setdefault(face_cell[fi], []).append((fi, lc))
            for cell_incidences in by_cell.values():
                if len(cell_incidences) == 2:
                    (fa, la), (fb, lb) = cell_incidences
                    _weld_edge(fa, la, fb, lb)
        # A one-face edge is an open boundary (should not occur) and is left as-is.

    # Compact welded instances into vertices (first-touch order → deterministic).
    root_to_vid: dict[int, int] = {}
    verts: list[tuple[float, float, float]] = []
    inst_vid: list[int] = [0] * n_inst
    for fi, face in enumerate(faces):
        for lc in range(4):
            root = _find(fi * 4 + lc)
            vid = root_to_vid.get(root)
            if vid is None:
                vid = len(verts)
                ni, nj, nk = face[lc]
                verts.append((float(cx[ni]), float(cy[nj]), float(cz[nk])))
                root_to_vid[root] = vid
            inst_vid[fi * 4 + lc] = vid

    triangles: list[tuple[int, int, int]] = []
    for fi in range(n_faces):
        a, b, c, d = (inst_vid[fi * 4 + lc] for lc in range(4))
        # Triangulate quad (a, b, c, d) -> (a, b, c) + (a, c, d).
        triangles.append((a, b, c))
        triangles.append((a, c, d))

    # Repair any intrinsic 3-D pinch the union weld could not separate.
    return _split_pinched_sheets(verts, triangles)


def _split_pinched_sheets(
    verts: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Separate diagonal pinches into a closed 2-manifold (sheet re-key + edge split).

    The union weld closes each cell's dihedral, but two same-body cells that touch
    ONLY along a lattice edge can leave that edge incident to FOUR triangles — a
    non-manifold edge.  Two passes resolve it:

    1. **Sheet re-key** — rebuild vertex identity using only MANIFOLD adjacency
       (an edge incident to exactly two triangles).  A four-triangle pinch edge is
       a cut, so two boundary sheets that meet ONLY at the pinch fall into
       different components and get distinct (coincident) vertices.  This resolves
       every pinch where the two sheets are otherwise disconnected.

    2. **Edge-midpoint split** — a pinch where the two sheets reconnect elsewhere
       into ONE connected fan (an intrinsic 3-D diagonal self-touch) survives pass
       1.  For each such residual four-triangle edge ``(u, v)`` the four triangles
       form two dihedral pairs (by directed ``u->v`` / ``v->u`` edge); give each
       pair its OWN midpoint vertex on the edge and replace that pair's ``(u, v)``
       edge with ``(u, m) + (m, v)``.  The two midpoints are coincident at the edge
       centre but distinct, so the edge ``(u, v)`` no longer exists as a single
       shared edge — each sub-edge ``(u, m)`` / ``(m, v)`` is shared by exactly two
       triangles.  Geometry is unchanged (midpoints lie on the original edge).

    Parameters
    ----------
    verts : list of (float, float, float)
        The welded vertices (extended with coincident copies / midpoints).
    triangles : list of (int, int, int)
        The triangle index triples.

    Returns
    -------
    (list of (float, float, float), list of (int, int, int))
        The vertices and triangles, a closed 2-manifold at every pinch.
    """
    n_tris = len(triangles)
    # Undirected triangle edge -> incident triangle indices.
    edge_tris: dict[frozenset[int], list[int]] = {}
    for ti, (a, b, c) in enumerate(triangles):
        for u, v in ((a, b), (b, c), (c, a)):
            edge_tris.setdefault(frozenset((u, v)), []).append(ti)

    if not any(len(ts) == 4 for ts in edge_tris.values()):
        return verts, triangles  # already manifold — common case pays nothing

    # Triangle adjacency via MANIFOLD edges only (exactly two incident triangles);
    # a four-triangle pinch edge is a cut and contributes no adjacency, so the two
    # boundary sheets meeting at the pinch fall into different components.
    adjacency: list[list[int]] = [[] for _ in range(n_tris)]
    for ts in edge_tris.values():
        if len(ts) == 2:
            t0, t1 = ts
            adjacency[t0].append(t1)
            adjacency[t1].append(t0)

    # Connected components of triangles under manifold adjacency = boundary sheets.
    # Deterministic BFS in ascending triangle order.
    sheet_of: list[int] = [-1] * n_tris
    n_sheets = 0
    for start in range(n_tris):
        if sheet_of[start] != -1:
            continue
        sheet = n_sheets
        n_sheets += 1
        stack = [start]
        sheet_of[start] = sheet
        while stack:
            t = stack.pop()
            for nb in adjacency[t]:
                if sheet_of[nb] == -1:
                    sheet_of[nb] = sheet
                    stack.append(nb)

    # Re-key each corner by (original vertex, sheet): the FIRST sheet to touch a
    # vertex keeps the original id; later sheets get a coincident copy, so two
    # sheets sharing a pinched corner reference distinct vertices.
    verts = list(verts)
    key_to_vid: dict[tuple[int, int], int] = {}
    orig_claimed: set[int] = set()
    new_triangles: list[tuple[int, int, int]] = []
    for ti in range(n_tris):
        sheet = sheet_of[ti]
        remapped: list[int] = []
        for w in triangles[ti]:
            key = (w, sheet)
            vid = key_to_vid.get(key)
            if vid is None:
                if w not in orig_claimed:
                    vid = w
                    orig_claimed.add(w)
                else:
                    vid = len(verts)
                    verts.append(verts[w])
                key_to_vid[key] = vid
            remapped.append(vid)
        new_triangles.append((remapped[0], remapped[1], remapped[2]))

    # Pass 2: edge-midpoint split for any residual four-triangle edge (an
    # intrinsic single-fan pinch the sheet re-key could not separate).
    return _split_pinched_edges_by_midpoint(verts, new_triangles)


def _split_pinched_edges_by_midpoint(
    verts: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Split each residual four-triangle edge by giving each dihedral pair its own midpoint.

    See :func:`_split_pinched_sheets` pass 2.  Iterates to a fixed point because a
    split changes the edge incidence around the touched corners.

    Parameters
    ----------
    verts : list of (float, float, float)
        Vertices (extended with midpoint copies).
    triangles : list of (int, int, int)
        Triangle index triples (re-triangulated at split edges).

    Returns
    -------
    (list of (float, float, float), list of (int, int, int))
        The vertices and triangles with no four-triangle edge remaining.
    """
    verts = list(verts)
    triangles = list(triangles)

    def _split_one(tri: tuple[int, int, int], u: int, v: int, m: int) -> list[tuple[int, int, int]]:
        """Replace edge ``(u, v)`` of ``tri`` with ``(u, m) + (m, v)`` (one quad → two tris)."""
        a, b, c = tri
        # Rotate so the (u, v) directed edge sits at (a, b), preserving winding.
        for _ in range(3):
            if (a, b) == (u, v) or (a, b) == (v, u):
                break
            a, b, c = b, c, a
        # Now a-b is the pinch edge; insert m between → triangles (a, m, c)+(m, b, c).
        return [(a, m, c), (m, b, c)]

    for _ in range(256):
        edge_tris: dict[frozenset[int], list[int]] = {}
        for ti, (a, b, c) in enumerate(triangles):
            for u, v in ((a, b), (b, c), (c, a)):
                edge_tris.setdefault(frozenset((u, v)), []).append(ti)
        pinched = [e for e, ts in edge_tris.items() if len(ts) == 4]
        if not pinched:
            break
        edge = pinched[0]
        u, v = tuple(edge)
        tris = edge_tris[edge]
        # Two dihedral pairs by directed edge (one u->v + one v->u each).
        fwd = [ti for ti in tris if _directed(triangles[ti], u, v)]
        rev = [ti for ti in tris if _directed(triangles[ti], v, u)]
        if len(fwd) != 2 or len(rev) != 2:
            break  # unexpected topology — leave for the manifold assert to surface
        pairs = ((fwd[0], rev[0]), (fwd[1], rev[1]))
        mx = (verts[u][0] + verts[v][0]) / 2.0
        my = (verts[u][1] + verts[v][1]) / 2.0
        mz = (verts[u][2] + verts[v][2]) / 2.0
        # Replace each triangle by its midpoint-split pair; one midpoint per pair.
        replacements: dict[int, list[tuple[int, int, int]]] = {}
        for pair in pairs:
            m = len(verts)
            verts.append((mx, my, mz))
            for ti in pair:
                replacements[ti] = _split_one(triangles[ti], u, v, m)
        # Rebuild the triangle list with the splits applied.
        rebuilt: list[tuple[int, int, int]] = []
        for ti, tri in enumerate(triangles):
            rebuilt.extend(replacements.get(ti, [tri]))
        triangles = rebuilt

    return verts, triangles


def _directed(tri: tuple[int, int, int], a: int, b: int) -> bool:
    """Return True iff triangle ``tri`` traverses the directed edge ``a -> b``."""
    return (tri[0], tri[1]) == (a, b) or (tri[1], tri[2]) == (a, b) or (tri[2], tri[0]) == (a, b)


def extract_body_solids(grid: LabelGrid) -> list[LithoBodyMesh]:
    """Extract a watertight triangle mesh for every body in a labelled grid.

    For each body index (in stable / sorted index order, skipping the ``-1``
    void), build the boolean presence mask ``grid.labels == index`` and extract
    the boundary of its voxel set via the per-direction XOR-mask rule.  Because
    each body's voxel set is a subset of a partition of space, its boundary is a
    closed 2-manifold and no two bodies share an interior — watertight and
    non-overlapping by construction.

    A body whose voxel set is empty (its index labels no voxel) is skipped (it
    yields no mesh, rather than a degenerate empty one).

    Parameters
    ----------
    grid : LabelGrid
        The labelled voxel grid from
        :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`:
        regular axes ``gx`` / ``gy`` / ``gz``, the dense ``labels`` array (body
        index or ``-1``), the ``body_id_by_index`` map, and the
        ``formation_by_body`` lookup.

    Returns
    -------
    list of LithoBodyMesh
        One closed mesh per non-empty body, in ascending body-index order.  Each
        mesh carries its ``body_id`` (from ``body_id_by_index``), ``formation_id``
        (from ``formation_by_body``), welded ``vertices``, outward-wound
        ``triangles``, and ``is_flagged=False`` (these are real solids).

    Notes
    -----
    The triangle count is intentionally un-optimised (per-voxel-face quads);
    greedy meshing to merge coplanar faces is a separate task.
    """
    # Corner-lattice coordinates shared by all bodies — computed once.
    cx = _corner_coords(grid.gx)
    cy = _corner_coords(grid.gy)
    cz = _corner_coords(grid.gz)

    meshes: list[LithoBodyMesh] = []
    n_bodies = len(grid.body_id_by_index)
    for index in range(n_bodies):
        present = grid.labels == index
        if not present.any():
            continue  # this body index labels no voxel — skip it
        vertices, triangles = _build_body_mesh(present, cx, cy, cz)
        body_id = grid.body_id_by_index[index]
        meshes.append(
            LithoBodyMesh(
                body_id=body_id,
                formation_id=grid.formation_by_body[body_id],
                vertices=vertices,
                triangles=triangles,
                is_flagged=False,
            )
        )
    return meshes
