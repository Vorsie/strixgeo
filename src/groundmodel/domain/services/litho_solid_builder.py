"""Build watertight 3D solids for lithostratigraphic bodies (pure domain).

A body's top and base contact picks sit at the SAME investigations (wherever the
body exists), so :func:`compute_tin` over that shared point set yields the same
triangulation topology for both surfaces — the Delaunay triangulation is a
function of the (x, y) positions only, not z. A body mesh is then

    [top faces] + [flipped base faces] + [side walls on the boundary edges]

— a closed watertight 2-manifold, with pinch-outs handled naturally where the
top and base surfaces share the same z at a given investigation (validated by the
2026-06-10 spike). One surface is fitted per CONTACT and cached by its pick-set,
so two bodies sharing a contact (base-of-upper = top-of-lower) reference identical
surface geometry → the stack is watertight by construction.

Lenses build as their own closed blobs that overlap their matrix (the 3D carve is
milestone 3). A body with <3 non-collinear control points cannot fit a TIN and is
emitted as small vertical-cylinder disk markers at its investigations
(``is_flagged=True``) so local units still show in the viewer rather than
vanishing (owner directive 2026-06-10).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from groundmodel.domain.services.litho_solid_builder_constants import (
    MARKER_DISK_MIN_THICKNESS_M,
    MARKER_DISK_RADIUS_M,
    MARKER_DISK_SIDES,
)
from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


@dataclass(frozen=True)
class BodyLayerPick:
    """One member-layer of a body at one investigation.

    Parameters
    ----------
    investigation_id : str
        CPT/borehole id (identity for the (x, y) anchor).
    x_m : float
        World x-coordinate (project CRS).
    y_m : float
        World y-coordinate (project CRS).
    surface_elev_m : float
        Ground/surface elevation at the investigation; depth → elevation
        conversion is ``elevation = surface_elev_m - depth_m``.
    body_id : str
        The body this pick belongs to.
    formation_id : str
        The body's lithology formation.
    top_depth_m : float
        Member layer top depth below ``surface_elev_m``.
    base_depth_m : float
        Member layer base depth below ``surface_elev_m``.
    """

    investigation_id: str
    x_m: float
    y_m: float
    surface_elev_m: float
    body_id: str
    formation_id: str
    top_depth_m: float
    base_depth_m: float


# Internal type alias for a raw (investigation_id, x, y, z) tuple used
# before converting to ContactPoint3D.
_RawPick = tuple[str, float, float, float]


def _surface_key(raw: list[_RawPick]) -> tuple:
    """Stable, order-independent cache key for a contact surface.

    The key is the sorted (investigation_id, rounded_x, rounded_y,
    rounded_z) tuple-of-tuples. Rounding to mm / sub-mm avoids
    floating-point inequality noise while still distinguishing surfaces
    at different depths on the same anchor.
    """
    return tuple(sorted((iv, round(x, 4), round(y, 4), round(z, 6)) for iv, x, y, z in raw))


def _get_surface(
    raw: list[_RawPick],
    cache: dict[tuple, tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]],
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Return (vertices, triangles) for a contact surface, using the cache.

    The Delaunay triangulation is a function of (x, y) only, so any two
    surfaces with the same horizontal point set share the same topology.
    The cache key includes z so each depth-level is stored separately,
    but two surfaces with different z and the same (x, y) will produce
    triangles with identical index patterns — checked in
    :func:`build_body_solids` before calling :func:`_assemble`.

    Parameters
    ----------
    raw : list[_RawPick]
        ``(investigation_id, x_m, y_m, elevation_m)`` tuples.
    cache : dict
        Shared surface cache; mutated in place.

    Returns
    -------
    tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]
        ``(vertices, triangles)`` as produced by :func:`compute_tin`.
    """
    key = _surface_key(raw)
    cached = cache.get(key)
    if cached is not None:
        return cached

    tin = compute_tin(
        [ContactPoint3D(contact_id=iv, x_m=x, y_m=y, elevation_m=z) for iv, x, y, z in raw]
    )
    result: tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]] = (
        list(tin.vertices),
        list(tin.triangles),
    )
    cache[key] = result
    return result


