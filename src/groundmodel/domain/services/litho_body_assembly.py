"""Assemble one body's closed mesh from shared contact-patch surfaces.

Single-patch path (the common through-going / pinch-out case): the body's top is
one patch and its base is one patch, both fitted over the body's footprint in the
same inv order, so they share Delaunay topology and close with the existing
directed-edge wall logic — and the top/base surfaces ARE the neighbour's surfaces
(shared, gap = 0). Multi-patch bodies (a lateral facies change with different
bodies above/below in different places) return ``None`` here so the caller can
fall back to the per-body fit (no regression vs M2) until a later task upgrades
them. Pure: no I/O.
"""

from __future__ import annotations

from collections import Counter
from typing import Literal

from groundmodel.domain.services.litho_contact_surfaces import (
    ContactKey,
    LayerSpan,
    Surface,
)
from groundmodel.domain.services.litho_facies_partition import (
    competitor_labels_above,
    competitor_labels_below,
    partition_footprint,
)
from groundmodel.domain.services.litho_mesh_primitives import assemble_closed_solid
from groundmodel.domain.services.litho_solid_builder_constants import (
    DEGENERATE_PLAN_AREA_M2,
)
from groundmodel.domain.services.tin_surface import compute_tin, evaluate_tin_at
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.domain.value_objects.tin_surface import TinSurface


def _keys_for_body(
    body_id: str, columns: dict[str, list[LayerSpan]]
) -> tuple[set[ContactKey], set[ContactKey]]:
    """Return ``(top_keys, base_keys)`` — the contact patches above/below a body.

    Top patches are contacts where the body is the LOWER side; base patches where
    it is the UPPER side.

    Parameters
    ----------
    body_id : str
        The body to inspect.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans (shallowest-first).

    Returns
    -------
    tuple[set[ContactKey], set[ContactKey]]
        ``(top_keys, base_keys)`` for the body.
    """
    top_keys: set[ContactKey] = set()
    base_keys: set[ContactKey] = set()
    for spans in columns.values():
        for i, s in enumerate(spans):
            if s.body_id != body_id:
                continue
            upper = spans[i - 1].body_id if i > 0 else ""
            lower = spans[i + 1].body_id if i + 1 < len(spans) else ""
            top_keys.add(ContactKey(upper, body_id))
            base_keys.add(ContactKey(body_id, lower))
    return top_keys, base_keys


def assemble_body(
    body_id: str,
    formation_id: str,
    columns: dict[str, list[LayerSpan]],
    surfaces: dict[ContactKey, Surface],
) -> LithoBodyMesh | None:
    """Assemble a body's closed mesh from shared patch surfaces (single-patch).

    Parameters
    ----------
    body_id : str
        Body to assemble.
    formation_id : str
        Body's formation id (drives colour).
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans (from ``build_columns``).
    surfaces : dict[ContactKey, Surface]
        Fitted patch surfaces (from ``fit_patch_surfaces``).

    Returns
    -------
    LithoBodyMesh | None
        The closed body mesh, or ``None`` when the body is multi-patch or its
        single patch could not be fitted (caller applies the M2/disk fallback).
    """
    top_keys, base_keys = _keys_for_body(body_id, columns)
    if len(top_keys) != 1 or len(base_keys) != 1:
        return None  # multi-patch — handled by a later task (caller falls back)
    top_key = next(iter(top_keys))
    base_key = next(iter(base_keys))
    if top_key not in surfaces or base_key not in surfaces:
        return None
    top_v, top_t = surfaces[top_key]
    base_v, base_t = surfaces[base_key]
    if top_t != base_t:
        return None  # different footprints → not the simple single-patch case
    return assemble_closed_solid(body_id, formation_id, top_v, base_v, top_t)


