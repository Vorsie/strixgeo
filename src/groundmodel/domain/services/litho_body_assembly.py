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

from groundmodel.domain.services.litho_contact_surfaces import (
    ContactKey,
    LayerSpan,
    Surface,
)
from groundmodel.domain.services.litho_solid_builder import _assemble  # reuse M2 walls
from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh


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
    return _assemble(body_id, formation_id, top_v, base_v, top_t)


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
    ``_assemble``.

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
    if not top.triangles or top.triangles != base.triangles:
        return None
    return _assemble(
        body_id, formation_id, list(top.vertices), list(base.vertices), list(top.triangles)
    )


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
