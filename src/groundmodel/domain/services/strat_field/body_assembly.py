"""Stage 5 of the implicit stratigraphic field builder: watertight body assembly.

This module closes each lithostratigraphic band into a WATERTIGHT 3-D solid so
the bodies TILE the model domain with no overlaps and no gaps.  Watertightness is
the whole point of the implicit rewrite: the old loft builder failed exactly here
(metre-scale overlaps on real interbedded data because two independently-lofted
section surfaces did not share their interface).

Assembly method — Approach B: height-field prism over the shared grid (WHY)
---------------------------------------------------------------------------
There are two ways to close the bodies (see the Task-6 plan):

* **A — shared-MC-surface stitch.**  Reference the same ``ContactSurface`` mesh
  for both neighbours and ribbon-stitch a lateral wall between the two surfaces'
  differently-triangulated boundary loops.  That ribbon stitch is the exact step
  that produced the loft's hairlines; making it a closed manifold is fragile.

* **B — height-field prism over the shared grid (CHOSEN).**  Sample ``F`` on one
  regular ``(nx × ny)`` xy-grid.  At every grid node, for every interior horizon,
  find the SINGLE z where ``F`` crosses that horizon's iso-value (a deepest-to-
  shallowest scan that takes exactly one crossing per contact per node → a
  monotone height stack, which also dissolves any RBF "bubble": a non-monotone
  field still yields a monotone body stack).  This yields a single-valued height
  field ``z_k(x, y)`` per contact over the shared grid.  Body ``k`` is the prism
  between height field ``z_k`` (top) and ``z_{k+1}`` (bottom); the top body's top
  is the domain top (``z_max``) and the bottom body's base is the domain base
  (``z_min``).

Approach B is chosen because it is **watertight by construction**:

1. Adjacent bodies share the SAME height field as their interface
   (body ``k``'s base height == body ``k+1``'s top height, sampled at the same
   grid nodes), so the inter-body face is bit-identical → no overlap, no gap.
2. The grid is regular, so each body is built as a union of axis-aligned grid
   CELLS, and a body's surface is the boundary of that cell complex: every cell
   face shared by two present cells of the SAME body cancels, every boundary face
   appears once → a CLOSED 2-manifold with consistent winding, by construction.
3. The single-crossing sampling enforces a monotone stack, resolving the
   documented Stage-3 RBF bubbling concern at the body level.

The cell-complex boundary (the watertight mechanism, in detail)
---------------------------------------------------------------
A body is the set of grid cells where its band has nonzero thickness.  Each
present cell is a hexahedral box: its top face is the bilinear quad through the
four ``z_top`` corner heights, its base face the quad through the four ``z_bot``
corner heights, and its four side faces are vertical quads connecting them.  We
emit the box's six faces into a face multiset keyed by the cell + face-direction,
then keep only faces NOT shared with a present same-body neighbour cell:

* The interface between two horizontally-adjacent present cells is the SAME
  vertical side quad from both → it cancels (internal face).
* A side face on the domain perimeter, or facing an ABSENT cell (a pinch-out
  taper or a hole), appears once → it is a boundary wall.
* Top / base faces always appear once per cell (no cell is stacked on another of
  the same body — bodies are single-valued in z) → they are always boundary.

The kept faces, triangulated with consistent outward winding, form a closed
manifold.  A pinch-out is handled for free: where the band thins to zero the cell
is simply absent, and the side faces of its present neighbours become the wall
that closes the taper.

This module is purely functional compute — no I/O, no logging, no framework
dependencies.  It depends only on NumPy.

What it does NOT do
-------------------
* It does not read the resolver ``body_id`` — Stage-5 emits a deterministic
  synthetic ``body_id`` per band (``f"strat:{rank_top}-{rank_bot}"``, plus a
  component suffix when one band splits into disconnected regions).  Wiring the
  real resolver id is Task 8.
* It does not flag under-constrained bodies — a band with zero volume everywhere
  is OMITTED, not emitted as flagged (flagging is a Task-8 persistence concern).
"""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np
from scipy.ndimage import label as _ndimage_label  # type: ignore[import-untyped]

from groundmodel.domain.services.strat_field.potential_field import (
    PotentialField,
    point_in_polygon,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    Horizon,
    StratColumn,
    SurfaceBound,
)
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

# Minimum band thickness (metres) for a grid cell to count as "present" in a
# body.  Below this the cell is treated as pinched-out and omitted, so the body
# tapers cleanly to a watertight wall rather than emitting a near-degenerate box
# that the manifold check would choke on.  1 mm is far below any real contact
# resolution and well above floating-point noise from the crossing interpolation.
_MIN_BAND_THICKNESS_M: float = 1e-3

# A mesh vertex is identified by its grid node + layer: (node_i, node_j, layer)
# where layer 0 = bottom surface, 1 = top surface.


def assemble_bodies(
    field: PotentialField,
    order: StratColumn,
    domain: Block,
    grid_spacing_m: float,
) -> list[LithoBodyMesh]:
    """Assemble watertight body solids from the implicit field over a shared grid.

    Thin wrapper over :func:`assemble_bodies_with_fields` that returns only the
    meshes (the common case for callers that do not need the per-node height
    fields).  See that function for the full algorithm.

    Parameters
    ----------
    field : PotentialField
        The fitted Stage-3 potential field, sampled once on the grid.  Any object
        exposing ``evaluate((N, 3)) -> (N,)`` works (the analytic test fields do).
    order : StratColumn
        The stratigraphic column.  Supplies each horizon's rank, ``iso_value``
        (the crossing level), and the ``above_formation`` / ``below_formation``
        that name each band's lithology.  Rank 0 (surface) and the floor rank are
        domain caps; the bands between consecutive horizons (including the top cap
        → rank-1 band and the last-interior → floor band) are the bodies.
    domain : Block
        The model block: its polygon's xy bounding box sets the grid extent, and
        ``z_min`` / ``z_max`` set the top / base caps.  A grid node whose ``(x, y)``
        falls outside ``domain.polygon`` is masked out so the solid honours the
        hull, not the bounding rectangle.
    grid_spacing_m : float
        Target grid spacing in metres.  ``numpy.linspace`` hits the block extents
        exactly, so the per-axis step differs from this by at most one cell.

    Returns
    -------
    list of LithoBodyMesh
        One watertight mesh per band per connected component, in ascending
        ``(rank_top, rank_bot, component)`` order.  A band with zero volume
        everywhere is omitted.  Every returned mesh is ``is_flagged=False`` and
        passes the Task-7 ``assert_closed_manifold`` invariant by construction.
    """
    meshes, _fields = assemble_bodies_with_fields(field, order, domain, grid_spacing_m)
    return meshes