def build_body_solids(picks: list[BodyLayerPick]) -> list[LithoBodyMesh]:
    """Build one closed mesh per body from its member-layer picks.

    Groups picks by ``body_id``, fits a TIN for each contact surface
    (top and base), then assembles the closed solid from the two surfaces
    and their side walls. Bodies whose investigations do not yield a valid
    TIN (<3 non-collinear points) are emitted as disk-marker meshes
    (``is_flagged=True``) — one closed vertical cylinder per pick.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        All accepted member-layer picks across the model (any order).
        Grouped internally by ``body_id``.

    Returns
    -------
    list[LithoBodyMesh]
        One mesh per body. Order matches the iteration order of
        ``body_id`` first-occurrence in ``picks``. Bodies with <3 control
        points are disk-marker meshes (``is_flagged=True``).
    """
    logger.debug(f"build_body_solids: {len(picks)} picks across bodies")

    # Preserve body insertion order so the output is deterministic.
    by_body: dict[str, list[BodyLayerPick]] = {}
    for p in picks:
        by_body.setdefault(p.body_id, []).append(p)

    logger.info(f"build_body_solids: building solids for {len(by_body)} body/bodies")

    # One surface cache per build_body_solids call; shared across bodies
    # so adjacent bodies (base-of-upper == top-of-lower) resolve to the
    # same vertices and triangles.
    surface_cache: dict[
        tuple, tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]
    ] = {}

    meshes: list[LithoBodyMesh] = []
    for idx, (body_id, members) in enumerate(by_body.items()):
        formation_id = members[0].formation_id
        logger.debug(
            f"[{idx + 1}/{len(by_body)}] body {body_id} ({formation_id}): "
            f"{len(members)} member pick(s)"
        )

        top_raw: list[_RawPick] = [
            (m.investigation_id, m.x_m, m.y_m, m.surface_elev_m - m.top_depth_m) for m in members
        ]
        base_raw: list[_RawPick] = [
            (m.investigation_id, m.x_m, m.y_m, m.surface_elev_m - m.base_depth_m) for m in members
        ]

        top_v, top_t = _get_surface(top_raw, surface_cache)
        base_v, base_t = _get_surface(base_raw, surface_cache)

        if len(top_t) == 0 or len(base_t) == 0 or top_t != base_t:
            # Degenerate (<3 non-collinear picks): TIN produces no triangles.
            # Defensively also catches mismatched triangulations that could
            # arise if the alpha-shape trim produces different topology for
            # top vs base (shouldn't happen for horizontal-only TIN, but
            # guard is cheap).
            logger.warning(
                f"build_body_solids: body {body_id} could not form a solid "
                f"(top_tris={len(top_t)}, base_tris={len(base_t)}, picks={len(members)}); "
                f"emitting disk markers"
            )
            meshes.append(_disk_markers(body_id, formation_id, members))
            continue

        mesh = _assemble(body_id, formation_id, top_v, base_v, top_t)
        logger.debug(
            f"build_body_solids: body {body_id} assembled — "
            f"{len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles"
        )
        meshes.append(mesh)

    logger.success(
        f"build_body_solids: built {len(meshes)} solid(s) "
        f"({sum(1 for m in meshes if m.is_flagged)} flagged)"
    )
    return meshes


