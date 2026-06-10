"""Low-level mesh primitives shared by the M2 per-body builder and the M3 assembler.

Extracted from ``litho_solid_builder`` to break the circular import that would arise
when ``litho_solid_builder`` needs to import helpers FROM ``litho_body_assembly`` in
Task 7b: the import DAG must be

    litho_mesh_primitives  ←  litho_solid_builder
    litho_mesh_primitives  ←  litho_body_assembly

rather than litho_solid_builder ↔ litho_body_assembly (a cycle that fails at load
because neither module's top-level names exist yet when Python resolves the other).

Only pure, stateless helpers with no I/O live here.
"""

from __future__ import annotations

from collections import Counter

from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh


def assemble_closed_solid(
    body_id: str,
    formation_id: str,
    top_v: list[tuple[float, float, float]],
    base_v: list[tuple[float, float, float]],
    tris: list[tuple[int, int, int]],
) -> LithoBodyMesh:
    """Close a body mesh from top + base surfaces and side walls.

    The assembly strategy (for a top surface with N vertices and M
    triangles sharing the same topology as the base surface):

    * Vertex layout: indices [0, N) → top, [N, 2N) → base.
    * Top faces: each triangle with its original winding (outward = up).
    * Base faces: each triangle with reversed winding (outward = down).
    * Side walls: one quad (two triangles) per boundary edge of the TIN.
      Boundary edges are found via a DIRECTED edge counter — each boundary
      edge appears exactly once (directed), preserving outward winding.
      Interior edges appear once in each direction (count 1 each way).
      Using an undirected counter would discard traversal direction and
      produce inward normals on walls where the boundary edge runs
      high-index → low-index in the Delaunay simplex.

    Parameters
    ----------
    body_id : str
        Body identifier.
    formation_id : str
        Formation identifier (drives colour in the viewer).
    top_v : list[tuple[float, float, float]]
        Vertices of the top surface.
    base_v : list[tuple[float, float, float]]
        Vertices of the base surface (same count and topology as top).
    tris : list[tuple[int, int, int]]
        Triangle index triples (shared topology for both surfaces).

    Returns
    -------
    LithoBodyMesh
        Closed watertight solid with ``is_flagged=False``.
    """
    n = len(top_v)
    vertices: list[tuple[float, float, float]] = list(top_v) + list(base_v)
    triangles: list[tuple[int, int, int]] = []

    for a, b, c in tris:
        triangles.append((a, b, c))  # top face, outward-up winding
        triangles.append((c + n, b + n, a + n))  # base face, reversed → outward-down

    # Use a DIRECTED edge counter to find boundary edges and preserve winding.
    # In a consistently-wound (CCW) triangulation each interior edge appears once
    # as (u, v) and once as (v, u) — both directed counts are 1.  A boundary
    # edge appears exactly once directed (u→v), so dir_count[(u,v)] == 1 AND
    # dir_count[(v,u)] == 0.  Checking both conditions identifies the boundary
    # and gives the outward-consistent direction.  An undirected (min, max)
    # counter discards traversal direction and would emit walls with inward
    # normals for any boundary edge traversed high-index → low-index in the
    # Delaunay simplex.
    dir_edge_count: Counter[tuple[int, int]] = Counter()
    for a, b, c in tris:
        for u, v in ((a, b), (b, c), (c, a)):
            dir_edge_count[(u, v)] += 1

    for (u, v), ct in dir_edge_count.items():
        if ct != 1:
            continue  # only one direction of this pair — check if it's boundary
        if dir_edge_count[(v, u)] != 0:
            continue  # reverse also present → interior edge, no wall needed
        # Directed boundary edge u→v in the top surface.
        # The top face already traverses u→v; the base face (reversed) traverses
        # (v+n)→(u+n).  The wall quad must pair with both without repeating any
        # directed edge: start from v (not u) so the wall's top strip is v→u,
        # complementing the top face's u→v.
        triangles.append((v, u, u + n))
        triangles.append((v, u + n, v + n))

    return LithoBodyMesh(
        body_id=body_id,
        formation_id=formation_id,
        vertices=vertices,
        triangles=triangles,
        is_flagged=False,
    )