def assemble_bodies_with_fields(
    field: PotentialField,
    order: StratColumn,
    domain: Block,
    grid_spacing_m: float,
) -> tuple[list[LithoBodyMesh], dict[str, tuple[np.ndarray, np.ndarray]]]:
    """Assemble watertight body solids AND expose each body's per-node height field.

    Samples ``field`` once on a regular xy-grid spanning the domain's bounding
    box, computes a single-valued height field per interior horizon (monotone,
    one crossing per node), then emits one closed-manifold :class:`LithoBodyMesh`
    per band (per disconnected component) between consecutive height fields.  The
    top band is capped above by ``domain.z_max`` and the bottom band below by
    ``domain.z_min``.

    In addition to the meshes, this returns the per-emitted-body ``(top, base)``
    height arrays the assembly already computed (the band's per-node top/bottom
    elevation arrays, RESTRICTED to that component's present cells — NaN
    elsewhere).  The lens carve (Stage 6) reuses these instead of reconstructing
    them with an O(grid_nodes × triangles) vertical ray-cast per host mesh
    (:func:`~groundmodel.domain.services.strat_field.lens_carving._prism_height_fields`),
    which was the dominant real-data build hotspot.  WHY this is exact: the
    arrays returned here ARE the very arrays the watertight prism emitter builds
    each component mesh from, so the ray-cast reconstruction recovers them
    bit-for-bit — reusing them is behaviour-preserving, not an approximation.

    Parameters
    ----------
    field : PotentialField
        The fitted Stage-3 potential field, sampled once on the grid.  Any object
        exposing ``evaluate((N, 3)) -> (N,)`` works (the analytic test fields do).
    order : StratColumn
        The stratigraphic column (see :func:`assemble_bodies`).
    domain : Block
        The model block (see :func:`assemble_bodies`).
    grid_spacing_m : float
        Target grid spacing in metres (see :func:`assemble_bodies`).

    Returns
    -------
    (list of LithoBodyMesh, dict[str, tuple[numpy.ndarray, numpy.ndarray]])
        The meshes (identical to :func:`assemble_bodies`), and a mapping from each
        emitted mesh's ``body_id`` to its ``(top, base)`` per-node ``(nx, ny)``
        float arrays — ``NaN`` off the component's footprint, finite (and at least
        :data:`_MIN_BAND_THICKNESS_M` thick) on it.  The footprint is recoverable
        as ``~numpy.isnan(top)``.  Keys match the meshes' ``body_id`` exactly,
        including any ``#<component>`` split suffix.

    Notes
    -----
    Deterministic: the grid, the crossing scan, the component labelling (raster
    scan order), and the face emission are all order-stable, so the same input
    yields byte-identical vertices and triangles (the bundle replays this).
    """
    # ------------------------------------------------------------------
    # Step 1: the shared regular grid (NODES at x[i], y[j]; CELLS between them).
    # ------------------------------------------------------------------
    gx, gy, node_inside = build_shared_grid(domain, grid_spacing_m)
    nx, ny = len(gx), len(gy)

    # ------------------------------------------------------------------
    # Step 2: per-interior-horizon single-valued height field z_k(x, y).
    #
    # For each node we evaluate F on a dense vertical sample column and find the
    # single crossing of each interior iso-value (deepest-to-shallowest), so the
    # resulting heights are monotone in rank by construction (z_rank1 >= z_rank2 …
    # >= z_rankN) — this is what dissolves a non-monotone RBF bubble at the body
    # level and guarantees the bands do not invert.
    # ------------------------------------------------------------------
    floor_rank = max((h.rank for h in order.horizons), default=0)
    interior = [h for h in sorted(order.horizons, key=lambda h: h.rank) if 1 <= h.rank < floor_rank]

    # heights[rank][i, j] = elevation of horizon `rank` at node (i, j), or NaN if
    # the iso-value is not crossed in this node's column (the contact is absent /
    # pinched out at this node).
    heights = _sample_height_fields(field, interior, domain, gx, gy, node_inside)

    # ------------------------------------------------------------------
    # Step 3: build the ordered list of level surfaces top→bottom.
    #
    # Levels are: top cap (z_max, flat) → interior horizons (descending rank) →
    # bottom cap (z_min, flat).  A body lives between two consecutive levels.  The
    # band between level p and level p+1 is named by the horizon that BOUNDS it:
    # its lithology is the unit BELOW the upper bounding horizon == the unit ABOVE
    # the lower bounding horizon (asserted to agree).
    # ------------------------------------------------------------------
    bands = list(_iter_bands(order, interior, floor_rank, heights, domain, nx, ny, gx, gy))

    # ------------------------------------------------------------------
    # Step 4: emit one closed-manifold mesh per band per connected component, and
    # capture each component's per-node (top, base) height field keyed by the
    # emitted body_id (so the carve can reuse it without a ray-cast reconstruct).
    # ------------------------------------------------------------------
    bodies: list[LithoBodyMesh] = []
    height_fields: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for band in bands:
        meshes, fields = _emit_band_bodies_with_fields(
            band=band,
            gx=gx,
            gy=gy,
            node_inside=node_inside,
        )
        bodies.extend(meshes)
        height_fields.update(fields)
    return bodies, height_fields


# ---------------------------------------------------------------------------
# Shared grid construction
# ---------------------------------------------------------------------------