def _assemble(
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


def _disk_markers(
    body_id: str,
    formation_id: str,
    members: list[BodyLayerPick],
) -> LithoBodyMesh:
    """Fallback for an un-triangulable body: one vertical cylinder per pick.

    Each pick becomes a closed cylinder (top cap + bottom cap + side wall)
    centred at the pick's (x_m, y_m) with radius ``MARKER_DISK_RADIUS_M``
    and height equal to the pick's real thickness, so the unit still shows
    in the 3-D viewer at its actual investigation location and depth extent
    instead of vanishing.

    Multiple cylinders are concatenated into a single mesh with offset
    vertex indices; the result is a set of disjoint closed 2-manifolds,
    which satisfies both the closed-manifold and consistent-winding checks.

    Parameters
    ----------
    body_id : str
        Body identifier.
    formation_id : str
        Formation identifier.
    members : list[BodyLayerPick]
        Member-layer picks for this body (one per investigation).

    Returns
    -------
    LithoBodyMesh
        Disk-marker mesh with ``is_flagged=True``.  Empty if *members* is
        empty (defensive guard).
    """
    if not members:
        return LithoBodyMesh(
            body_id=body_id,
            formation_id=formation_id,
            vertices=[],
            triangles=[],
            is_flagged=True,
        )

    import math  # noqa: PLC0415 — stdlib, import inside function to keep module-level imports clean

    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []

    for pick in members:
        cx, cy = pick.x_m, pick.y_m
        top_elev = pick.surface_elev_m - pick.top_depth_m
        base_elev = pick.surface_elev_m - pick.base_depth_m

        # Enforce minimum thickness — expand symmetrically about the mid-elevation
        # so a zero-thickness pick still renders a visible sliver in the viewer.
        thickness = top_elev - base_elev
        if thickness < MARKER_DISK_MIN_THICKNESS_M:
            mid = (top_elev + base_elev) / 2.0
            top_elev = mid + MARKER_DISK_MIN_THICKNESS_M / 2.0
            base_elev = mid - MARKER_DISK_MIN_THICKNESS_M / 2.0

        n = MARKER_DISK_SIDES
        offset = len(vertices)

        # Vertex layout (per cylinder):
        #   offset + 0              → top cap centre
        #   offset + 1 .. n         → top rim (CCW from above)
        #   offset + n+1 .. 2n      → bottom rim (same angular order as top)
        #   offset + 2n+1           → bottom cap centre
        vertices.append((cx, cy, top_elev))  # top centre (index offset + 0)
        for k in range(n):
            angle = 2.0 * math.pi * k / n
            vx = cx + MARKER_DISK_RADIUS_M * math.cos(angle)
            vy = cy + MARKER_DISK_RADIUS_M * math.sin(angle)
            vertices.append((vx, vy, top_elev))  # top rim (offset + 1 .. n)
        for k in range(n):
            angle = 2.0 * math.pi * k / n
            vx = cx + MARKER_DISK_RADIUS_M * math.cos(angle)
            vy = cy + MARKER_DISK_RADIUS_M * math.sin(angle)
            vertices.append((vx, vy, base_elev))  # bottom rim (offset + n+1 .. 2n)
        vertices.append((cx, cy, base_elev))  # bottom centre (index offset + 2n+1)

        # Convenient index aliases (absolute).
        top_c = offset + 0
        top_r = [offset + 1 + k for k in range(n)]
        bot_r = [offset + n + 1 + k for k in range(n)]
        bot_c = offset + 2 * n + 1

        for k in range(n):
            nk = (k + 1) % n

            # Top cap fan: outward normal = +z (CCW from above).
            # Winding: (centre, next_rim, this_rim) → CCW when viewed from +z.
            triangles.append((top_c, top_r[nk], top_r[k]))

            # Bottom cap fan: outward normal = -z (CW from above = CCW from below).
            # Winding: (centre, this_rim, next_rim) → CW from above → outward down.
            triangles.append((bot_c, bot_r[k], bot_r[nk]))

            # Side wall quad (two triangles, outward normal = radially outward).
            # CCW order from outside: top_r[k] → top_r[nk] → bot_r[nk] → bot_r[k].
            triangles.append((top_r[k], top_r[nk], bot_r[nk]))
            triangles.append((top_r[k], bot_r[nk], bot_r[k]))

    return LithoBodyMesh(
        body_id=body_id,
        formation_id=formation_id,
        vertices=vertices,
        triangles=triangles,
        is_flagged=True,
    )
