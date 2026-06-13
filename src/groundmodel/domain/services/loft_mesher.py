"""Loft mesher — wedge meshes that tile the domain by construction.

This is Task 6 of the watertight loft builder (spec §4).  Given a
:class:`~groundmodel.domain.services.loft_field.LoftField` (Task 5) it produces
one closed-manifold :class:`~groundmodel.domain.value_objects.litho_body_mesh.LithoBodyMesh`
per litho body, such that the union of all bodies tiles the modelled domain
with **no holes, no overlaps, and no T-junctions** — watertightness as a
property of the construction, not of a repair pass.

The construction (spec §4)
---------------------------
1. **Map-plane nodes**: a grid over the alpha hull, the hull boundary
   vertices, and nodes densified along every section line (so triangle edges
   follow the sections — the no-CDT route; fidelity at sections scales with
   densification).
2. **Map triangulation**: ``scipy.spatial.Delaunay`` over the sorted, deduped
   nodes; triangles whose centroid falls outside the hull are dropped.
3. **Field eval, once per node**: ``field.stack_at`` is cached by node index.
4. **Per triangle → per-body wedges**: the three corner stacks are reconciled
   into ONE ordered interface sequence (a superset of every corner's bodies,
   shallow → deep).  Each interface ``k`` becomes a triangulated surface (the
   three corners' elevations for that interface); body ``i`` is the wedge
   between interface ``i`` (its top) and interface ``i + 1`` (its base).  A
   body ABSENT at a corner collapses there — its top and base coincide at the
   elevation where it pinches out (the boundary between its present
   neighbours), so the wedge degenerates to a seam with no zero-thickness
   skin.
5. **Per-body extraction**: weld the body's wedge faces by EXACT integer keys
   (``node_index`` + interface side), drop the internal faces shared by two of
   the body's own wedges, orient the surviving faces outward.

The watertightness lever
------------------------
A corner's interface elevations are derived **only from that node's cached
stack** — never from the triangle's other corners.  So two triangles that
share an edge (two nodes) compute the SAME elevation for the same body's same
interface at each shared node, and their wedge faces reference the SAME welded
vertex.  Shared faces are therefore shared *exactly*; the union tiles by
construction.

Determinism
-----------
Nodes are sorted before triangulation; the unified body order uses a
deterministic mean-elevation + ``body_id`` tie-break; vertices and triangles
are emitted in a stable order — so identical inputs yield byte-identical
meshes (the bundle relies on a rebuild reproducing the stored solids exactly).

Pure domain module — imports only ``groundmodel.domain.*``, scipy, numpy, and
stdlib.  No logging (pure geometry).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.spatial import Delaunay  # type: ignore[import-untyped]

from groundmodel.domain.services.loft_field import LoftField, StackEntry
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

__all__ = ["build_loft_meshes"]

# Coincidence tolerance for elevations + node dedup rounding.  Two interface
# elevations closer than this at a node are the same surface; a body whose
# wedge is everywhere thinner than this is a pinched-out seam (omitted).
EPS: float = 1e-9

# Node-deduplication grid: nodes are snapped to this many decimal places (mm at
# metre scale) before triangulation so two construction sources (grid vs
# section densification) that land on near-identical points collapse to ONE
# node — Delaunay is unstable on duplicate / near-duplicate points.
NODE_ROUND_DECIMALS: int = 6

# Default map-plane grid spacing (metres).  Overridable per call; the section
# lines are additionally densified at half this spacing for fidelity.
DEFAULT_GRID_SPACING_M: float = 5.0


# ---------------------------------------------------------------------------
# Node construction
# ---------------------------------------------------------------------------


def _polygon_bbox(polygon: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """Return ``(minx, miny, maxx, maxy)`` of a polygon ring."""
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def _grid_nodes(
    polygon: list[tuple[float, float]],
    contains: Callable[[float, float], bool],
    spacing: float,
) -> list[tuple[float, float]]:
    """Grid points at ``spacing`` over the polygon bbox, kept where inside.

    Parameters
    ----------
    polygon : list[tuple[float, float]]
        Alpha-hull ring.
    contains : Callable[[float, float], bool]
        Point-in-polygon predicate (``domain.contains``).
    spacing : float
        Grid spacing in metres.

    Returns
    -------
    list[tuple[float, float]]
        Interior grid nodes.
    """
    minx, miny, maxx, maxy = _polygon_bbox(polygon)
    out: list[tuple[float, float]] = []
    nx = max(1, int(math.ceil((maxx - minx) / spacing)))
    ny = max(1, int(math.ceil((maxy - miny) / spacing)))
    for i in range(nx + 1):
        x = minx + i * spacing
        for j in range(ny + 1):
            y = miny + j * spacing
            if contains(x, y):
                out.append((x, y))
    return out


def _section_line_nodes(field: LoftField, spacing: float) -> list[tuple[float, float]]:
    """Densify every section line at ``spacing`` between its endpoints.

    At a node ON a section line the field reproduces that section's partition
    exactly (weight 1), so densifying the sections makes triangle edges hug the
    sections and the loft honour the authored 2-D interpretation.
    """
    out: list[tuple[float, float]] = []
    for s in field.sections:
        length = math.hypot(s.bx - s.ax, s.by - s.ay)
        if length < EPS:
            out.append((s.ax, s.ay))
            continue
        steps = max(1, int(math.ceil(length / spacing)))
        for k in range(steps + 1):
            t = k / steps
            out.append((s.ax + t * (s.bx - s.ax), s.ay + t * (s.by - s.ay)))
    return out


def _dedup_nodes(nodes: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Round to :data:`NODE_ROUND_DECIMALS` and drop duplicates, then sort.

    Sorting makes the triangulation input deterministic (so identical field
    inputs yield byte-identical meshes).
    """
    seen: set[tuple[float, float]] = set()
    rounded: list[tuple[float, float]] = []
    for x, y in nodes:
        key = (round(x, NODE_ROUND_DECIMALS), round(y, NODE_ROUND_DECIMALS))
        if key not in seen:
            seen.add(key)
            rounded.append(key)
    rounded.sort()
    return rounded


