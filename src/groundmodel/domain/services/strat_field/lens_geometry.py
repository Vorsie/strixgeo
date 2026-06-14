"""Task-5a domain helper: build per-lens carve inputs from the lens's own picks.

This is the pure-geometry bridge between the enclosure classifier
(:func:`~groundmodel.domain.services.strat_field.lens_classification.classify_lenses`,
which says WHICH bodies are lenses + their host + nesting depth) and the lens
carver (:func:`~groundmodel.domain.services.strat_field.lens_carving.carve_lenses`,
which needs each lens's top/base SURFACES + footprint over the shared build grid).

Why a separate stage
--------------------
The matrix potential field carries NO iso for an enclosed lens — Stage 1 ordered
only the conformable matrix backbone, so the lens has no place in the single global
iso-order.  Its vertical extent therefore cannot come from the field; it must come
from the lens's OWN picks.  This module fits a smooth top surface and a smooth base
surface through the lens body's picks, evaluated over the SAME grid the matrix
bodies were assembled on, so the carved lens prism welds to its host node-for-node.

Surface interpolation (and why the coordinates are normalised)
--------------------------------------------------------------
Each lens pick contributes a control point ``(x, y, z_top)`` and ``(x, y, z_base)``
where ``z = surface_elev_m - depth_m``.  With ≥ 3 non-collinear picks the surfaces
are fit with the SAME cubic-polyharmonic RBF the potential field uses
(``kernel="cubic"``, ``degree=-1``, ``RBF_SMOOTHING``), but here as a 2-D height
field ``z = f(x, y)`` rather than a 3-D scalar field.  The control coordinates are
ISOTROPICALLY NORMALISED (centroid + max-half-extent) BEFORE fitting — the memory
lesson ``project_strat_field_3d_builder`` records that the cubic RBF EXPLODES on raw
Lambert-72 magnitude coordinates (x ≈ 150 000 m) with wide borehole spacing, and the
normalisation that the potential field applies is what keeps the fit bounded.  The
same 2-D normalisation is reused here (a 2-D restriction of
``potential_field._normalization_transform``).

With FEWER than 3 picks a surface cannot be interpolated, so the helper falls back
to a FLAT PLANE at the mean ``z_top`` / mean ``z_base`` of the available picks (the
lens still appears, watertight, at a constant elevation near its picks).

Footprint rule
--------------
The footprint is the set of grid nodes inside the lens picks' CONVEX HULL AND inside
the domain polygon.  A lens present at only 1–2 investigations (or with collinear
picks) has no 2-D hull, so the footprint falls back to a small disc of the grid
nodes nearest each pick (radius ≈ one grid cell): the lens APPEARS, watertight, in
the immediate neighbourhood of where it was observed.  The footprint is always
intersected with ``node_inside`` so the lens never pokes outside the model hull.

Depth-2 parent mapping
----------------------
A depth-2 lens (lens-in-lens) must carve its ENCLOSING LENS prism, not the matrix,
so its ``host_body_id`` must be the parent lens's EMITTED id
(``f"lens:{host}:{tail}"``), not the parent's resolver ``instance_key``.  Lenses are
processed in ASCENDING ``nesting_depth`` and an ``{instance_key: emitted_body_id}``
map is accumulated as each carve input is built, so a depth-2 lens resolves its
parent's emitted id from a depth-1 lens processed earlier.

This module is purely functional compute — no I/O, no logging, no framework
dependencies.  It depends only on NumPy + SciPy.
"""

from __future__ import annotations

import numpy as np

# reason: scipy ships no type stubs; the rest of the domain (potential_field,
# body_assembly, model_domain) uses the same narrow per-import ignore.
from scipy.interpolate import RBFInterpolator  # type: ignore[import-untyped]
from scipy.spatial import ConvexHull, QhullError  # type: ignore[import-untyped]

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.strat_field.body_assembly import build_shared_grid
from groundmodel.domain.services.strat_field.lens_carving import LensCarveInput
from groundmodel.domain.services.strat_field.lens_types import LensPartition
from groundmodel.domain.services.strat_field.potential_field import point_in_polygon
from groundmodel.domain.services.strat_field.potential_field_constants import (
    RBF_KERNEL,
    RBF_NORMALIZE,
    RBF_SMOOTHING,
)
from groundmodel.domain.services.strat_field.strat_types import Block

# Polynomial-tail degree for the 2-D lens-surface RBF.  This is DELIBERATELY 1
# (a linear tail), NOT the potential field's ``RBF_DEGREE = -1``.  The potential
# field fits a 3-D SCALAR field where map-collinear boreholes would make a linear
# tail singular, so it forgoes the tail.  Here the fit is a 2-D height surface
# ``z = f(x, y)`` through ≥ 3 NON-collinear picks (collinearity is handled by the
# flat-plane fallback before we get here), and a linear tail is what lets the cubic
# RBF reproduce a planar / gently-dipping lens exactly — with ``degree=-1`` a flat
# 3-pick lens droops to a fraction of its true elevation at the triangle interior
# (measured), which would carve the lens far below where it was observed.
_LENS_SURFACE_RBF_DEGREE: int = 1