def detect_enclosed_lenses(
    columns: dict[str, list[LayerSpan]],
) -> dict[str, str]:
    """Map each enclosed-lens body to the matrix body that wraps it.

    A body is an enclosed lens when, at every hole where it occurs, the span
    directly above AND directly below is the SAME body (its matrix). Bodies that
    ever touch the ground surface, the model base, or two different neighbours
    are not enclosed.

    Parameters
    ----------
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans (shallowest-first).

    Returns
    -------
    dict[str, str]
        ``lens_body_id -> matrix_body_id`` for every enclosed lens detected.
    """
    # Accumulate the set of observed (above, below) neighbour pairs per body.
    # An enclosed lens has exactly one unique pair, and above == below != body.
    matrix_of: dict[str, set[str | None]] = {}
    for spans in columns.values():
        for i, s in enumerate(spans):
            above = spans[i - 1].body_id if i > 0 else None
            below = spans[i + 1].body_id if i + 1 < len(spans) else None
            seen = matrix_of.setdefault(s.body_id, set())
            # Record the unique matrix candidate; if above != below the lens is
            # not uniformly enclosed, so sentinel None marks it as non-enclosed.
            seen.add(above if above == below else None)

    out: dict[str, str] = {}
    for body, mats in matrix_of.items():
        if len(mats) == 1:
            (m,) = tuple(mats)
            # m must be a real body (not None) and not the body itself.
            if m is not None and m != body:
                out[body] = m
    return out


def merged_body_extent(
    body_id: str,
    columns: dict[str, list[LayerSpan]],
) -> dict[str, tuple[float, float]]:
    """Per-hole outer extent of a body, merging spans split by interior lenses.

    When a matrix body is split at a lens hole into an upper span and a lower
    span, this function returns the combined outer envelope: the shallowest top
    elevation and the deepest base elevation across all spans of the body at
    that investigation.

    Parameters
    ----------
    body_id : str
        The (matrix) body whose outer extent is wanted.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans (shallowest-first).

    Returns
    -------
    dict[str, tuple[float, float]]
        ``inv -> (top_elev, base_elev)`` where ``top_elev`` is the shallowest
        (most positive) top and ``base_elev`` is the deepest (most negative)
        base for the body at that hole.
    """
    ext: dict[str, tuple[float, float]] = {}
    for inv, spans in columns.items():
        tops = [s.top_elev for s in spans if s.body_id == body_id]
        bases = [s.base_elev for s in spans if s.body_id == body_id]
        if tops:
            ext[inv] = (max(tops), min(bases))
    return ext


def build_extent_solid(
    body_id: str,
    formation_id: str,
    extent: dict[str, tuple[float, float]],
    coords: dict[str, tuple[float, float]],
) -> LithoBodyMesh | None:
    """Build a closed solid between a body's merged top and base extent.

    Top and base TINs are fitted over the SAME inv set (the body's footprint) in
    the same sorted order, so they share Delaunay topology and close with
    :func:`assemble_closed_solid`.

    Parameters
    ----------
    body_id : str
        Body identifier.
    formation_id : str
        Formation id (drives colour).
    extent : dict[str, tuple[float, float]]
        ``inv -> (top_elev, base_elev)`` (from ``merged_body_extent``).
    coords : dict[str, tuple[float, float]]
        ``inv -> (x, y)``.

    Returns
    -------
    LithoBodyMesh | None
        Closed solid, or ``None`` if < 3 points / no triangulation / mismatched
        top vs base topology.
    """
    invs = sorted(extent)
    if len(invs) < 3:
        return None
    top = compute_tin(
        [
            ContactPoint3D(
                contact_id=i,
                x_m=coords[i][0],
                y_m=coords[i][1],
                elevation_m=extent[i][0],
            )
            for i in invs
        ]
    )
    base = compute_tin(
        [
            ContactPoint3D(
                contact_id=i,
                x_m=coords[i][0],
                y_m=coords[i][1],
                elevation_m=extent[i][1],
            )
            for i in invs
        ]
    )
    if not top.triangles or not base.triangles or top.triangles != base.triangles:
        return None
    return assemble_closed_solid(
        body_id, formation_id, list(top.vertices), list(base.vertices), list(top.triangles)
    )


