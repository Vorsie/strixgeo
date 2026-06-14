"""Stage 4 of the implicit stratigraphic field builder: shared isosurface extraction.

This module extracts each litho contact surface ONCE from the fitted potential
field (Stage 3) by sampling the field on a regular 3D grid inside the model
block and running marching cubes at the horizon's iso-value.  Because every
contact is the single isosurface ``F = iso_value(rank)`` of one shared field,
the surface emitted here is the SAME geometry the body above the contact uses
for its base and the body below uses for its top.  Stage 5 references this one
:class:`ContactSurface` for both bodies — that shared reference is the
watertight lever: there is exactly one wall between two stacked bodies, so they
cannot leave a gap or overlap by construction.

This module is purely functional compute — no I/O, no logging, no framework
dependencies.  It depends on NumPy + scikit-image's marching cubes.

What Stage 4 does and does NOT do
---------------------------------
* It extracts the INTERIOR horizons only (rank 1 .. N-1).  Rank 0 (the model's
  top surface) and rank N (the floor) are domain CAPS — they are not contacts
  between two litho units; their geometry is the DEM top and the deep base,
  which Stage 5 builds from the model domain, not from an iso-level of ``F``.
* It clips each surface to the block's horizontal footprint polygon (the grid
  is the polygon's bounding box, which may extend past the polygon on a
  non-rectangular hull).
* It does NOT cap the surfaces to the DEM top / deep base, and does NOT close
  them into solids — that is Stage 5's job.

Grid / coordinate convention (load-bearing)
-------------------------------------------
The grid is built with ``numpy.meshgrid(..., indexing="ij")`` so that
``volume[i, j, k]`` is ``F`` at ``(x[i], y[j], z[k])``.  marching cubes then
returns vertices in ``(i*dx, j*dy, k*dz)`` coordinates RELATIVE to the grid
origin ``(x[0], y[0], z[0])``; adding the origin maps them to world
coordinates.  This (volume axis order ↔ grid axis order ↔ spacing ↔ origin)
chain is pinned by a dedicated unit test (a flat-by-construction known iso must
land at the analytically-expected world z); a transposed volume or a dropped
origin offset would silently mangle every surface.
"""

from __future__ import annotations

import numpy as np
from skimage.measure import marching_cubes

from groundmodel.domain.services.strat_field.iso_surface_constants import (
    ISO_SURFACE_SMOOTH_ITERATIONS,
)
from groundmodel.domain.services.strat_field.potential_field import (
    PotentialField,
    _point_in_polygon,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    ContactSurface,
    StratColumn,
)