def build_shared_grid(
    domain: Block,
    grid_spacing_m: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build the regular xy node grid + inside-polygon mask for a domain block.

    The grid is the single source of truth that makes the cell-complex boundary
    watertight: every body (and every carved lens) is emitted over the SAME node
    grid, so a face shared by two bodies references bit-identical node positions.
    The lens-carving stage (Task 4) must rebuild this grid identically to align
    its lens prisms to the host body's nodes, so the grid construction is exposed
    as a shared helper rather than living inline in :func:`assemble_bodies`.

    Parameters
    ----------
    domain : Block
        The model block.  Its polygon's xy bounding box sets the grid extent and
        ``point_in_polygon`` against the polygon sets the inside mask, so the
        solid honours the hull rather than the bounding rectangle.
    grid_spacing_m : float
        Target grid spacing in metres.  ``numpy.linspace`` hits the block extents
        exactly, so the per-axis step differs from this by at most one cell.

    Returns
    -------
    (numpy.ndarray, numpy.ndarray, numpy.ndarray)
        ``gx`` (shape ``(nx,)``) and ``gy`` (shape ``(ny,)``) node coordinates,
        and ``node_inside`` (shape ``(nx, ny)``) the inside-polygon bool mask.
    """
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    nx = max(2, int(round((x_max - x_min) / grid_spacing_m)) + 1)
    ny = max(2, int(round((y_max - y_min) / grid_spacing_m)) + 1)
    gx = np.linspace(x_min, x_max, nx)
    gy = np.linspace(y_min, y_max, ny)

    # A node is "inside" iff its (x, y) is within the domain polygon.  A grid CELL
    # is present only if ALL FOUR of its corner nodes are inside, so the solid
    # never pokes outside the hull.
    node_inside = np.zeros((nx, ny), dtype=bool)
    for i in range(nx):
        for j in range(ny):
            node_inside[i, j] = point_in_polygon(float(gx[i]), float(gy[j]), domain.polygon)
    return gx, gy, node_inside


# ---------------------------------------------------------------------------
# Height-field sampling
# ---------------------------------------------------------------------------


def _sample_height_fields(
    field: PotentialField,
    interior: list[Horizon],
    domain: Block,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> dict[int, np.ndarray]:
    """Compute the single-valued height field of each interior horizon over the grid.

    For every inside node ``(i, j)`` the field is sampled on a dense vertical
    column from ``z_max`` down to ``z_min``; each interior iso-value's deepest
    rising crossing is located by linear interpolation between bracketing samples.
    A monotone height clamp is then applied over the returned stack so that no
    contact sits above its immediate shallower neighbour (see Returns).

    Parameters
    ----------
    field : PotentialField
        The fitted field (or any ``evaluate``-compatible analytic field).
    interior : list of Horizon
        The interior horizons (ascending rank), each with an ``iso_value``.
    domain : Block
        Supplies the vertical span ``[z_min, z_max]``.
    gx, gy : numpy.ndarray
        Grid node coordinates per axis.
    node_inside : numpy.ndarray
        ``(nx, ny)`` bool mask of nodes inside the domain polygon.

    Returns
    -------
    dict[int, numpy.ndarray]
        ``rank -> (nx, ny)`` float array of horizon elevations; ``NaN`` where the
        horizon's iso-value is not crossed at that node (absent contact) or the
        node is outside the polygon.  The returned heights are MONOTONE
        NON-INCREASING in ascending rank at every present node (a deeper contact
        never sits higher than a shallower one): after the per-node crossing scan a
        running per-node minimum over present ranks clamps any field-bubble
        inversion to its neighbour's height, so the downstream body stack cannot
        invert.  ``NaN`` (absent contact) is skipped by the clamp and preserved.
    """
    nx = len(gx)
    ny = len(gy)
    z_min, z_max = domain.z_min, domain.z_max

    # Vertical sampling resolution.  The crossing is refined by linear
    # interpolation afterward, so this only needs to be fine enough to BRACKET
    # each interior iso-crossing once.  Tie the vertical step to the actual
    # horizontal node spacing (a finer Build is finer in z too), with a floor
    # that keeps a shallow block well-sampled and a cap that bounds a very tall
    # block.  (The earlier `(z)/((z)/64)` form collapsed algebraically to a
    # constant 64 for every block — this makes the resolution genuinely depend
    # on block height.)
    h_step = float(gx[1] - gx[0]) if nx > 1 else (z_max - z_min)
    nz = int(np.ceil((z_max - z_min) / max(h_step * 0.5, 1e-6))) + 1
    nz = min(max(nz, 64), 512)
    zcol = np.linspace(z_max, z_min, nz)  # DESCENDING: index 0 = top

    heights: dict[int, np.ndarray] = {h.rank: np.full((nx, ny), np.nan) for h in interior}
    iso_by_rank = {h.rank: h.iso_value for h in interior}
    interior_ranks = [h.rank for h in interior]  # ascending rank == top→bottom

    # Evaluate the field on the full (inside-node × zcol) batch in one call.
    inside_nodes = [(i, j) for i in range(nx) for j in range(ny) if node_inside[i, j]]
    if not inside_nodes:
        return heights

    pts = np.empty((len(inside_nodes) * nz, 3), dtype=float)
    for n, (i, j) in enumerate(inside_nodes):
        base = n * nz
        pts[base : base + nz, 0] = gx[i]
        pts[base : base + nz, 1] = gy[j]
        pts[base : base + nz, 2] = zcol
    # reason: evaluate() is typed Sequence[tuple] but does np.asarray on its input,
    # so an (N, 3) ndarray is the intended fast path (same as iso_surface.py).
    fvals = np.asarray(field.evaluate(pts)).reshape(len(inside_nodes), nz)  # type: ignore[arg-type]

    # WHY: vectorise the deepest-rising-crossing scan over all inside nodes at once.
    # The scalar loop above (one _contact_crossing call per node × per rank) is
    # O(N_inside × R × nz) in pure Python — the dominant real-data hotspot (~97 s
    # of 180 s for a 2 m build on test.strix).  The vectorised path below reproduces
    # the IDENTICAL result in numpy broadcasting over fvals (N, nz):
    #
    #   f0[:, :-1] = shallower sample per interval; f1[:, 1:] = deeper sample.
    #   rising mask = (f0 <= iso) & (iso <= f1) & (f1 > f0)  — exact same predicate.
    #   z_cross = zcol[:-1] + (iso - f0) / (f1 - f0) * dz   — same linear interp.
    #   deepest = min over intervals that are rising (non-rising → +inf sentinel).
    #
    # Tie behaviour: among equally-deep rising crossings .min(axis=1) keeps the
    # first (smallest index = shallowest z), matching the scalar loop's "keep if
    # z_cross < deepest" condition which also keeps the first minimum seen.  Both
    # scan top→bottom and both define "deepest" as smallest z, so ties are resolved
    # identically.  The divide-where-f1==f0 is guarded: those intervals have
    # f0 == f1, so f1 > f0 is False → rising is False → those cells are masked to
    # +inf by np.where and never contribute a crossing.  No NaN or inf ever lands
    # in a unmasked position.  The result is bit-identical to the scalar path.
    f0 = fvals[:, :-1]  # (N, nz-1) shallower sample of each interval
    f1 = fvals[:, 1:]  # (N, nz-1) deeper sample of each interval
    # zcol is 1-D (nz,); dz has shape (nz-1,) — negative because zcol descends.
    dz = zcol[1:] - zcol[:-1]  # (nz-1,) all negative (zcol descends)

    # Unpack inside_node positions for scatter-back into (nx, ny) grids.
    inside_ii = np.array([i for i, j in inside_nodes], dtype=np.intp)
    inside_jj = np.array([j for i, j in inside_nodes], dtype=np.intp)

    for rank in interior_ranks:
        iso = iso_by_rank[rank]
        # Rising-crossing mask: same predicate as _contact_crossing.
        rising = (f0 <= iso) & (iso <= f1) & (f1 > f0)  # (N, nz-1)
        # Interpolated crossing elevation at each rising interval; non-rising → +inf.
        # The f1==f0 guard is automatic: those intervals are NOT in rising, so
        # np.where leaves them as +inf without triggering a divide-by-zero.
        with np.errstate(invalid="ignore", divide="ignore"):
            z_cross = zcol[:-1] + (iso - f0) / (f1 - f0) * dz  # (N, nz-1)
        deepest = np.where(rising, z_cross, np.inf).min(axis=1)  # (N,)
        # Nodes with no rising crossing retain +inf → scatter only finite ones.
        hit = np.isfinite(deepest)
        if hit.any():
            heights[rank][inside_ii[hit], inside_jj[hit]] = deepest[hit]

    # WHY: make the stack provably monotone — each contact sits no higher than the
    # one above it.  A residual RBF bubble that inverted a contact (the deeper iso
    # crossing ABOVE the shallower one at some node) is pinched to its neighbour
    # height here, yielding a zero-thickness band there instead of an overshoot.
    # That makes per-body non-overlap a construction theorem rather than relying on
    # the field being monotone everywhere (math review 2026-06-14; also removes the
    # real-data VEEN −1.17 m overshoot).  A monotone stack is already a fixed point
    # of this clamp, so well-behaved fields are unchanged.  NaN (the contact is
    # absent / not crossed at this node) is skipped, so a pinch-out stays a pinch-
    # out and does not pull its neighbours down.  If a rank is absent at EVERY node
    # (the whole layer is NaN), the running minimum is left unchanged and the next
    # present rank clamps against the previous present rank, exactly as intended.
    running = np.full((nx, ny), np.inf)
    for rank in interior_ranks:  # same order as the scan above
        layer = heights[rank]
        present = ~np.isnan(layer)
        running[present] = np.minimum(running[present], layer[present])
        layer[present] = running[present]
    return heights


def _contact_crossing(zcol: np.ndarray, fvals: np.ndarray, iso: float) -> float | None:
    """Return the elevation of the contact where ``F`` rises through ``iso``, deepest.

    The field convention is ``F`` INCREASES WITH DEPTH, so a real contact is a
    crossing where ``F`` goes from below ``iso`` (shallower) to above ``iso``
    (deeper) — i.e. a RISING crossing scanning the descending ``zcol`` (top→bottom)
    in index order.  Above the shallowest data the RBF extrapolates and can produce
    a spurious DESCENDING crossing (``F`` dipping back down through ``iso``); those
    are skipped.  Among rising crossings we take the DEEPEST, which equals the only
    real crossing for a field that is monotone-down in the constrained interior and
    discards any shallow extrapolation wiggle.  Taking the deepest rising crossing
    per iso preserves the monotone rank stack (a deeper iso crosses no shallower
    than a shallower iso when the interior is monotone).

    Parameters
    ----------
    zcol : numpy.ndarray
        Descending elevation samples (index 0 = top, index n-1 = bottom).
    fvals : numpy.ndarray
        Field values at ``zcol`` (same length, index-aligned).
    iso : float
        The iso-value to cross.

    Returns
    -------
    float or None
        The interpolated crossing elevation of the deepest rising crossing, or
        ``None`` when ``F`` never rises through ``iso`` (the contact is absent in
        this column).
    """
    deepest: float | None = None
    for k in range(len(fvals) - 1):
        f0 = fvals[k]  # shallower sample (smaller index)
        f1 = fvals[k + 1]  # deeper sample (larger index)
        # RISING crossing only: F goes from below-or-equal iso to above iso as
        # depth increases.  f0 <= iso <= f1 with f1 > f0.
        if f0 <= iso <= f1 and f1 > f0:
            t = (iso - f0) / (f1 - f0)
            z_cross = float(zcol[k] + t * (zcol[k + 1] - zcol[k]))
            # zcol descends, so a later index is deeper (lower z); keep the deepest.
            if deepest is None or z_cross < deepest:
                deepest = z_cross
    return deepest


# ---------------------------------------------------------------------------
# Band construction (top/bottom height pairs + lithology)
# ---------------------------------------------------------------------------


class _Band:
    """One litho band: the prism between an upper and a lower level surface.

    Carries the per-node top / bottom elevations (already aligned to the shared
    grid), the lithology, and the deterministic synthetic body id.  ``top`` and
    ``bottom`` are ``(nx, ny)`` float arrays; a ``NaN`` in either marks the band
    as absent at that node (the bounding horizon pinched out there).

    Parameters
    ----------
    rank_top, rank_bot : int
        The bounding horizon ranks (``rank_top`` shallower).  ``-1`` denotes the
        top cap (above rank 1) and ``floor_rank`` the bottom cap.
    formation_id : str
        The band's lithology.
    top, bottom : numpy.ndarray
        Per-node top / bottom elevations; ``NaN`` where the band is absent.
    """

    __slots__ = ("rank_top", "rank_bot", "formation_id", "top", "bottom")

    def __init__(
        self,
        rank_top: int,
        rank_bot: int,
        formation_id: str,
        top: np.ndarray,
        bottom: np.ndarray,
    ) -> None:
        self.rank_top = rank_top
        self.rank_bot = rank_bot
        self.formation_id = formation_id
        self.top = top
        self.bottom = bottom

    @property
    def body_id(self) -> str:
        """str: Deterministic synthetic body id keyed by the bounding ranks."""
        return f"strat:{self.rank_top}-{self.rank_bot}"


def _build_cap_array(
    surface: SurfaceBound | None,
    fallback_z: float,
    nx: int,
    ny: int,
    gx: np.ndarray,
    gy: np.ndarray,
) -> np.ndarray:
    """Build one band cap (top or base) over the shared grid.

    When ``surface`` is set the cap follows the geological surface exactly:
    each grid node's elevation is ``surface.evaluate(gx[i], gy[j])``.  This is the
    mechanism that welds adjacent geological bands: the SAME
    :class:`~groundmodel.domain.services.strat_field.strat_types.SurfaceBound`
    object sits as the upper band's ``base_surface`` and the lower band's
    ``top_surface``, so evaluating it at the SAME node positions yields
    byte-identical cap elevations → the touching faces are the same quad → no gap,
    no overlap at the seam.  When ``surface`` is ``None`` the cap is the flat
    ``fallback_z`` (``z_max`` for the top, ``z_min`` for the base), preserving the
    v1 single-block behaviour for the model's outermost (open) bands.

    Parameters
    ----------
    surface : SurfaceBound or None
        The curved cap surface, or ``None`` for the flat fallback.
    fallback_z : float
        The flat cap elevation used when ``surface`` is ``None``.
    nx, ny : int
        Grid node dimensions.
    gx, gy : numpy.ndarray
        Grid node coordinates (used to evaluate a curved surface per node).

    Returns
    -------
    numpy.ndarray
        ``(nx, ny)`` per-node cap elevation array.
    """
    if surface is None:
        return np.full((nx, ny), fallback_z)
    cap = np.empty((nx, ny), dtype=float)
    for i in range(nx):
        for j in range(ny):
            cap[i, j] = surface.evaluate(float(gx[i]), float(gy[j]))
    return cap


def _iter_bands(
    order: StratColumn,
    interior: list[Horizon],
    floor_rank: int,
    heights: dict[int, np.ndarray],
    domain: Block,
    nx: int,
    ny: int,
    gx: np.ndarray,
    gy: np.ndarray,
) -> Iterator[_Band]:
    """Yield each band (top cap → interior horizons → bottom cap) with its heights.

    The level surfaces, top→bottom, are: the top cap (flat ``z_max`` or the
    curved ``domain.top_surface`` if set), then each interior horizon's height
    field (descending rank), then the bottom cap (flat ``z_min`` or the curved
    ``domain.base_surface``).  Consecutive levels bound one band; its lithology is
    verified to be consistent from both bounding horizons.

    When a :class:`~strat_types.SurfaceBound` surface is set on the domain block,
    the corresponding cap array is populated per-node by evaluating the surface at
    ``(gx[i], gy[j])`` rather than at a flat elevation.  This is the mechanism by
    which adjacent geological bands share the SAME cap elevation at each grid node:
    both bands evaluate the SAME :class:`SurfaceBound` object at the SAME node
    positions → byte-identical z per node → the bottom face of the upper band and
    the top face of the lower band are the same quad → the cell complex welds
    exactly (the watertight cross-band stitch, WHY this is correct).

    Interior horizon heights are clamped into ``[bot_cap, top_cap]`` per node
    AFTER the monotone clamp has already been applied (so the stack is first made
    self-consistent, then pinned inside the geological band).  A horizon that the
    implicit field placed outside the band (above ``top_cap`` or below ``bot_cap``
    at a node) is pulled to the nearer cap, producing a zero-thickness or absent
    cell there rather than a body that escapes the geological band.

    Parameters
    ----------
    order : StratColumn
        Supplies ``above_formation`` / ``below_formation`` per horizon.
    interior : list of Horizon
        Interior horizons (ascending rank).
    floor_rank : int
        The floor (bottom-cap) rank.
    heights : dict[int, numpy.ndarray]
        Per-rank height field from :func:`_sample_height_fields`.  Heights may
        be outside ``[bot_cap, top_cap]`` (the field can extrapolate beyond the
        band); they are clamped here before band construction.
    domain : Block
        Supplies the flat or curved cap elevations via ``z_max``/``z_min`` and
        the optional ``top_surface``/``base_surface``.
    nx, ny : int
        Grid dimensions (for the flat cap arrays).
    gx, gy : numpy.ndarray
        Grid node coordinates; used to evaluate curved cap surfaces per node.

    Yields
    ------
    _Band
        Each non-cap-only band, with aligned top/bottom height arrays.
    """
    # Build the caps: curved (per-node SurfaceBound evaluation) if the domain block
    # carries that surface, else the flat z_max / z_min fallback.  The SAME
    # SurfaceBound object sits as base_surface on the band ABOVE and top_surface on
    # the band BELOW, so both bands evaluate it at the SAME node positions →
    # byte-identical cap elevations → exact weld between adjacent bands.
    top_cap = _build_cap_array(domain.top_surface, domain.z_max, nx, ny, gx, gy)
    bot_cap = _build_cap_array(domain.base_surface, domain.z_min, nx, ny, gx, gy)

    horizon_by_rank = {h.rank: h for h in order.horizons}

    # Clamp every interior horizon into [bot_cap, top_cap] per node.
    # WHY: the implicit field fits globally and may extrapolate to crossings outside
    # the band's geological bounds; clamping prevents a body escaping its band and
    # eliminates cross-band overlaps.  NaN (absent contact) is skipped — a pinch-out
    # stays a pinch-out and is not snapped to a cap.  The clamp is applied
    # AFTER the monotone clamp (_sample_height_fields) so the within-band
    # monotone stack is preserved (the two clamps compose correctly: monotone first,
    # then cap-bound).
    for h in interior:
        layer = heights[h.rank]
        present = ~np.isnan(layer)
        if present.any():
            layer[present] = np.minimum(layer[present], top_cap[present])
            layer[present] = np.maximum(layer[present], bot_cap[present])

    # The ordered list of (rank, height-array) levels, top→bottom.
    levels: list[tuple[int, np.ndarray]] = [(-1, top_cap)]
    for h in interior:
        levels.append((h.rank, heights[h.rank]))
    levels.append((floor_rank, bot_cap))

    for (rank_top, top_arr), (rank_bot, bot_arr) in zip(levels, levels[1:], strict=False):
        formation_id = _band_formation(order, horizon_by_rank, rank_top, rank_bot, floor_rank)
        # Cap heights are flat or curved; where an interior bounding height is NaN
        # (the contact pinched out at that node) the band inherits the NaN so the
        # cell there is absent.  A cap level is always present (no NaN), so a band
        # bounded by a cap on one side uses the cap there.
        yield _Band(
            rank_top=rank_top,
            rank_bot=rank_bot,
            formation_id=formation_id,
            top=top_arr,
            bottom=bot_arr,
        )


def _band_formation(
    order: StratColumn,
    horizon_by_rank: dict[int, Horizon],
    rank_top: int,
    rank_bot: int,
    floor_rank: int,
) -> str:
    """Resolve the lithology of the band bounded by ``rank_top`` and ``rank_bot``.

    The band between horizon ``rank_top`` (its top contact) and horizon
    ``rank_bot`` (its base contact) is the unit BELOW the upper horizon, which is
    the SAME unit as ABOVE the lower horizon.  Both naming paths are checked to
    agree; a disagreement means the column's above/below wiring is inconsistent
    and is surfaced loudly rather than silently picking one side.

    Parameters
    ----------
    order : StratColumn
        Unused directly (kept for signature symmetry / future multi-block).
    horizon_by_rank : dict
        ``rank -> Horizon`` lookup.
    rank_top : int
        Upper bounding rank, or ``-1`` for the top cap (no horizon above).
    rank_bot : int
        Lower bounding rank, or ``floor_rank`` for the bottom cap.
    floor_rank : int
        The floor rank.

    Returns
    -------
    str
        The band's ``formation_id``.

    Raises
    ------
    ValueError
        When the two naming paths disagree, or neither bounding horizon names the
        band (both caps — impossible for a real model with ≥1 interior horizon).
    """
    below_of_top = (
        horizon_by_rank[rank_top].below_formation if rank_top in horizon_by_rank else None
    )
    above_of_bot = (
        horizon_by_rank[rank_bot].above_formation if rank_bot in horizon_by_rank else None
    )

    if below_of_top is not None and above_of_bot is not None:
        if below_of_top != above_of_bot:
            raise ValueError(
                f"band [{rank_top}, {rank_bot}] lithology disagreement: "
                f"below(top)={below_of_top!r} vs above(bot)={above_of_bot!r}"
            )
        return below_of_top
    if below_of_top is not None:
        return below_of_top
    if above_of_bot is not None:
        return above_of_bot
    raise ValueError(f"band [{rank_top}, {rank_bot}] has no naming horizon")


# ---------------------------------------------------------------------------
# Per-band mesh emission (the watertight cell-complex boundary)
# ---------------------------------------------------------------------------


def _emit_band_bodies(
    band: _Band,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> list[LithoBodyMesh]:
    """Emit one closed-manifold mesh per connected component of a band.

    Thin adapter over :func:`emit_prism_bodies` that unpacks the band's per-node
    top / bottom arrays, lithology, and synthetic body id.

    Parameters
    ----------
    band : _Band
        The band with its per-node top / bottom height arrays.
    gx, gy : numpy.ndarray
        Grid node coordinates.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask.

    Returns
    -------
    list of LithoBodyMesh
        One mesh per connected component, in raster (row-major) component order.
        Empty when the band has no present cell anywhere.
    """
    meshes, _fields = _emit_band_bodies_with_fields(band, gx, gy, node_inside)
    return meshes


def _emit_band_bodies_with_fields(
    band: _Band,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> tuple[list[LithoBodyMesh], dict[str, tuple[np.ndarray, np.ndarray]]]:
    """Emit a band's per-component meshes AND each component's per-node height field.

    Thin adapter over :func:`emit_prism_bodies_with_fields` that unpacks the
    band's per-node top / bottom arrays, lithology, and synthetic body id.

    Parameters
    ----------
    band : _Band
        The band with its per-node top / bottom height arrays.
    gx, gy : numpy.ndarray
        Grid node coordinates.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask.

    Returns
    -------
    (list of LithoBodyMesh, dict[str, tuple[numpy.ndarray, numpy.ndarray]])
        The component meshes and the per-emitted-body ``(top, base)`` height
        arrays (see :func:`emit_prism_bodies_with_fields`).
    """
    return emit_prism_bodies_with_fields(
        top=band.top,
        bottom=band.bottom,
        formation_id=band.formation_id,
        body_id=band.body_id,
        gx=gx,
        gy=gy,
        node_inside=node_inside,
    )


def emit_prism_bodies(
    top: np.ndarray,
    bottom: np.ndarray,
    formation_id: str,
    body_id: str,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> list[LithoBodyMesh]:
    """Emit one closed-manifold prism mesh per connected component of a height band.

    Thin wrapper over :func:`emit_prism_bodies_with_fields` returning only the
    meshes (the lens carve uses the ``_with_fields`` variant to capture each
    component's height field for reuse).  See that function for the full
    algorithm + parameter docs.

    Parameters
    ----------
    top, bottom : numpy.ndarray
        ``(nx, ny)`` per-node top / base elevations; ``NaN`` marks the prism
        absent at a node.
    formation_id : str
        The prism's lithology (drives colour on every emitted component).
    body_id : str
        The base body id stamped on each component (``#<idx>`` suffixed on split).
    gx, gy : numpy.ndarray
        Grid node coordinates.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask.

    Returns
    -------
    list of LithoBodyMesh
        One mesh per connected component, in raster (row-major) component order.
    """
    meshes, _fields = emit_prism_bodies_with_fields(
        top=top,
        bottom=bottom,
        formation_id=formation_id,
        body_id=body_id,
        gx=gx,
        gy=gy,
        node_inside=node_inside,
    )
    return meshes


def emit_prism_bodies_with_fields(
    top: np.ndarray,
    bottom: np.ndarray,
    formation_id: str,
    body_id: str,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> tuple[list[LithoBodyMesh], dict[str, tuple[np.ndarray, np.ndarray]]]:
    """Emit prism meshes per connected component AND each component's height field.

    A grid CELL ``(i, j)`` (spanning nodes ``i..i+1`` × ``j..j+1``) is PRESENT
    iff all four corner nodes are inside the polygon AND have a finite ``top`` and
    ``bottom`` AND the cell's mean thickness exceeds :data:`_MIN_BAND_THICKNESS_M`.
    Present cells are grouped into 4-connected components; each component becomes
    one body, whose surface is the boundary of its cell complex (the watertight
    mechanism — see the module docstring).

    This is the shared prism emitter reused by both :func:`assemble_bodies` (via
    :func:`_emit_band_bodies`) and the lens-carving stage (Task 4): a lens, a
    host-upper-plus-outer piece, and a host-lower piece are all single-valued
    height-field prisms, so each is emitted by THIS function over the SAME grid —
    which is why adjacent pieces share node heights exactly (no overlap, no gap)
    and each is closed by construction.

    Alongside the meshes it returns, per emitted body, the ``(top, base)`` height
    arrays the component was built from, RESTRICTED to that component's present
    cells (NaN at every node not touched by a present cell of the component).
    This is EXACTLY the field a vertical ray-cast reconstruction of the emitted
    mesh would recover — so the lens carve can reuse it instead of paying the
    O(grid_nodes × triangles) ray-cast (the dominant real-data hotspot).

    Parameters
    ----------
    top, bottom : numpy.ndarray
        ``(nx, ny)`` per-node top / base elevations; ``NaN`` in either marks the
        prism absent at that node (a pinch-out / outside the footprint).
    formation_id : str
        The prism's lithology (drives colour on every emitted component).
    body_id : str
        The base body id stamped on each component; when the band splits into
        multiple disconnected components a ``#<idx>`` suffix is appended so the
        ids stay distinct (matching the existing band-split convention).
    gx, gy : numpy.ndarray
        Grid node coordinates.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask.

    Returns
    -------
    (list of LithoBodyMesh, dict[str, tuple[numpy.ndarray, numpy.ndarray]])
        One mesh per connected component, in raster (row-major) component order
        (empty when no cell is present anywhere); and a mapping from each emitted
        component's ``body_id`` to its component-restricted ``(top, base)`` arrays.
        Every mesh is ``is_flagged=False`` and passes ``assert_closed_manifold``
        by construction.
    """
    nx = len(gx)
    ny = len(gy)
    present = _present_cells(top, bottom, node_inside, nx, ny)
    if not present.any():
        return [], {}

    components = _label_components(present)
    bodies: list[LithoBodyMesh] = []
    fields: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for comp_idx, cell_set in enumerate(components):
        verts, tris = _build_component_mesh(top, bottom, gx, gy, cell_set)
        if not tris:
            continue
        component_body_id = body_id if len(components) == 1 else f"{body_id}#{comp_idx}"
        bodies.append(
            LithoBodyMesh(
                body_id=component_body_id,
                formation_id=formation_id,
                vertices=verts,
                triangles=tris,
                is_flagged=False,
            )
        )
        # The component's height field: the source top/base arrays masked to the
        # nodes touched by a PRESENT cell of this component (NaN elsewhere).  This
        # matches what a ray-cast of the emitted mesh reconstructs node-for-node,
        # so the carve can reuse it byte-identically.
        fields[component_body_id] = _component_height_field(top, bottom, cell_set, nx, ny)
    return bodies, fields


def _component_height_field(
    top: np.ndarray,
    bottom: np.ndarray,
    cells: set[tuple[int, int]],
    nx: int,
    ny: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Mask the source top/base arrays to a single component's footprint nodes.

    A component is a set of present grid CELLS; a NODE belongs to the component's
    footprint iff it is a corner of at least one present cell of the component.
    The returned arrays carry the source ``top`` / ``bottom`` value at those
    footprint nodes and ``NaN`` everywhere else — exactly the single-valued height
    field a vertical ray-cast of the component's emitted mesh recovers, so the
    lens carve reuses it without reconstructing it.

    Parameters
    ----------
    top, bottom : numpy.ndarray
        ``(nx, ny)`` per-node source top / base elevation arrays.
    cells : set of (int, int)
        The component's present cell indices (each cell ``(i, j)`` spans nodes
        ``i..i+1`` × ``j..j+1``).
    nx, ny : int
        Grid node dimensions.

    Returns
    -------
    (numpy.ndarray, numpy.ndarray)
        ``(comp_top, comp_base)`` ``(nx, ny)`` arrays, ``NaN`` off the
        component's footprint.
    """
    # WHY: vectorise the per-cell corner writes.  The scalar loop visits each cell
    # and sets four corners individually — O(cells) Python iterations.  The
    # vectorised path extracts the cell indices as arrays once and writes all four
    # corner offsets with numpy advanced indexing in four O(cells) numpy calls,
    # producing the identical boolean footprint in ~1/50 the time.
    footprint = np.zeros((nx, ny), dtype=bool)
    if cells:
        ci_arr = np.fromiter((ci for ci, _ in cells), dtype=np.intp, count=len(cells))
        cj_arr = np.fromiter((cj for _, cj in cells), dtype=np.intp, count=len(cells))
        for di, dj in ((0, 0), (1, 0), (1, 1), (0, 1)):
            footprint[ci_arr + di, cj_arr + dj] = True
    comp_top = np.full((nx, ny), np.nan)
    comp_base = np.full((nx, ny), np.nan)
    comp_top[footprint] = top[footprint]
    comp_base[footprint] = bottom[footprint]
    return comp_top, comp_base


def _present_cells(
    top: np.ndarray,
    bottom: np.ndarray,
    node_inside: np.ndarray,
    nx: int,
    ny: int,
) -> np.ndarray:
    """Return the ``(nx-1, ny-1)`` bool mask of cells present in a height band.

    A cell is present iff all four corner nodes are inside the polygon and have
    finite top + bottom heights, and the band's mean thickness across the four
    corners exceeds :data:`_MIN_BAND_THICKNESS_M` (so a pinched-out / zero-volume
    cell is omitted and the body tapers cleanly).

    Parameters
    ----------
    top, bottom : numpy.ndarray
        The per-node top / base elevation arrays that gate presence.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask.
    nx, ny : int
        Grid node dimensions.

    Returns
    -------
    numpy.ndarray
        ``(nx-1, ny-1)`` bool cell-presence mask.

    Notes
    -----
    WHY vectorised: the scalar double loop over ``(nx-1)×(ny-1)`` cells was one
    of the two dominant CPU hotspots in the real ``test.strix`` build (~21 s of
    ~25 s on the cell-presence / NaN-check / thickness genexprs combined).

    The vectorised form reproduces the IDENTICAL bool array via numpy slicing:

    * **corner-inside** — the four ``node_inside`` corner slices are AND-ed.
      Corner ``(i,j)`` maps to slice ``[:-1,:-1]``; ``(i+1,j)`` → ``[1:,:-1]``;
      ``(i+1,j+1)`` → ``[1:,1:]``; ``(i,j+1)`` → ``[:-1,1:]``.  The AND of
      all four reproduces "``all(node_inside[ci,cj] for ci,cj in corners)``"
      exactly.

    * **finite top/bottom** — ``np.isfinite`` on the same four corner slices,
      AND-ed.  Reproduces "``any(np.isnan(t)…)``" exactly (NaN is not finite).

    * **thickness** — ``((d00+d10+d11+d01)/4.0 > _MIN_BAND_THICKNESS_M)`` where
      ``dXX = top_corner - bottom_corner``.  The operand order ``(0,0), (1,0),
      (1,1), (0,1)`` matches the scalar's ``zip(tops, bots)`` which iterates
      ``corners = ((i,j), (i+1,j), (i+1,j+1), (i,j+1))`` — same summation order
      → bit-identical floats on any IEEE-754 machine.  A NaN thickness cannot
      survive the finite gate above, so no ``NaN > x`` comparison is ever reached
      (NaN-bearing cells are already excluded from the finite mask).
    """
    # WHY numpy slice names: (0,0)=bottom-left, (1,0)=bottom-right, etc.
    # The cell (i,j) spans nodes i..i+1 × j..j+1.
    # Four corner slices — each has shape (nx-1, ny-1).
    c00 = (slice(None, -1), slice(None, -1))  # (i,   j  )
    c10 = (slice(1, None), slice(None, -1))  # (i+1, j  )
    c11 = (slice(1, None), slice(1, None))  # (i+1, j+1)
    c01 = (slice(None, -1), slice(1, None))  # (i,   j+1)

    # All four corners must lie inside the polygon.
    all_inside = node_inside[c00] & node_inside[c10] & node_inside[c11] & node_inside[c01]

    # All four corners must have finite (non-NaN) top AND bottom.
    all_finite = (
        np.isfinite(top[c00])
        & np.isfinite(top[c10])
        & np.isfinite(top[c11])
        & np.isfinite(top[c01])
        & np.isfinite(bottom[c00])
        & np.isfinite(bottom[c10])
        & np.isfinite(bottom[c11])
        & np.isfinite(bottom[c01])
    )

    # Mean thickness: (d00 + d10 + d11 + d01) / 4.0  where dXX = top - bottom.
    # Operand order matches the scalar's corners tuple → identical FP sum.
    # NaN cells are already excluded by all_finite so no NaN arithmetic here.
    d00 = top[c00] - bottom[c00]
    d10 = top[c10] - bottom[c10]
    d11 = top[c11] - bottom[c11]
    d01 = top[c01] - bottom[c01]
    thick_ok = (d00 + d10 + d11 + d01) * 0.25 > _MIN_BAND_THICKNESS_M

    return np.asarray(all_inside & all_finite & thick_ok, dtype=bool)


def _label_components(present: np.ndarray) -> list[set[tuple[int, int]]]:
    """Group present cells into 4-connected components (deterministic raster scan).

    Parameters
    ----------
    present : numpy.ndarray
        ``(nx-1, ny-1)`` bool cell-presence mask.

    Returns
    -------
    list of set of (int, int)
        Each set is the ``(i, j)`` cell indices of one connected component.
        Components are returned in the order their first (raster-scan) cell is
        encountered, so the labelling is deterministic.

    Notes
    -----
    WHY ``scipy.ndimage.label``: the scalar BFS over the ``(nx-1)×(ny-1)`` mask
    was the second dominant CPU hotspot in the real ``test.strix`` build (~4.9 s).
    ``scipy.ndimage.label`` is a C-backed flood-fill and replaces the pure-Python
    BFS at a fraction of the cost.

    WHY the label order is identical to the scalar BFS:

    * The scalar seeds in a ``for i: for j:`` (row-major / C-order) double loop
      and assigns components in the order each seed is encountered.
    * ``scipy.ndimage.label`` scans the input array in C-order and assigns label 1
      to the first connected component found, label 2 to the next, and so on —
      exactly mirroring the scalar seed order.  (Verified empirically: two
      disconnected blobs placed at ``(0,0)`` and ``(4,4)`` receive labels 1 and 2
      respectively in the ndimage output, matching the scalar BFS.)

    The 4-connectivity structure ``[[0,1,0],[1,1,1],[0,1,0]]`` matches the four
    neighbours ``(±1, 0), (0, ±1)`` the scalar BFS uses.  The component-order
    invariant is therefore preserved by construction, and the body-id suffix
    ``#<comp_idx>`` remains deterministic.
    """
    # 4-connected structure (no diagonals) — matches the scalar BFS neighbours.
    _STRUCT4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.int32)

    labeled, n = _ndimage_label(present, structure=_STRUCT4)
    if n == 0:
        return []

    # Convert the labeled integer array into the same list-of-sets output the
    # scalar BFS produced.  np.argwhere gives (i, j) pairs in C-order for each
    # label value, matching the per-component iteration the caller expects.
    # Labels run 1..n; converting to a tuple inside the set comprehension keeps
    # the (i, j) pairs as plain Python tuples to match the scalar's output type.
    return [{(int(r), int(c)) for r, c in np.argwhere(labeled == k)} for k in range(1, n + 1)]


def _build_component_mesh(
    top: np.ndarray,
    bottom: np.ndarray,
    gx: np.ndarray,
    gy: np.ndarray,
    cells: set[tuple[int, int]],
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Build the closed-manifold mesh of one band component via a vectorised XOR-mask boundary.

    The boundary of a cell complex is computed by classifying each potential face
    as interior (shared by two component cells → cancels) or exterior (exposed →
    boundary).  For top/bottom faces this is trivially always-boundary; for side
    faces the XOR-presence rule is: a face on edge ``(ci, cj) | (ci', cj')`` is a
    boundary face iff exactly one of the two cells is in this component, which
    equals ``present[ci,cj] XOR present[ci',cj']``.  Because the component mask is
    ``True`` everywhere inside and ``False`` outside, the boundary side faces are
    exactly those where the inside-cell has an absent neighbour — the standard
    ``present & ~shift(present)`` formulation.

    Replaces the scalar per-cell dict-multiset approach (``add_face`` / ``vid`` /
    ``_add_side`` closures + ``sorted()`` key) which was the dominant real-data CPU
    hotspot (~25 s of the ``test.strix`` build): that path ran a Python dict op,
    a ``tuple(sorted(...))`` call, and two closure dispatches per face per cell
    (~6 faces × cells × 2 passes → O(10M) pure-Python ops for a 476k-node grid).
    The vectorised path replaces all of that with NumPy boolean slice ops over the
    ``(ncx, ncy)`` component mask + a single pass over the boundary face rows to
    assign deduped vertex ids.

    Winding convention (identical to the scalar code, verified for manifold consistency)
    ------------------------------------------------------------------------------------
    * **TOP face** (outward normal +z, CCW from above):
      ``(ci,cj,1) → (ci+1,cj,1) → (ci+1,cj+1,1) → (ci,cj+1,1)``
    * **BOTTOM face** (outward normal −z, CW from above = reverse of top):
      ``(ci,cj,0) → (ci,cj+1,0) → (ci+1,cj+1,0) → (ci+1,cj,0)``
    * **South side** (low-j face, neighbour at cj−1, outward = −j direction):
      ``(ci,cj,0) → (ci+1,cj,0) → (ci+1,cj,1) → (ci,cj,1)``
    * **North side** (high-j face, neighbour at cj+1, outward = +j direction):
      ``(ci+1,cj+1,0) → (ci,cj+1,0) → (ci,cj+1,1) → (ci+1,cj+1,1)``
    * **West side** (low-i face, neighbour at ci−1, outward = −i direction):
      ``(ci,cj+1,0) → (ci,cj,0) → (ci,cj,1) → (ci,cj+1,1)``
    * **East side** (high-i face, neighbour at ci+1, outward = +i direction):
      ``(ci+1,cj,0) → (ci+1,cj+1,0) → (ci+1,cj+1,1) → (ci+1,cj,1)``

    These are exactly the quads the scalar ``add_face`` / ``_add_side`` calls
    accumulated, so the resulting triangulation is the same closed solid.

    Parameters
    ----------
    top, bottom : numpy.ndarray
        The per-node top / base elevation arrays supplying each corner's z.
    gx, gy : numpy.ndarray
        Grid node coordinates.
    cells : set of (int, int)
        The component's present cell indices.

    Returns
    -------
    (list of (float, float, float), list of (int, int, int))
        The compacted vertices and outward-wound triangles of the closed solid.
        Vertex order is first-touch (raster scan over face types: top, bottom,
        south, north, west, east) — deterministic but not byte-identical to the
        scalar path (which visited faces in per-cell iteration order).
    """
    if not cells:
        return [], []

    # ------------------------------------------------------------------
    # Step 1: build a local presence mask over the component's bounding box.
    #
    # Using a local (offset) mask keeps the arrays small even when this
    # component is a tiny island in a large grid.
    # ------------------------------------------------------------------
    ci_arr = np.fromiter((ci for ci, _ in cells), dtype=np.intp, count=len(cells))
    cj_arr = np.fromiter((cj for _, cj in cells), dtype=np.intp, count=len(cells))

    ci_min = int(ci_arr.min())
    cj_min = int(cj_arr.min())
    ci_max = int(ci_arr.max())
    cj_max = int(cj_arr.max())

    # Local mask dimensions (cell space, not node space).
    lci = ci_max - ci_min + 1
    lcj = cj_max - cj_min + 1
    mask = np.zeros((lci, lcj), dtype=bool)
    mask[ci_arr - ci_min, cj_arr - cj_min] = True

    # ------------------------------------------------------------------
    # Step 2: classify boundary faces per direction using XOR-mask ops.
    #
    # A south face of (ci,cj) is a boundary face iff (ci, cj-1) is absent.
    # In local coords: mask[li, lj] & ~padded_south_neighbour[li, lj]
    # which equals: mask[li,lj] & ~mask[li, lj-1] (with lj-1<0 → absent=True).
    # We use np.pad to add a False border in each direction and then slice.
    # ------------------------------------------------------------------
    # Pad with False on all sides so boundary cells correctly see absent neighbours.
    padded = np.pad(mask, pad_width=1, mode="constant", constant_values=False)
    # Interior slice is padded[1:-1, 1:-1] = mask itself.

    # South boundary: present & neighbour at lj-1 absent = padded[1:-1,:-2]
    south_mask = mask & ~padded[1:-1, :-2]  # (lci, lcj)
    # North boundary: present & neighbour at lj+1 absent = padded[1:-1, 2:]
    north_mask = mask & ~padded[1:-1, 2:]  # (lci, lcj)
    # West boundary: present & neighbour at li-1 absent = padded[:-2, 1:-1]
    west_mask = mask & ~padded[:-2, 1:-1]  # (lci, lcj)
    # East boundary: present & neighbour at li+1 absent = padded[2:, 1:-1]
    east_mask = mask & ~padded[2:, 1:-1]  # (lci, lcj)

    # ------------------------------------------------------------------
    # Step 3: collect the (ci, cj) of each present or boundary-face cell in
    # deterministic order (raster scan = C-order over the local mask).
    # ------------------------------------------------------------------
    # Top and bottom faces: all present cells (same set, same iteration order).
    top_ci, top_cj = (x + o for x, o in zip(np.where(mask), (ci_min, cj_min)))
    top_ci = top_ci + ci_min
    top_cj = top_cj + cj_min

    # Re-derive from np.where to get proper numpy arrays.
    _li, _lj = np.where(mask)
    top_ci = _li + ci_min
    top_cj = _lj + cj_min

    _li, _lj = np.where(south_mask)
    south_ci, south_cj = _li + ci_min, _lj + cj_min

    _li, _lj = np.where(north_mask)
    north_ci, north_cj = _li + ci_min, _lj + cj_min

    _li, _lj = np.where(west_mask)
    west_ci, west_cj = _li + ci_min, _lj + cj_min

    _li, _lj = np.where(east_mask)
    east_ci, east_cj = _li + ci_min, _lj + cj_min

    # ------------------------------------------------------------------
    # Step 4: build the vertex pool and triangle list.
    #
    # A vertex is identified by (node_i, node_j, layer) where layer 0 = bottom,
    # layer 1 = top.  We dedup with a Python dict so that adjacent faces sharing
    # a node reference the SAME index — the watertight weld.  Heights come from
    # the per-NODE arrays (top[ni,nj] / bottom[ni,nj]).
    #
    # For each face type we know exactly which (ni, nj) node pairs appear and
    # which layer they use, so we can resolve vertex ids in a tight loop over the
    # boundary-face arrays (far fewer iterations than the scalar per-cell path).
    # ------------------------------------------------------------------
    vert_index: dict[tuple[int, int, int], int] = {}
    verts_x: list[float] = []
    verts_y: list[float] = []
    verts_z: list[float] = []

    def _vid(ni: int, nj: int, layer: int) -> int:
        """Return the deduped vertex index for node ``(ni, nj, layer)``."""
        key = (ni, nj, layer)
        idx = vert_index.get(key)
        if idx is None:
            idx = len(verts_x)
            z = float(bottom[ni, nj]) if layer == 0 else float(top[ni, nj])
            verts_x.append(float(gx[ni]))
            verts_y.append(float(gy[nj]))
            verts_z.append(z)
            vert_index[key] = idx
        return idx

    triangles: list[tuple[int, int, int]] = []

    def _tri(a: int, b: int, c: int, d: int) -> None:
        """Triangulate quad (a,b,c,d) → (a,b,c) + (a,c,d) and append."""
        triangles.append((a, b, c))
        triangles.append((a, c, d))

    # TOP faces: quad (ci,cj,1)→(ci+1,cj,1)→(ci+1,cj+1,1)→(ci,cj+1,1)
    # outward normal +z, CCW from above.
    for ci, cj in zip(top_ci.tolist(), top_cj.tolist()):
        _tri(
            _vid(ci, cj, 1),
            _vid(ci + 1, cj, 1),
            _vid(ci + 1, cj + 1, 1),
            _vid(ci, cj + 1, 1),
        )

    # BOTTOM faces: quad (ci,cj,0)→(ci,cj+1,0)→(ci+1,cj+1,0)→(ci+1,cj,0)
    # outward normal −z, CW from above (reversed winding vs TOP).
    for ci, cj in zip(top_ci.tolist(), top_cj.tolist()):
        _tri(
            _vid(ci, cj, 0),
            _vid(ci, cj + 1, 0),
            _vid(ci + 1, cj + 1, 0),
            _vid(ci + 1, cj, 0),
        )

    # SOUTH faces (low-j boundary): quad (ci,cj,0)→(ci+1,cj,0)→(ci+1,cj,1)→(ci,cj,1)
    # outward normal −j direction.
    for ci, cj in zip(south_ci.tolist(), south_cj.tolist()):
        _tri(
            _vid(ci, cj, 0),
            _vid(ci + 1, cj, 0),
            _vid(ci + 1, cj, 1),
            _vid(ci, cj, 1),
        )

    # NORTH faces (high-j boundary): quad (ci+1,cj+1,0)→(ci,cj+1,0)→(ci,cj+1,1)→(ci+1,cj+1,1)
    # outward normal +j direction.
    for ci, cj in zip(north_ci.tolist(), north_cj.tolist()):
        _tri(
            _vid(ci + 1, cj + 1, 0),
            _vid(ci, cj + 1, 0),
            _vid(ci, cj + 1, 1),
            _vid(ci + 1, cj + 1, 1),
        )

    # WEST faces (low-i boundary): quad (ci,cj+1,0)→(ci,cj,0)→(ci,cj,1)→(ci,cj+1,1)
    # outward normal −i direction.
    for ci, cj in zip(west_ci.tolist(), west_cj.tolist()):
        _tri(
            _vid(ci, cj + 1, 0),
            _vid(ci, cj, 0),
            _vid(ci, cj, 1),
            _vid(ci, cj + 1, 1),
        )

    # EAST faces (high-i boundary): quad (ci+1,cj,0)→(ci+1,cj+1,0)→(ci+1,cj+1,1)→(ci+1,cj,1)
    # outward normal +i direction.
    for ci, cj in zip(east_ci.tolist(), east_cj.tolist()):
        _tri(
            _vid(ci + 1, cj, 0),
            _vid(ci + 1, cj + 1, 0),
            _vid(ci + 1, cj + 1, 1),
            _vid(ci + 1, cj, 1),
        )

    vertices = list(zip(verts_x, verts_y, verts_z))
    return vertices, triangles