def build_prism(
    body_id: str,
    formation_id: str,
    vertices_2d: list[tuple[float, float]],
    region_tris: list[tuple[int, int, int]],
    top_elev: dict[int, float],
    base_elev: dict[int, float],
) -> LithoBodyMesh:
    """Close a prism over a set of plan triangles between a top and base field.

    Each used 2D vertex gets a top vertex (at ``top_elev``) and a base vertex (at
    ``base_elev``). Triangles are wound CCW for an upward top normal; walls go on
    boundary edges (edges in exactly one region triangle), so a wall shared with an
    adjacent region (same boundary vertices) coincides. Degenerate (zero-area)
    triangles are skipped.

    Parameters
    ----------
    body_id : str
        Body identifier.
    formation_id : str
        Formation id (drives colour).
    vertices_2d : list[tuple[float, float]]
        Shared 2D vertex pool.
    region_tris : list[tuple[int, int, int]]
        This region's plan triangles (indices into ``vertices_2d``).
    top_elev : dict[int, float]
        Elevation of each used 2D vertex on the top surface.  Every vertex
        index appearing in ``region_tris`` must be present here.
    base_elev : dict[int, float]
        Elevation of each used 2D vertex on the base surface.  Every vertex
        index appearing in ``region_tris`` must be present here.

    Returns
    -------
    LithoBodyMesh
        Closed prism (``is_flagged=False``); a degenerate mesh
        (``is_flagged=True``, ``triangles=[]``) if every plan triangle was below
        the area threshold.

    Raises
    ------
    KeyError
        If any vertex index appearing in ``region_tris`` is absent from
        ``top_elev`` or ``base_elev`` (fail-fast on a caller contract
        violation — the caller is responsible for supplying complete maps).
    """
    used = sorted({p for t in region_tris for p in t})
    # Map each 2D vertex index to paired 3D indices: top=2n, base=2n+1.
    top_i = {p: 2 * n for n, p in enumerate(used)}
    base_i = {p: 2 * n + 1 for n, p in enumerate(used)}
    verts: list[tuple[float, float, float]] = []
    for p in used:
        x, y = vertices_2d[p]
        verts.append((x, y, top_elev[p]))
        verts.append((x, y, base_elev[p]))

    tris: list[tuple[int, int, int]] = []
    # Count each directed edge to identify boundary edges.
    edge_count: Counter[tuple[int, int]] = Counter()
    for raw in region_tris:
        ax, ay = vertices_2d[raw[0]]
        bx, by = vertices_2d[raw[1]]
        cx, cy = vertices_2d[raw[2]]
        # 2D signed area (× 2) of the plan triangle — computed once and reused for
        # both the degenerate-skip guard and the CCW winding decision.
        area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(area) < DEGENERATE_PLAN_AREA_M2:
            continue  # skip degenerate triangles
        # Wind CCW (positive area) so the top face normal points up.
        a, b, c = (raw[0], raw[1], raw[2]) if area > 0 else (raw[0], raw[2], raw[1])
        # Top face: CCW when viewed from above (normal points up).
        tris.append((top_i[a], top_i[b], top_i[c]))
        # Base face: CW when viewed from above → CCW from below (normal points down).
        tris.append((base_i[c], base_i[b], base_i[a]))
        for u, v in ((a, b), (b, c), (c, a)):
            edge_count[(u, v)] += 1

    # A boundary edge (u→v) appears once in this region but its reverse (v→u) is absent.
    # Build two wall triangles per boundary edge to cap the sides.
    for (u, v), n in edge_count.items():
        if n == 1 and edge_count[(v, u)] == 0:
            # Wall quad: top_v → top_u → base_u → base_v (two CCW tris from outside).
            tris.append((top_i[v], top_i[u], base_i[u]))
            tris.append((top_i[v], base_i[u], base_i[v]))

    return LithoBodyMesh(
        body_id=body_id,
        formation_id=formation_id,
        vertices=verts,
        triangles=tris,
        is_flagged=not tris,
    )