def extract_isosurfaces(
    field: PotentialField,
    order: StratColumn,
    grid_spacing_m: float,
    domain: Block,
) -> list[ContactSurface]:
    """Extract every interior contact as a shared isosurface of the potential field.

    Samples ``field`` once on a regular 3D grid spanning ``domain`` (the
    polygon's xy bounding box × ``[z_min, z_max]``) at ``grid_spacing_m``
    resolution, then runs marching cubes at each interior horizon's iso-value.
    Each resulting surface is clipped to the domain polygon, optionally smoothed
    (cosmetic only), and emitted as one :class:`ContactSurface`.

    A single grid evaluation is reused for every horizon — the field is the
    expensive object to sample, and every contact is just a different iso-level
    of the SAME field, so the volume is built once and cached locally.

    Parameters
    ----------
    field : PotentialField
        The fitted Stage-3 potential field.  ``field.evaluate`` is called once
        on the full grid.
    order : StratColumn
        The stratigraphic column.  Supplies each interior horizon's rank and
        ``iso_value`` (the marching-cubes level).  Rank 0 (surface) and rank N
        (floor) are skipped — they are domain caps, not inter-unit contacts.
    grid_spacing_m : float
        Target spacing of the regular grid, in metres.  The actual per-axis step
        may differ slightly because ``numpy.linspace`` is used so the block
        extents are hit exactly (endpoint-inclusive); the difference is at most
        one cell over the axis length and is immaterial to the extracted
        geometry.
    domain : Block
        The model block.  ``domain.polygon``'s xy bounding box sets the grid's
        horizontal extent; ``domain.z_min`` / ``domain.z_max`` set the vertical
        extent.  Surfaces are clipped to ``domain.polygon`` (triangles whose
        plan-view centroid falls outside the polygon are dropped).

    Returns
    -------
    list of ContactSurface
        One surface per interior horizon that produced at least one triangle
        inside the domain polygon, in ascending rank order.  A horizon whose
        iso-value is not spanned by the sampled field (a fully pinched-out /
        absent contact) is OMITTED — marching cubes raises
        ``ValueError("Surface level must be within volume data range")`` for it,
        which is caught and treated as "no surface here".  A horizon whose
        surface survives extraction but is entirely clipped away (no triangle's
        centroid is inside the polygon) is also omitted.

    Notes
    -----
    The output order is deterministic: horizons ascend by rank, and within a
    surface the vertex/triangle order is exactly what marching cubes produces
    (it is deterministic for a fixed volume + level) followed by the
    compaction's stable re-indexing.
    """
    # ------------------------------------------------------------------
    # Step 1: build the regular grid over the block's xy bounding box × z-range.
    #
    # linspace (not arange) so the block extents are hit EXACTLY at both ends;
    # the per-axis step then differs slightly from grid_spacing_m, which is fine
    # (the surface geometry is governed by the field, not the exact step).  At
    # least 2 samples per axis are required for marching cubes to have a cell.
    # ------------------------------------------------------------------
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    z_min, z_max = domain.z_min, domain.z_max

    nx = max(2, int(round((x_max - x_min) / grid_spacing_m)) + 1)
    ny = max(2, int(round((y_max - y_min) / grid_spacing_m)) + 1)
    nz = max(2, int(round((z_max - z_min) / grid_spacing_m)) + 1)

    x = np.linspace(x_min, x_max, nx)
    y = np.linspace(y_min, y_max, ny)
    z = np.linspace(z_min, z_max, nz)
    dx = x[1] - x[0]
    dy = y[1] - y[0]
    dz = z[1] - z[0]

    # ------------------------------------------------------------------
    # Step 2: evaluate F on every grid point ONCE, reshaped to volume[i,j,k].
    #
    # indexing="ij" makes volume[i,j,k] correspond to (x[i], y[j], z[k]); this
    # axis order MUST match the spacing/origin mapping used below when converting
    # marching-cubes verts to world coordinates.
    # ------------------------------------------------------------------
    grid_x, grid_y, grid_z = np.meshgrid(x, y, z, indexing="ij")
    points = np.column_stack((grid_x.ravel(), grid_y.ravel(), grid_z.ravel()))
    # reason: evaluate() is typed for Sequence[tuple] but does np.asarray() on its
    # input, so an (N, 3) ndarray is the intended fast path; the static type is
    # narrower than the runtime contract.
    volume = field.evaluate(points).reshape(nx, ny, nz)  # type: ignore[arg-type]

    origin = np.array([x_min, y_min, z_min], dtype=float)
    spacing = (float(dx), float(dy), float(dz))

    # ------------------------------------------------------------------
    # Step 3: extract each INTERIOR horizon (rank 1 .. N-1) at its iso-value.
    # ------------------------------------------------------------------
    # The floor is the highest rank; ask the column for it rather than deriving
    # it from the horizon count, so this does not silently couple to Stage 1's
    # contiguous-rank assignment convention.
    floor_rank = max((h.rank for h in order.horizons), default=0)

    surfaces: list[ContactSurface] = []
    for horizon in sorted(order.horizons, key=lambda h: h.rank):
        rank = horizon.rank
        # Skip the surface (rank 0) and the floor (rank N): those are domain caps,
        # built from the DEM top / deep base in Stage 5, not iso-levels of F.
        if not (1 <= rank < floor_rank):
            continue

        surface = _extract_one_horizon(
            volume=volume,
            level=horizon.iso_value,
            spacing=spacing,
            origin=origin,
            polygon=domain.polygon,
            horizon_rank=rank,
        )
        if surface is not None:
            surfaces.append(surface)

    return surfaces