def _triangulate(
    nodes: list[tuple[float, float]],
    contains: Callable[[float, float], bool],
) -> list[tuple[int, int, int]]:
    """Delaunay-triangulate ``nodes``; keep triangles whose centroid is inside.

    Parameters
    ----------
    nodes : list[tuple[float, float]]
        Deduplicated, sorted map-plane nodes.
    contains : Callable[[float, float], bool]
        Point-in-polygon predicate to drop convex-hull-fill triangles that
        bridge a concavity of the alpha hull.

    Returns
    -------
    list[tuple[int, int, int]]
        Triangle index triples into ``nodes``, sorted for determinism.
    """
    if len(nodes) < 3:
        return []
    pts = np.array(nodes, dtype=float)
    try:
        tri = Delaunay(pts)
    except Exception:
        # All-collinear nodes — no triangles.  The single-section fixtures avoid
        # this by densifying the section line plus the hull's off-line vertices.
        return []
    kept: list[tuple[int, int, int]] = []
    for a, b, c in tri.simplices.tolist():
        cx = (nodes[a][0] + nodes[b][0] + nodes[c][0]) / 3.0
        cy = (nodes[a][1] + nodes[b][1] + nodes[c][1]) / 3.0
        if contains(cx, cy):
            # Normalise winding so the lowest index leads — deterministic, and
            # the orientation is fixed downstream when faces are oriented outward.
            kept.append(_rotate_min_first((a, b, c)))
    kept.sort()
    return kept


