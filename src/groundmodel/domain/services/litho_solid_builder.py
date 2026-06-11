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

M3 path (the default): shared surfaces are built ONCE via :mod:`litho_contact_surfaces`
and handed to :func:`assemble_body` (single-patch bodies) or
:func:`build_extent_solid` (matrix bodies with interior lens voids). Enclosed
lenses are carved out as interior voids via :func:`append_void`, so the matrix
mesh is a true hollow shell around the lens — no blob overlap. A body with <3
non-collinear control points cannot fit a TIN and is emitted as small
vertical-cylinder disk markers at its investigations (``is_flagged=True``) so
local units still show in the viewer rather than vanishing (owner directive
2026-06-10). Multi-patch or otherwise un-assemblable bodies fall back to the M2
per-body TIN path (``_legacy_body``) with no behaviour regression.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_body_assembly import (
    _keys_for_body,
    append_void,
    assemble_body,
    assemble_facies_competitors,
    build_extent_solid,
    detect_enclosed_lenses,
    merged_body_extent,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_contact_surfaces import (
    build_columns,
    enumerate_contacts,
    fit_patch_surfaces,
)
from groundmodel.domain.services.litho_mesh_primitives import assemble_closed_solid
from groundmodel.domain.services.litho_solid_builder_constants import (
    MARKER_DISK_MIN_THICKNESS_M,
    MARKER_DISK_RADIUS_M,
    MARKER_DISK_SIDES,
)
from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Re-export BodyLayerPick so callers that import it from this module keep working.
__all__ = ["BodyLayerPick", "build_body_solids"]

logger = LoggerFactory.get_logger(__name__)


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
    :func:`build_body_solids` before calling :func:`assemble_closed_solid`.

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


def _legacy_body(
    body_id: str,
    members: list[BodyLayerPick],
    surface_cache: dict[tuple, tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]],
) -> LithoBodyMesh:
    """Per-body M2 fallback: fit this body's own top+base TINs and close them.

    Used when the M3 shared-surface path cannot build the body (multi-patch
    top/base, or a degenerate <3-pick body → disk markers). Behaviour is
    identical to the original pre-M3 per-body builder.

    Parameters
    ----------
    body_id : str
        Body id.
    members : list[BodyLayerPick]
        The body's member picks.
    surface_cache : dict[tuple, tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]]
        Shared per-call surface cache (passed through to ``_get_surface``).

    Returns
    -------
    LithoBodyMesh
        Closed solid, or disk markers (``is_flagged=True``) if un-triangulable.
    """
    formation_id = members[0].formation_id
    top_raw = [
        (m.investigation_id, m.x_m, m.y_m, m.surface_elev_m - m.top_depth_m) for m in members
    ]
    base_raw = [
        (m.investigation_id, m.x_m, m.y_m, m.surface_elev_m - m.base_depth_m) for m in members
    ]
    top_v, top_t = _get_surface(top_raw, surface_cache)
    base_v, base_t = _get_surface(base_raw, surface_cache)
    if len(top_t) == 0 or len(base_t) == 0 or top_t != base_t:
        logger.warning(
            f"build_body_solids: body {body_id} could not form a solid "
            f"(top_tris={len(top_t)}, base_tris={len(base_t)}, picks={len(members)}); "
            f"emitting disk markers"
        )
        return _disk_markers(body_id, formation_id, members)
    return assemble_closed_solid(body_id, formation_id, top_v, base_v, top_t)


def _concat_meshes(body_id: str, formation_id: str, parts: list[LithoBodyMesh]) -> LithoBodyMesh:
    """Concatenate a body's region-prisms into one mesh (index-offset, multi-component).

    A competitor may contribute a clipped prism for each shared body it competes
    over; this stitches them into a single ``LithoBodyMesh`` per ``body_id`` so the
    geotech stage can extract per-body data. The components are disjoint closed
    solids (each watertight); together they are one mesh keyed by the body.

    Parameters
    ----------
    body_id : str
        Body identifier.
    formation_id : str
        Formation identifier used for colour lookup.
    parts : list[LithoBodyMesh]
        The body's region-prisms (from ``assemble_facies_competitors``).

    Returns
    -------
    LithoBodyMesh
        The concatenated mesh; ``is_flagged`` only if every part was flagged.
        An empty ``parts`` list (never produced by the normal build path) yields
        ``is_flagged=True`` as a defensive sentinel.
    """
    verts: list[tuple[float, float, float]] = []
    tris: list[tuple[int, int, int]] = []
    for m in parts:
        off = len(verts)
        verts.extend(m.vertices)
        tris.extend((a + off, b + off, c + off) for (a, b, c) in m.triangles)
    return LithoBodyMesh(
        body_id=body_id,
        formation_id=formation_id,
        vertices=verts,
        triangles=tris,
        is_flagged=all(m.is_flagged for m in parts) if parts else True,
    )