# Minimum lens thickness (metres) enforced at every footprint node so the carved
# prism is never degenerate (z_base must be strictly below z_top).  Where the
# interpolated base meets or exceeds the top — a steep / sparse lens whose smooth
# surfaces cross — the base is pulled down to ``z_top - _MIN_LENS_THICKNESS_M``.
# 1 cm is well below contact resolution and clears float-accumulation noise.
_MIN_LENS_THICKNESS_M: float = 0.01

# Footprint disc radius, in grid cells, for the sparse (< 3-pick / no-hull) lens
# fallback.  Each observed pick claims the grid nodes within this many cells of it,
# so a single-investigation lens still gets a small but non-empty footprint around
# the column where it was seen.
_SPARSE_FOOTPRINT_RADIUS_CELLS: float = 1.5


def build_lens_carve_inputs(
    partition: LensPartition,
    picks_by_body: dict[str, list[BodyLayerPick]],
    domain: Block,
    grid_spacing_m: float,
) -> list[LensCarveInput]:
    """Build one :class:`LensCarveInput` per lens from the lenses' own picks.

    For each lens in ``partition.lenses`` (processed ascending ``nesting_depth``
    so a depth-2 lens can resolve its parent's emitted id), fits a top surface
    and a base surface through the lens body's picks over the shared build grid,
    derives a node footprint from the picks' convex hull (∩ the domain), and
    enforces a strictly-positive lens thickness.  The host id for a depth-1 lens
    is its matrix host's ``instance_key``; for a deeper lens it is the parent
    lens's EMITTED prism id (``f"lens:{host}:{tail}"``).

    The output order is deterministic — lenses sorted by ``(nesting_depth,
    body_id)`` — so the carve order + the build checksum are stable.

    Parameters
    ----------
    partition : LensPartition
        The matrix/lens split from
        :func:`~groundmodel.domain.services.strat_field.lens_classification.classify_lenses`.
        Only its ``lenses`` drive this helper; ``matrix_body_ids`` is used only to
        look up a depth-1 lens's host formation.
    picks_by_body : dict of str to list of BodyLayerPick
        Every body's member-layer picks, keyed by ``body_id``.  A lens body's
        picks supply its surface control points; the host body's picks supply the
        host lithology stamped on the carved host pieces.
    domain : Block
        The model block — its polygon + ``grid_spacing_m`` rebuild the EXACT
        shared grid the matrix bodies were assembled on, so the lens surfaces
        weld to the host node-for-node.
    grid_spacing_m : float
        The build grid spacing in metres (same value the matrix assembly used).

    Returns
    -------
    list of LensCarveInput
        One carve input per lens, in ``(nesting_depth, body_id)`` order.  Empty
        when the partition has no lenses.

    Raises
    ------
    KeyError
        If a lens body has no entry in ``picks_by_body`` (a classification /
        pick-load mismatch — the lens was classified from columns that the pick
        set does not back).
    """
    if not partition.lenses:
        return []

    gx, gy, node_inside = build_shared_grid(domain, grid_spacing_m)

    # The map from a lens body's resolver instance_key to its EMITTED prism id,
    # accumulated as we go (ascending nesting_depth) so a depth-2 lens resolves
    # its depth-1 parent's emitted id.  A formation lookup is built once so the
    # host formation (depth-1 = matrix host; deeper = parent lens) is available.
    emitted_by_body: dict[str, str] = {}
    formation_by_body = {
        body_id: picks[0].formation_id for body_id, picks in picks_by_body.items() if picks
    }

    inputs: list[LensCarveInput] = []
    # Deterministic order: shallowest first (so parents precede children), then
    # by body_id — the same key the carver re-sorts on, so the two agree.
    for lens in sorted(partition.lenses, key=lambda L: (L.nesting_depth, L.body_id)):
        lens_picks = picks_by_body[lens.body_id]

        # Host id: a depth-1 lens carves its matrix host directly (its
        # instance_key); a deeper lens carves the parent lens's EMITTED prism.
        if lens.nesting_depth <= 1:
            host_body_id = lens.host_body_id
        else:
            host_body_id = emitted_by_body[lens.host_body_id]
        host_formation_id = formation_by_body.get(lens.host_body_id, "")

        z_top, z_base = _lens_surfaces(lens_picks, gx, gy)
        footprint = _lens_footprint(lens_picks, gx, gy, node_inside)
        # Enforce a strictly-positive thickness over the footprint so the carved
        # prism never degenerates (smooth surfaces can cross on a steep lens).
        z_base = np.where(
            footprint & (z_base >= z_top - _MIN_LENS_THICKNESS_M),
            z_top - _MIN_LENS_THICKNESS_M,
            z_base,
        )

        carve_input = LensCarveInput(
            host_body_id=host_body_id,
            host_formation_id=host_formation_id,
            lens_body_id=lens.body_id,
            lens_formation_id=formation_by_body.get(lens.body_id, ""),
            z_top=z_top,
            z_base=z_base,
            footprint=footprint,
            nesting_depth=lens.nesting_depth,
        )
        inputs.append(carve_input)
        emitted_by_body[lens.body_id] = carve_input.emitted_body_id

    return inputs