def _rotate_min_first(t: tuple[int, int, int]) -> tuple[int, int, int]:
    """Rotate a triangle so its smallest index comes first (winding preserved)."""
    a, b, c = t
    if a <= b and a <= c:
        return (a, b, c)
    if b <= a and b <= c:
        return (b, c, a)
    return (c, a, b)


# ---------------------------------------------------------------------------
# Per-triangle interface reconciliation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _BodyMeta:
    """A body's identity in the unified per-triangle order."""

    body_id: str | None
    formation_id: str
    is_band_filler: bool


def _entry_key(e: StackEntry) -> tuple[str, str, bool]:
    """A hashable identity for matching a stack entry across the 3 corners.

    Matched by ``body_id`` (the resolver's cross-section identity).  Entries
    with ``body_id is None`` (never-correlated minorities / band fillers) carry
    no cross-section identity, so they key on a synthetic ``"none:<formation>"``
    token — they only ever match a same-formation None entry at another corner,
    which is the closest available correspondence.
    """
    if e.body_id is not None:
        return ("id", e.body_id, e.is_band_filler)
    return ("none", e.formation_id, e.is_band_filler)


def _global_body_order(
    node_stacks: list[list[StackEntry]],
) -> list[tuple[tuple[str, str, bool], _BodyMeta]]:
    """Build ONE model-wide shallow → deep body order over every node stack.

    A single global order (not a per-triangle order) is what makes the interface
    elevation at a node intrinsic to the node: every triangle touching that node
    walks the SAME order, so a body's top/base — and an absent body's pinch
    elevation — are identical no matter which triangle asks.  That is the
    welding guarantee for the side-wall vertical edges.

    The order is by mean top-elevation across the nodes where the body is
    present, with a deterministic key tie-break.

    Parameters
    ----------
    node_stacks : list[list[StackEntry]]
        The cached field stack per node.

    Returns
    -------
    list[tuple[tuple[str, str, bool], _BodyMeta]]
        ``(matching_key, meta)`` pairs ordered shallow → deep.

    Notes
    -----
    Mean-elevation is a heuristic linear extension of every node's local order.
    For the continuous loft field (bodies matched by ``body_id``, laid out
    cumulatively) it agrees with each node's order in practice; the invariant
    suite is the backstop that would surface any layout where a node's local
    order contradicts the global one.
    """
    sum_top: dict[tuple[str, str, bool], float] = defaultdict(float)
    count: dict[tuple[str, str, bool], int] = defaultdict(int)
    meta: dict[tuple[str, str, bool], _BodyMeta] = {}
    for stack in node_stacks:
        for e in stack:
            k = _entry_key(e)
            sum_top[k] += e.top_elev
            count[k] += 1
            if k not in meta:
                meta[k] = _BodyMeta(e.body_id, e.formation_id, e.is_band_filler)
    keys = list(meta)
    keys.sort(key=lambda k: (-(sum_top[k] / count[k]), str(k[0]), str(k[1]), k[2]))
    return [(k, meta[k]) for k in keys]


def _node_interfaces(
    stack: list[StackEntry],
    order: list[tuple[tuple[str, str, bool], _BodyMeta]],
) -> list[float]:
    """Interface elevations at ONE node for the GLOBAL body ``order``.

    Returns an array of length ``len(order) + 1``: interface ``k`` is the top
    of body ``k`` (and the base of body ``k - 1``); the last entry is the base
    of the deepest body.  A body PRESENT at this node contributes its own
    top/base; a body ABSENT collapses to the running cursor elevation (its top
    == its base == where it pinches out between its present neighbours), so the
    interface array is monotonic non-increasing by construction.

    Derived from this node's stack + the GLOBAL order alone, so every triangle
    touching the node computes the identical array — the welding guarantee.
    """
    present: dict[tuple[str, str, bool], StackEntry] = {_entry_key(e): e for e in stack}
    # Cursor starts at the node's shallowest top (the partition top); when the
    # node stack is empty (degenerate interval) every interface collapses to a
    # single elevation and the wedges are all zero-thickness (omitted later).
    cursor = stack[0].top_elev if stack else 0.0
    interfaces: list[float] = [cursor]
    for key, _meta in order:
        e = present.get(key)
        if e is not None:
            # Present: advance the cursor to this body's base.  Its top is the
            # current cursor (the node stack is gap-free and the global order is
            # a linear extension, so the present body sits at the frontier).
            cursor = e.base_elev
        # Absent: cursor unchanged → top == base == cursor (a pinch seam).
        interfaces.append(cursor)
    return interfaces