def assemble_facies_competitors(
    body_id: str,
    side: Literal["above", "below"],
    columns: dict[str, list[LayerSpan]],
    coords: dict[str, tuple[float, float]],
    surfaces: dict[ContactKey, Surface],
) -> dict[str, LithoBodyMesh]:
    """Build each competitor above/below a shared body as a clipped, tiling prism.

    Partitions the shared body's footprint among the competitors (midpoint/Voronoi),
    then builds one prism per competitor between the shared-body contact surface and
    the competitor's outer surface. The shared-body contact (the floor for
    ``above``, the ceiling for ``below``) is one continuous surface sampled at every
    partition vertex, so it stays single-valued across competitors. The
    competitor's outer surface differs by side:

    * ``above`` — competitor tops are sampled from one TIN over all competitors'
      tops (tops meet at the facies boundary; owner-confirmed). The floor is the
      shared body's top, so an ``above`` competitor never reaches below its own base.
    * ``below`` — each competitor floors at its OWN base surface (a TIN fitted over
      only that competitor's holes, nearest-own-hole fallback outside the hull,
      clamped to the competitor's own deepest base). A shallow competitor therefore
      stops at its own base and never sags toward a deeper sibling's base at the
      facies boundary (the silt-below-clay overshoot fix). Where the continuous
      shared ceiling dips below the competitor's own base, the floor is pinched up
      to the ceiling (zero thickness) so the prism never inverts into a
      self-intersecting solid. Each prism is independently watertight via
      ``build_prism``'s boundary walls, so the real vertical facies step is the
      deeper sibling's exposed wall.

    Parameters
    ----------
    body_id : str
        The shared body.
    side : str
        ``"above"`` or ``"below"`` — which side the competition is on.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first.
    coords : dict[str, tuple[float, float]]
        ``inv_id -> (x, y)``.
    surfaces : dict
        Fitted patch surfaces (currently unused here; kept for signature symmetry
        with the other assemblers and future shared-surface reuse).

    Returns
    -------
    dict[str, LithoBodyMesh]
        ``competitor_body_id -> closed prism``.  Empty if the shared body has no
        facies competition on ``side`` (fewer than 3 labelled holes).

    Raises
    ------
    ValueError
        If ``side`` is not ``"above"`` or ``"below"``.
    """
    if side not in ("above", "below"):
        raise ValueError(f"side must be 'above' or 'below', got {side!r}")
    labels = (competitor_labels_above if side == "above" else competitor_labels_below)(
        body_id, columns
    )
    part = partition_footprint(coords, labels)
    if not part.regions:
        return {}

    # Per-hole top/base elevations of the competitor slab.
    # For "above": competitor top = upper span's top_elev; floor = shared body's top_elev.
    # For "below": competitor base = lower span's base_elev; ceiling = shared body's base_elev.
    top_h: dict[str, float] = {}
    base_h: dict[str, float] = {}
    for h in labels:
        for i, s in enumerate(columns[h]):
            if s.body_id != body_id:
                continue
            if side == "above":
                if i == 0:
                    continue  # this occurrence is at the surface (no competitor above)
                # Competitor sits immediately above: index i-1 is the competitor span.
                top_h[h] = columns[h][i - 1].top_elev
                base_h[h] = s.top_elev  # shared body's top is the floor of the competitor slab
            else:
                if i + 1 >= len(columns[h]):
                    continue  # deepest occurrence (no competitor below)
                # Competitor sits immediately below: index i+1 is the competitor span.
                top_h[h] = s.base_elev  # shared body's base is the ceiling of the competitor slab
                base_h[h] = columns[h][i + 1].base_elev
            # no break: match competitor_labels_* which records the deepest occurrence
            # (the single-occurrence case — the only one routed to the facies path — is unaffected).

    holes = sorted(labels)
    hole_index = {h: i for i, h in enumerate(holes)}
    hole_xy = [coords[h] for h in holes]

    # The surface that is CONTINUOUS across every competitor — built once over all
    # labelled holes:
    #   "above" -> the competitor tops (blended so tops meet, owner-confirmed)
    #   "below" -> the shared body's base (the common ceiling)
    top_tin = compute_tin(
        [
            ContactPoint3D(contact_id=h, x_m=coords[h][0], y_m=coords[h][1], elevation_m=top_h[h])
            for h in holes
        ]
    )

    def _sample(
        tin: TinSurface | None,
        hole_z: dict[str, float],
        x: float,
        y: float,
        candidate_idx: list[int] | None = None,
    ) -> float:
        """Sample elevation from a TIN; nearest-hole fallback outside the hull.

        ``tin`` may be ``None`` (an under-constrained competitor with < 3 own
        holes), in which case the nearest-hole fallback is used directly.
        ``candidate_idx`` restricts the fallback pool to a subset of hole indices
        so a "below" competitor floors at its OWN nearest hole, never snapping a
        boundary vertex to a deeper sibling competitor's base.
        """
        z = evaluate_tin_at(tin, x, y) if tin is not None else None
        if z is not None:
            return z
        pool = candidate_idx if candidate_idx is not None else range(len(hole_xy))
        nearest = min(pool, key=lambda k: (hole_xy[k][0] - x) ** 2 + (hole_xy[k][1] - y) ** 2)
        return hole_z[holes[nearest]]

    top_field = {idx: _sample(top_tin, top_h, vx, vy) for idx, (vx, vy) in enumerate(part.vertices)}

    # "above": the floor is the shared body's top — one continuous surface shared
    # by every competitor (built once).  "below": each competitor floors at its OWN
    # base surface (built per competitor in the loop) so a shallow competitor never
    # sags toward a deeper sibling's base at the facies boundary.
    shared_base_field: dict[int, float] | None = None
    if side == "above":
        base_tin = compute_tin(
            [
                ContactPoint3D(
                    contact_id=h, x_m=coords[h][0], y_m=coords[h][1], elevation_m=base_h[h]
                )
                for h in holes
            ]
        )
        shared_base_field = {
            idx: _sample(base_tin, base_h, vx, vy) for idx, (vx, vy) in enumerate(part.vertices)
        }

    # One scan of the columns gives every body's formation id; avoids a full
    # column scan per competitor (defaults to the body id if a span is missing).
    formation_by_body = {s.body_id: s.formation_id for spans in columns.values() for s in spans}

    out: dict[str, LithoBodyMesh] = {}
    for comp, tris in part.regions.items():
        if side == "above":
            assert shared_base_field is not None  # built in the "above" branch above
            base_field = shared_base_field
        else:
            # Per-competitor floor: fit this competitor's OWN base TIN over its own
            # holes and sample its region from it.  Two clamps per vertex:
            #   * floor at/above the competitor's OWN deepest base (a guard rail
            #     that holds even if the sampling strategy changes later), and
            #   * floor at/below the shared-body ceiling (``top_field``) so the
            #     prism never inverts where the continuous shared base dips below
            #     the competitor's own base — it pinches to zero thickness there
            #     instead of producing a self-intersecting solid.
            own = [h for h in holes if labels[h] == comp]
            own_idx = [hole_index[h] for h in own]
            own_deepest_base = min(base_h[h] for h in own)
            comp_tin = (
                compute_tin(
                    [
                        ContactPoint3D(
                            contact_id=h,
                            x_m=coords[h][0],
                            y_m=coords[h][1],
                            elevation_m=base_h[h],
                        )
                        for h in own
                    ]
                )
                if len(own) >= 3
                else None
            )
            base_field = {}
            for v in {p for t in tris for p in t}:
                floor = max(
                    _sample(comp_tin, base_h, *part.vertices[v], candidate_idx=own_idx),
                    own_deepest_base,
                )
                base_field[v] = min(floor, top_field[v])
        mesh = build_prism(
            comp, formation_by_body.get(comp, comp), part.vertices, tris, top_field, base_field
        )
        if mesh.triangles:
            out[comp] = mesh
    return out


def append_void(matrix: LithoBodyMesh, lens: LithoBodyMesh) -> LithoBodyMesh:
    """Return the matrix mesh with the lens appended as an interior void.

    The lens surface is appended with REVERSED winding so its normals point into
    the void (out of the matrix material). The lens and the void wall are the same
    geometry — they tile with zero gap (spike-validated 2026-06-10). The result is
    a closed 2-manifold: the matrix outer shell plus the lens inner shell.

    Parameters
    ----------
    matrix : LithoBodyMesh
        The matrix body's outer solid.
    lens : LithoBodyMesh
        The lens body's closed solid (its surface becomes the cavity wall).

    Returns
    -------
    LithoBodyMesh
        Matrix-with-void.
    """
    n = len(matrix.vertices)
    verts = list(matrix.vertices) + list(lens.vertices)
    # Reverse winding of every lens triangle so its normals point into the void
    # (outward from the material's perspective). Swap a and c to flip orientation.
    tris = list(matrix.triangles) + [(c + n, b + n, a + n) for (a, b, c) in lens.triangles]
    return LithoBodyMesh(
        body_id=matrix.body_id,
        formation_id=matrix.formation_id,
        vertices=verts,
        triangles=tris,
        is_flagged=False,
    )