def _lens_surfaces(
    picks: list[BodyLayerPick],
    gx: np.ndarray,
    gy: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Interpolate the lens top + base elevation surfaces over the shared grid.

    Each pick gives a top control point ``(x, y, surface - top_depth)`` and a
    base control point ``(x, y, surface - base_depth)``.  With ≥ 3 non-collinear
    picks both surfaces are fit with the cubic-polyharmonic RBF (coordinates
    isotropically normalised first — the explosion guard); with fewer picks (or
    a degenerate / collinear set the RBF cannot solve) each surface falls back to
    a FLAT PLANE at the mean elevation.

    Parameters
    ----------
    picks : list of BodyLayerPick
        The lens body's member-layer picks (≥ 1).
    gx, gy : numpy.ndarray
        Shared grid node coordinates (``(nx,)`` and ``(ny,)``).

    Returns
    -------
    (numpy.ndarray, numpy.ndarray)
        ``z_top`` and ``z_base`` height fields, each ``(nx, ny)``, evaluated at
        every grid node.
    """
    xy = np.array([(p.x_m, p.y_m) for p in picks], dtype=float)
    z_top_ctrl = np.array([p.surface_elev_m - p.top_depth_m for p in picks], dtype=float)
    z_base_ctrl = np.array([p.surface_elev_m - p.base_depth_m for p in picks], dtype=float)

    nx, ny = len(gx), len(gy)
    grid = np.array([(float(gx[i]), float(gy[j])) for i in range(nx) for j in range(ny)])

    z_top = _fit_surface(xy, z_top_ctrl, grid).reshape(nx, ny)
    z_base = _fit_surface(xy, z_base_ctrl, grid).reshape(nx, ny)
    return z_top, z_base


def _fit_surface(xy: np.ndarray, z: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Fit one elevation surface ``z = f(x, y)`` and evaluate it at ``grid``.

    Uses the cubic-polyharmonic RBF (the same kernel the potential field uses)
    with a LINEAR polynomial tail (``_LENS_SURFACE_RBF_DEGREE``, so a planar /
    gently-dipping lens reproduces exactly) on ISOTROPICALLY NORMALISED 2-D
    coordinates when ≥ 3 control points are available and the RBF solves;
    otherwise (too few points, or a singular / collinear configuration the RBF
    rejects) returns a FLAT PLANE at the mean ``z``.  Normalisation is mandatory —
    raw Lambert-72 magnitude coordinates make the cubic RBF explode (memory
    ``project_strat_field_3d_builder``).

    Parameters
    ----------
    xy : numpy.ndarray
        ``(N, 2)`` control-point map coordinates.
    z : numpy.ndarray
        ``(N,)`` control-point elevations.
    grid : numpy.ndarray
        ``(M, 2)`` query node coordinates.

    Returns
    -------
    numpy.ndarray
        ``(M,)`` interpolated elevation at every query node.
    """
    mean_z = float(np.mean(z))
    if len(xy) < 3:
        # Too few picks to fit a surface — a flat plane at the mean elevation.
        return np.full(grid.shape[0], mean_z, dtype=float)

    center, scale = _normalization_transform_2d(xy)
    xy_fit = (xy - center) / scale
    grid_fit = (grid - center) / scale
    try:
        interp = RBFInterpolator(
            xy_fit,
            z,
            kernel=RBF_KERNEL,
            degree=_LENS_SURFACE_RBF_DEGREE,
            smoothing=RBF_SMOOTHING,
        )
    except (np.linalg.LinAlgError, ValueError):
        # A collinear / singular control set the cubic RBF cannot solve — fall
        # back to the flat plane rather than fail the whole build.
        return np.full(grid.shape[0], mean_z, dtype=float)
    return np.asarray(interp(grid_fit), dtype=float).ravel()


def _normalization_transform_2d(xy: np.ndarray) -> tuple[np.ndarray, float]:
    """Derive the isotropic centre + scale for a 2-D control cloud.

    The 2-D restriction of
    :func:`~groundmodel.domain.services.strat_field.potential_field._normalization_transform`:
    centre at the centroid, scale by the maximum per-axis half-extent (ISOTROPIC,
    so the x:y aspect ratio is preserved and a near-collinear cloud degenerates
    gracefully).  Fully deterministic so the build is reproducible.

    Parameters
    ----------
    xy : numpy.ndarray
        ``(N, 2)`` control-point coordinates (at least one point).

    Returns
    -------
    (numpy.ndarray, float)
        ``(center, scale)``: a 2-element centroid and a strictly-positive scalar
        length (``1.0`` when the cloud has zero spread).
    """
    if not RBF_NORMALIZE:
        return np.zeros(2, dtype=float), 1.0
    center = xy.mean(axis=0)
    half_extent = float(np.max(np.abs(xy - center)))
    scale = half_extent if half_extent > 0.0 else 1.0
    return center, scale


def _lens_footprint(
    picks: list[BodyLayerPick],
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> np.ndarray:
    """Build the lens node footprint: inside the picks' hull AND inside the domain.

    With ≥ 3 non-collinear picks the footprint is the set of grid nodes inside
    the picks' CONVEX HULL polygon (intersected with ``node_inside`` so the lens
    never pokes outside the model hull).  With fewer picks (or collinear picks
    that have no 2-D hull) the footprint falls back to a small disc of the grid
    nodes nearest each pick (radius ≈ ``_SPARSE_FOOTPRINT_RADIUS_CELLS`` cells),
    so a lens seen at one or two investigations still appears near where it was
    observed.

    Parameters
    ----------
    picks : list of BodyLayerPick
        The lens body's member-layer picks (≥ 1).
    gx, gy : numpy.ndarray
        Shared grid node coordinates.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-domain-polygon mask for the shared grid.

    Returns
    -------
    numpy.ndarray
        ``(nx, ny)`` bool footprint mask, always a subset of ``node_inside``.
    """
    nx, ny = len(gx), len(gy)
    pts = np.array([(p.x_m, p.y_m) for p in picks], dtype=float)

    hull_polygon = _convex_hull_polygon(pts)
    if hull_polygon is not None:
        footprint = np.zeros((nx, ny), dtype=bool)
        for i in range(nx):
            for j in range(ny):
                if point_in_polygon(float(gx[i]), float(gy[j]), hull_polygon):
                    footprint[i, j] = True
        result: np.ndarray = footprint & node_inside
        if result.any():
            return result
        # The hull was so thin no node fell inside — fall through to the disc.

    # Sparse / degenerate fallback: claim the grid nodes nearest each pick.
    return _disc_footprint(pts, gx, gy, node_inside)


def _convex_hull_polygon(pts: np.ndarray) -> list[tuple[float, float]] | None:
    """Return the convex-hull ring of ``pts`` as a polygon, or ``None`` if degenerate.

    Parameters
    ----------
    pts : numpy.ndarray
        ``(N, 2)`` map coordinates.

    Returns
    -------
    list of (float, float) or None
        The hull ring (counter-clockwise, no repeated last vertex), or ``None``
        when fewer than 3 points or the points are collinear (no 2-D hull).
    """
    if len(pts) < 3:
        return None
    try:
        hull = ConvexHull(pts)
    except QhullError:
        # Collinear / coincident points — no 2-D hull.
        return None
    return [(float(pts[v, 0]), float(pts[v, 1])) for v in hull.vertices]


def _disc_footprint(
    pts: np.ndarray,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> np.ndarray:
    """Footprint of grid nodes within a small disc of each pick (sparse fallback).

    Each pick claims the grid nodes within ``_SPARSE_FOOTPRINT_RADIUS_CELLS``
    grid cells of it, so a lens observed at only one or two investigations still
    gets a non-empty footprint near its picks.  Always intersected with
    ``node_inside``.

    Parameters
    ----------
    pts : numpy.ndarray
        ``(N, 2)`` pick coordinates.
    gx, gy : numpy.ndarray
        Shared grid node coordinates.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-domain mask.

    Returns
    -------
    numpy.ndarray
        ``(nx, ny)`` bool footprint mask (subset of ``node_inside``).
    """
    nx, ny = len(gx), len(gy)
    # A characteristic cell size from the grid step (linspace is uniform).
    dx = float(gx[1] - gx[0]) if nx > 1 else 1.0
    dy = float(gy[1] - gy[0]) if ny > 1 else 1.0
    radius = _SPARSE_FOOTPRINT_RADIUS_CELLS * max(dx, dy, 1e-9)

    footprint = np.zeros((nx, ny), dtype=bool)
    for px, py in pts:
        for i in range(nx):
            for j in range(ny):
                if (gx[i] - px) ** 2 + (gy[j] - py) ** 2 <= radius**2:
                    footprint[i, j] = True
    result: np.ndarray = footprint & node_inside
    return result