# ---------------------------------------------------------------------------
# Wedge emission + per-body extraction
# ---------------------------------------------------------------------------

# A welded-vertex key: (node_index, interface_rank).  Two triangles sharing a
# node reference the SAME (node_index, interface_rank) and therefore the same
# elevation (the corner interface array is a pure function of the node's stack),
# so the vertex welds exactly.
_VKey = tuple[int, int]


def _canonical_vkeys(vkey_elev: dict[_VKey, float]) -> dict[_VKey, _VKey]:
    """Collapse coincident vkeys to one representative per ``(node, elevation)``.

    When a body pinches at a node its top and base interfaces share the SAME
    elevation (the loft field copies the cursor, so the floats are bit-identical
    — an exact, non-fuzzy signal, not a distance threshold).  Two vkeys at the
    same node with the identical stored elevation are the SAME point and must
    weld to one vertex, else the degenerate side quad leaves a non-manifold seam
    at the pinch.  The representative is the smallest-rank vkey for determinism.

    Computed once over the whole model so every body's extraction shares the
    same welding decisions.
    """
    by_node_elev: dict[tuple[int, float], _VKey] = {}
    for vk in vkey_elev:
        ek = (vk[0], vkey_elev[vk])
        rep = by_node_elev.get(ek)
        if rep is None or vk < rep:
            by_node_elev[ek] = vk
    return {vk: by_node_elev[(vk[0], vkey_elev[vk])] for vk in vkey_elev}