def _extract_one_horizon(
    volume: np.ndarray,
    level: float,
    spacing: tuple[float, float, float],
    origin: np.ndarray,
    polygon: tuple[tuple[float, float], ...],
    horizon_rank: int,
) -> ContactSurface | None:
    """Run marching cubes for one horizon, clip to the polygon, smooth, and emit.

    Parameters
    ----------
    volume : numpy.ndarray
        The shared ``(nx, ny, nz)`` field volume, ``volume[i,j,k] = F(x[i],y[j],z[k])``.
    level : float
        The iso-value (marching-cubes level) of this horizon.
    spacing : tuple of float
        ``(dx, dy, dz)`` grid step per axis.
    origin : numpy.ndarray
        ``(x_min, y_min, z_min)`` world coordinate of ``volume[0,0,0]``.
    polygon : tuple of (float, float)
        The domain footprint polygon to clip to.
    horizon_rank : int
        The rank tag for the emitted :class:`ContactSurface`.

    Returns
    -------
    ContactSurface or None
        The extracted, clipped, optionally-smoothed surface, or ``None`` when the
        iso-value is outside the volume's value range (a pinched-out / absent
        contact) or when every triangle is clipped away.
    """
    try:
        # reason: skimage types marching_cubes' return as Incomplete, so mypy reads
        # the call as untyped; the unpacking below is the documented 4-tuple shape.
        verts, faces, _normals, _values = marching_cubes(  # type: ignore[no-untyped-call]
            volume, level=level, spacing=spacing
        )
    except ValueError:
        # The iso-value is outside [volume.min(), volume.max()] — this horizon's
        # contact is not present anywhere in the sampled block (fully pinched out
        # / absent).  It legitimately produces no surface; skip it.  (Pure
        # function: documented here, not logged.)
        return None

    # Map vertices from grid-relative (i*dx, j*dy, k*dz) to world coords by adding
    # the grid origin.  verts columns are already (x, y, z) because the volume was
    # built with indexing="ij" (axis 0 = x, axis 1 = y, axis 2 = z).
    world = verts + origin

    # Clip to the domain polygon: drop any triangle whose plan-view centroid lies
    # outside the footprint.  Using the centroid (not all 3 corners) keeps a
    # triangle that straddles the boundary, which avoids serrating the clipped
    # edge; the grid bounding box only over-covers a non-rectangular hull by a
    # margin, so a centroid test is the right granularity here.
    kept_faces: list[tuple[int, int, int]] = []
    for tri in faces:
        i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
        cx = (world[i0, 0] + world[i1, 0] + world[i2, 0]) / 3.0
        cy = (world[i0, 1] + world[i1, 1] + world[i2, 1]) / 3.0
        if _point_in_polygon(cx, cy, polygon):
            kept_faces.append((i0, i1, i2))

    if not kept_faces:
        # Every triangle was outside the polygon — no surface here.
        return None

    # Compact the mesh: drop vertices no surviving triangle references and
    # re-index the faces against the compacted vertex list.  Deterministic:
    # vertices are emitted in ascending original-index order.
    used_indices = sorted({idx for tri in kept_faces for idx in tri})
    remap = {old: new for new, old in enumerate(used_indices)}
    compact_vertices = [
        (float(world[old, 0]), float(world[old, 1]), float(world[old, 2])) for old in used_indices
    ]
    compact_faces = [(remap[i0], remap[i1], remap[i2]) for (i0, i1, i2) in kept_faces]

    # Optional cosmetic Laplacian smoothing (topology-preserving — positions
    # only, faces untouched).
    smoothed_vertices = _laplacian_smooth(
        compact_vertices, compact_faces, ISO_SURFACE_SMOOTH_ITERATIONS
    )

    return ContactSurface(
        horizon_rank=horizon_rank,
        vertices=smoothed_vertices,
        triangles=compact_faces,
    )


def _laplacian_smooth(
    vertices: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
    iterations: int,
) -> list[tuple[float, float, float]]:
    """Apply topology-preserving umbrella-operator Laplacian smoothing.

    Each pass moves every vertex to the average position of its edge-neighbours
    (the umbrella operator).  Triangles are NEVER modified — only vertex
    positions change — so the surface's connectivity, and its watertight-sharing
    role in Stage 5, is preserved exactly.

    Parameters
    ----------
    vertices : list of (float, float, float)
        The world-coordinate vertex positions to smooth.
    triangles : list of (int, int, int)
        Vertex-index triples defining the mesh edges (each triangle contributes
        three undirected edges).
    iterations : int
        Number of smoothing passes.  ``0`` returns the input unchanged.

    Returns
    -------
    list of (float, float, float)
        The smoothed vertex positions (a fresh list; the input is not mutated).
    """
    if iterations <= 0 or not vertices:
        return list(vertices)

    # Build the neighbour adjacency once (it does not change — only positions do).
    neighbours: list[set[int]] = [set() for _ in vertices]
    for a, b, c in triangles:
        neighbours[a].update((b, c))
        neighbours[b].update((a, c))
        neighbours[c].update((a, b))

    coords = np.array(vertices, dtype=float)
    for _ in range(iterations):
        updated = coords.copy()
        for v, neigh in enumerate(neighbours):
            if not neigh:
                # Isolated vertex (no incident edge) — leave it where it is.
                continue
            neigh_idx = list(neigh)
            updated[v] = coords[neigh_idx].mean(axis=0)
        coords = updated

    return [(float(p[0]), float(p[1]), float(p[2])) for p in coords]