def build_body_solids(picks: list[BodyLayerPick]) -> list[LithoBodyMesh]:
    """Build one closed mesh per body from its member-layer picks.

    Groups picks by ``body_id``, then follows the M3 assembly path by default:

    * **Single-patch bodies** (common through-going / pinch-out case) — assembled
      from shared surfaces via :func:`assemble_body`. The top/base surfaces are
      fitted once and shared between adjacent bodies, so stacked bodies have
      zero gap at the contact.
    * **Enclosed-lens bodies** — detected by :func:`detect_enclosed_lenses` and
      rendered as their own closed solid; the surrounding matrix is built over the
      merged outer extent and the lens is carved out as an interior void via
      :func:`append_void`.
    * **Facies-competitor bodies** (a body directly above or below a shared body
      that has ≥2 distinct neighbours on that side) — assembled by
      :func:`assemble_facies_competitors` into clipped prisms that partition the
      shared footprint; concatenated into one mesh per competitor via
      :func:`_concat_meshes`.
    * **Fallback (M2 legacy path)** — any body that :func:`assemble_body` /
      :func:`build_extent_solid` cannot handle (multi-patch, degenerate, <3 picks)
      is built by :func:`_legacy_body`, which fits per-body TINs exactly as the
      original M2 builder did. Disk-marker fallback is also preserved here.

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

    # M3: build shared contact surfaces once for the whole model.
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    lens_to_matrix = detect_enclosed_lenses(columns)  # lens_id -> matrix_id
    matrix_to_lenses: dict[str, list[str]] = {}
    for lens_id, mat_id in lens_to_matrix.items():
        matrix_to_lenses.setdefault(mat_id, []).append(lens_id)

    # Build every lens body first (single-patch slabs) so matrices can void them.
    lens_meshes: dict[str, LithoBodyMesh] = {}
    for lens_id in lens_to_matrix:
        members = by_body[lens_id]
        fm = members[0].formation_id
        shared_result = assemble_body(lens_id, fm, columns, surfaces)
        lens_meshes[lens_id] = shared_result or _legacy_body(lens_id, members, surface_cache)
        logger.debug(
            f"[lens] body {lens_id}: {'shared' if shared_result is not None else 'legacy-fallback'}"
        )

    # Facies pass: build the competitors of every multi-patch shared body.
    # A body with >=2 distinct neighbours directly above (or below) is "shared";
    # its competitors are clipped prisms that partition the shared footprint.
    # `facies_meshes` is keyed by COMPETITOR body id (not the shared body id).
    facies_meshes: dict[str, list[LithoBodyMesh]] = {}
    for shared_id in by_body:
        top_keys, base_keys = _keys_for_body(shared_id, columns)
        ups = {k.upper_body for k in top_keys if k.upper_body}
        downs = {k.lower_body for k in base_keys if k.lower_body}
        for side, comp_set in (("above", ups), ("below", downs)):
            if len(comp_set) >= 2:
                result = assemble_facies_competitors(shared_id, side, columns, coords, surfaces)
                for comp, mesh in result.items():
                    facies_meshes.setdefault(comp, []).append(mesh)
                # A competitor with no prism here silently falls through to the M2
                # legacy path below; surface the gap so the regression is visible.
                missing = comp_set - set(result)
                if missing:
                    logger.warning(
                        f"build_body_solids: facies {side} for shared body {shared_id} "
                        f"produced no prism for {len(missing)}/{len(comp_set)} competitor(s) "
                        f"{sorted(missing)}; they fall back to the M2 legacy path"
                    )

    meshes: list[LithoBodyMesh] = []
    for idx, (body_id, members) in enumerate(by_body.items()):
        formation_id = members[0].formation_id
        if body_id in lens_to_matrix:
            # Lens body: already assembled above.
            meshes.append(lens_meshes[body_id])
            path = "lens"
            logger.debug(f"[{idx + 1}/{len(by_body)}] body {body_id}: {path}")
            continue
        if body_id in matrix_to_lenses:
            # Matrix body: build over merged outer extent, then carve lens voids.
            outer = build_extent_solid(
                body_id, formation_id, merged_body_extent(body_id, columns), coords
            )
            mesh = outer if outer is not None else _legacy_body(body_id, members, surface_cache)
            if outer is not None:
                for lid in matrix_to_lenses[body_id]:
                    lens_mesh = lens_meshes.get(lid)
                    # Belt-and-suspenders: every lens in matrix_to_lenses is guaranteed
                    # present in lens_meshes, but the guard protects a future decoupling
                    # of the two build phases.
                    if lens_mesh is not None and not lens_mesh.is_flagged:
                        mesh = append_void(mesh, lens_mesh)
            meshes.append(mesh)
            path = "matrix-void" if outer is not None else "matrix-fallback"
            logger.debug(f"[{idx + 1}/{len(by_body)}] body {body_id}: {path}")
            continue
        if body_id in facies_meshes:
            meshes.append(_concat_meshes(body_id, formation_id, facies_meshes[body_id]))
            logger.debug(f"[{idx + 1}/{len(by_body)}] body {body_id}: facies")
            continue
        # Regular (non-lens) body: prefer the M3 shared-surface path.
        shared = assemble_body(body_id, formation_id, columns, surfaces)
        meshes.append(
            shared if shared is not None else _legacy_body(body_id, members, surface_cache)
        )
        path = "shared" if shared is not None else "legacy-fallback"
        logger.debug(f"[{idx + 1}/{len(by_body)}] body {body_id}: {path}")

    logger.success(
        f"build_body_solids: built {len(meshes)} solid(s) "
        f"({sum(1 for m in meshes if m.is_flagged)} flagged)"
    )
    return meshes


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