def _build_body_mesh(
    body_id: str | None,
    meta: _BodyMeta,
    faces: list[tuple[_VKey, _VKey, _VKey]],
    vkey_elev: dict[_VKey, float],
    canon: dict[_VKey, _VKey],
    node_xy: list[tuple[float, float]],
) -> LithoBodyMesh | None:
    """Assemble one body's mesh from its face soup.

    Welds coincident vkeys (``canon``), drops faces shared by two of the body's
    OWN wedges (an interior face cancels its twin), orients outward, and emits a
    deterministic vertex + triangle ordering.  Returns ``None`` when the body
    has no surviving faces (fully pinched everywhere).

    Parameters
    ----------
    body_id : str | None
        The body's id (the mesh's ``body_id``; a ``None`` body carries a
        synthetic ``"none:<formation>"`` id).
    meta : _BodyMeta
        Body identity (formation, filler flag).
    faces : list of 3 ``_VKey`` triples
        Faces of every wedge of this body (top, base, side walls).
    vkey_elev : dict[_VKey, float]
        Elevation for each welded vertex key.
    canon : dict[_VKey, _VKey]
        Coincident-vkey welding map from :func:`_canonical_vkeys`.
    node_xy : list[tuple[float, float]]
        Map-plane (x, y) per node index.

    Returns
    -------
    LithoBodyMesh | None
    """

    def _c(vk: _VKey) -> _VKey:
        return canon.get(vk, vk)

    # Drop internal faces: a face shared by two wedges of THIS body appears
    # twice (opposite winding).  Count by sorted vkey triple; keep faces whose
    # multiplicity is odd, emit each surviving face once with its stored winding.
    face_count: dict[frozenset[_VKey], int] = defaultdict(int)
    first_winding: dict[frozenset[_VKey], tuple[_VKey, _VKey, _VKey]] = {}
    for f in faces:
        cf = (_c(f[0]), _c(f[1]), _c(f[2]))
        key = frozenset(cf)
        if len(key) < 3:
            continue  # degenerate (two coincident vkeys) — zero-area, skip
        face_count[key] += 1
        if key not in first_winding:
            first_winding[key] = cf

    surviving: list[tuple[_VKey, _VKey, _VKey]] = [
        first_winding[key] for key, cnt in face_count.items() if cnt % 2 == 1
    ]
    if not surviving:
        return None

    # Weld: assign a contiguous vertex index to every distinct vkey used, in a
    # deterministic order (sorted vkeys) so the output is byte-stable.
    used: set[_VKey] = set()
    for f in surviving:
        used.update(f)
    ordered_keys = sorted(used)
    index_of: dict[_VKey, int] = {k: i for i, k in enumerate(ordered_keys)}
    vertices: list[tuple[float, float, float]] = [
        (node_xy[k[0]][0], node_xy[k[0]][1], vkey_elev[k]) for k in ordered_keys
    ]

    triangles = [(index_of[a], index_of[b], index_of[c]) for a, b, c in surviving]
    # Drop any triangle that collapsed to <3 distinct vertices after welding (a
    # pinch can make two corners of a side face coincide).
    triangles = [t for t in triangles if t[0] != t[1] and t[1] != t[2] and t[0] != t[2]]
    if not triangles:
        return None

    # Orient all faces consistently (every shared edge traversed in opposite
    # directions by its two triangles) then flip globally to outward (positive
    # enclosed volume).  Required for the directed-edge-once manifold check.
    triangles = _orient_outward(triangles, vertices)
    triangles.sort()

    return LithoBodyMesh(
        body_id=body_id if body_id is not None else f"none:{meta.formation_id}",
        formation_id=meta.formation_id,
        vertices=vertices,
        triangles=triangles,
        is_flagged=False,
    )


def _orient_outward(
    triangles: list[tuple[int, int, int]],
    vertices: list[tuple[float, float, float]],
) -> list[tuple[int, int, int]]:
    """Make windings consistent across the mesh, oriented outward.

    BFS over edge adjacency flips each triangle so neighbours traverse their
    shared edge in opposite directions (a consistently-oriented closed surface).
    Then the global orientation is flipped if the signed enclosed volume is
    negative, so every face normal points outward.

    Parameters
    ----------
    triangles : list[tuple[int, int, int]]
        Welded triangle index triples (may have inconsistent winding).
    vertices : list[tuple[float, float, float]]
        Vertex coordinates.

    Returns
    -------
    list[tuple[int, int, int]]
        The same triangles with consistent, outward winding.
    """
    # Edge -> list of (triangle index, is_forward) for adjacency.
    edge_tris: dict[frozenset[int], list[int]] = defaultdict(list)
    for ti, (a, b, c) in enumerate(triangles):
        for u, v in ((a, b), (b, c), (c, a)):
            edge_tris[frozenset((u, v))].append(ti)

    oriented: list[tuple[int, int, int]] = list(triangles)
    visited = [False] * len(oriented)

    def _has_directed_edge(t: tuple[int, int, int], u: int, v: int) -> bool:
        a, b, c = t
        return (a, b) == (u, v) or (b, c) == (u, v) or (c, a) == (u, v)

    # BFS over connected components so disconnected shells each get oriented.
    for seed in range(len(oriented)):
        if visited[seed]:
            continue
        visited[seed] = True
        queue = [seed]
        while queue:
            ti = queue.pop()
            a, b, c = oriented[ti]
            for u, v in ((a, b), (b, c), (c, a)):
                for tj in edge_tris[frozenset((u, v))]:
                    if tj == ti or visited[tj]:
                        continue
                    # Neighbour must traverse this edge in the OPPOSITE direction
                    # (v -> u).  If it instead has u -> v, flip it.
                    if _has_directed_edge(oriented[tj], u, v):
                        x, y, z = oriented[tj]
                        oriented[tj] = (x, z, y)
                    visited[tj] = True
                    queue.append(tj)

    # Global outward flip: signed volume of the oriented mesh (divergence
    # theorem with the origin).  Negative → normals point inward → flip all.
    vol = 0.0
    for a, b, c in oriented:
        ax, ay, az = vertices[a]
        bx, by, bz = vertices[b]
        cx, cy, cz = vertices[c]
        vol += (
            ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
        ) / 6.0
    if vol < 0.0:
        oriented = [(a, c, b) for a, b, c in oriented]
    return oriented


def build_loft_meshes(
    field: LoftField,
    grid_spacing_m: float = DEFAULT_GRID_SPACING_M,
) -> list[LithoBodyMesh]:
    """Build one watertight mesh per body from a loft field.

    Parameters
    ----------
    field : LoftField
        The blended per-column stack field (Task 5).
    grid_spacing_m : float, default :data:`DEFAULT_GRID_SPACING_M`
        Map-plane grid spacing; section lines are densified at half this.

    Returns
    -------
    list[LithoBodyMesh]
        One closed-manifold mesh per body present in the field, ordered by
        ``body_id``.  Every mesh has ``is_flagged=False``; fully-pinched
        (zero-volume) bodies are omitted.  The union tiles the domain.

    Notes
    -----
    Watertightness is guaranteed by construction (shared interface elevations
    derived per node), so there is no repair pass.  See the module docstring.
    """
    domain = field.domain
    polygon = domain.polygon

    # --- Node set: grid + hull boundary + densified section lines ---
    nodes_raw: list[tuple[float, float]] = []
    nodes_raw.extend(_grid_nodes(polygon, domain.contains, grid_spacing_m))
    nodes_raw.extend(polygon)  # hull boundary vertices
    nodes_raw.extend(_section_line_nodes(field, grid_spacing_m / 2.0))
    nodes = _dedup_nodes(nodes_raw)

    triangles = _triangulate(nodes, domain.contains)
    if not triangles:
        return []

    # --- Field eval once per node (cache by node index) ---
    node_stacks: list[list[StackEntry]] = [field.stack_at(x, y) for x, y in nodes]

    # --- ONE global body order, then per-node interface elevations ---
    # The order is model-wide (not per-triangle) so a body's interface rank is
    # the SAME at a node for every triangle touching it — the welding guarantee.
    order = _global_body_order(node_stacks)
    if not order:
        return []
    node_ifaces: list[list[float]] = [_node_interfaces(stack, order) for stack in node_stacks]

    # --- Per body: collect oriented faces + the elevation of each welded vertex ---
    body_faces: dict[str | None, list[tuple[_VKey, _VKey, _VKey]]] = defaultdict(list)
    body_meta: dict[str | None, _BodyMeta] = {}
    vkey_elev: dict[_VKey, float] = {}

    for tri in triangles:
        n0, n1, n2 = tri
        tri_nodes = (n0, n1, n2)
        ifaces = (node_ifaces[n0], node_ifaces[n1], node_ifaces[n2])
        if not any(node_stacks[n] for n in tri_nodes):
            continue

        for bi, (key, meta) in enumerate(order):
            top_rank = bi
            base_rank = bi + 1
            # Per-corner top/base elevations for this body (node-intrinsic).
            tops = [ifaces[c][top_rank] for c in range(3)]
            bases = [ifaces[c][base_rank] for c in range(3)]
            # Skip a wedge that is zero-thickness at ALL three corners (the body
            # is absent across the whole triangle — a pinch seam, no volume).
            if all(tops[c] - bases[c] <= EPS for c in range(3)):
                continue

            mesh_body = key[1] if key[0] == "id" else None
            body_meta[mesh_body] = meta

            # Welded vertex keys for this wedge's 6 corners.  The rank is the
            # GLOBAL order index, so the same (node, rank) means the same point
            # in every triangle — shared side faces weld exactly.
            top_keys: list[_VKey] = [(tri_nodes[c], top_rank) for c in range(3)]
            base_keys: list[_VKey] = [(tri_nodes[c], base_rank) for c in range(3)]
            for c in range(3):
                vkey_elev[top_keys[c]] = tops[c]
                vkey_elev[base_keys[c]] = bases[c]

            faces = body_faces[mesh_body]
            _emit_wedge_faces(faces, tri_nodes, top_keys, base_keys)

    # --- Extract one mesh per body, deterministically ordered ---
    # The coincident-vkey welding map is model-wide (computed once).
    canon = _canonical_vkeys(vkey_elev)
    meshes: list[LithoBodyMesh] = []
    for mesh_body in sorted(body_faces, key=lambda b: (b is None, str(b))):
        # A None-keyed bucket arises from never-correlated minorities / band
        # fillers; _build_body_mesh gives them a synthetic id.
        meta = body_meta[mesh_body]
        mesh = _build_body_mesh(mesh_body, meta, body_faces[mesh_body], vkey_elev, canon, nodes)
        if mesh is not None:
            meshes.append(mesh)
    return meshes


def _emit_wedge_faces(
    faces: list[tuple[_VKey, _VKey, _VKey]],
    tri_nodes: tuple[int, int, int],
    top_keys: list[_VKey],
    base_keys: list[_VKey],
) -> None:
    """Append a wedge prism's faces to ``faces`` (winding normalised later).

    A wedge prism over a map triangle has a top cap (3 top vkeys), a base cap
    (3 base vkeys), and three quad side walls (each split into 2 triangles).

    Cancellation contract (the watertightness lever)
    -----------------------------------------------
    A side quad INTERIOR to the body (the adjacent triangle's same-body wedge
    has the identical quad) must cancel in :func:`_build_body_mesh`, which drops
    faces whose vertex-set appears an even number of times.  For the two
    adjacent triangles to emit the SAME two vertex-sets, the quad's diagonal
    split is **canonicalised by node index** (independent of which triangle
    emits it).  Cancellation is vertex-set based, so the winding here is
    irrelevant; the final mesh's outward orientation is normalised in
    :func:`_orient_outward`.
    """
    t0, t1, t2 = top_keys
    b0, b1, b2 = base_keys
    faces.append((t0, t1, t2))  # top cap
    faces.append((b0, b1, b2))  # base cap

    # Side walls on each of the three map edges.  The diagonal split is keyed on
    # node index so the two triangles sharing a map edge produce identical
    # vertex-sets that cancel when the quad is interior.
    for a, b in ((0, 1), (1, 2), (2, 0)):
        _emit_side_quad(
            faces,
            tri_nodes[a],
            tri_nodes[b],
            top_keys[a],
            base_keys[a],
            top_keys[b],
            base_keys[b],
        )


def _emit_side_quad(
    faces: list[tuple[_VKey, _VKey, _VKey]],
    node_a: int,
    node_b: int,
    top_a: _VKey,
    base_a: _VKey,
    top_b: _VKey,
    base_b: _VKey,
) -> None:
    """Emit a side-wall quad split on a node-index-canonical diagonal.

    The quad has corners (top_a, top_b, base_b, base_a).  The diagonal is chosen
    to run between the LOWER-node side's top and the HIGHER-node side's base, so
    the two triangles that share this map edge split the quad identically and
    their interior faces cancel by vertex-set.
    """
    if node_a <= node_b:
        # diagonal: top_a — base_b
        faces.append((top_a, top_b, base_b))
        faces.append((top_a, base_b, base_a))
    else:
        # diagonal: top_b — base_a  (mirror, so the other triangle matches)
        faces.append((top_b, base_a, top_a))
        faces.append((top_b, base_b, base_a))
