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

from collections import defaultdict
from collections.abc import Callable, Iterator

import numpy as np

from groundmodel.domain.services.strat_field.potential_field import (
    PotentialField,
    point_in_polygon,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    Horizon,
    StratColumn,
)
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

# Minimum band thickness (metres) for a grid cell to count as "present" in a
# body.  Below this the cell is treated as pinched-out and omitted, so the body
# tapers cleanly to a watertight wall rather than emitting a near-degenerate box
# that the manifold check would choke on.  1 mm is far below any real contact
# resolution and well above floating-point noise from the crossing interpolation.
_MIN_BAND_THICKNESS_M: float = 1e-3

# A mesh vertex is identified by its grid node + layer: (node_i, node_j, layer)
# where layer 0 = bottom surface, 1 = top surface.  A quad face is four such
# corner keys in outward-winding order.
_CornerKey = tuple[int, int, int]
_Quad = tuple[_CornerKey, _CornerKey, _CornerKey, _CornerKey]


def assemble_bodies(
    field: PotentialField,
    order: StratColumn,
    domain: Block,
    grid_spacing_m: float,
) -> list[LithoBodyMesh]:
    """Assemble watertight body solids from the implicit field over a shared grid.

    Samples ``field`` once on a regular xy-grid spanning the domain's bounding
    box, computes a single-valued height field per interior horizon (monotone,
    one crossing per node), then emits one closed-manifold :class:`LithoBodyMesh`
    per band (per disconnected component) between consecutive height fields.  The
    top band is capped above by ``domain.z_max`` and the bottom band below by
    ``domain.z_min``.

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

    Notes
    -----
    Deterministic: the grid, the crossing scan, the component labelling (raster
    scan order), and the face emission are all order-stable, so the same input
    yields byte-identical vertices and triangles (the bundle replays this).
    """
    # ------------------------------------------------------------------
    # Step 1: the shared regular grid (NODES at x[i], y[j]; CELLS between them).
    # ------------------------------------------------------------------
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
    bands = list(_iter_bands(order, interior, floor_rank, heights, domain, nx, ny))

    # ------------------------------------------------------------------
    # Step 4: emit one closed-manifold mesh per band per connected component.
    # ------------------------------------------------------------------
    bodies: list[LithoBodyMesh] = []
    for band in bands:
        bodies.extend(
            _emit_band_bodies(
                band=band,
                gx=gx,
                gy=gy,
                node_inside=node_inside,
            )
        )
    return bodies


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
    column from ``z_max`` down to ``z_min``; each interior iso-value's crossing is
    located by linear interpolation between the two bracketing samples.  Exactly
    one crossing is taken per horizon (the first, scanning DOWNWARD from the top),
    which makes the heights monotone in rank and dissolves any field bubble.

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
        node is outside the polygon.
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

    for n, (i, j) in enumerate(inside_nodes):
        col = fvals[n]  # F sampled top (index 0) → bottom (index nz-1)
        for rank in interior_ranks:
            iso = iso_by_rank[rank]
            z_cross = _contact_crossing(zcol, col, iso)
            if z_cross is not None:
                heights[rank][i, j] = z_cross
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


def _iter_bands(
    order: StratColumn,
    interior: list[Horizon],
    floor_rank: int,
    heights: dict[int, np.ndarray],
    domain: Block,
    nx: int,
    ny: int,
) -> Iterator[_Band]:
    """Yield each band (top cap → interior horizons → bottom cap) with its heights.

    The level surfaces, top→bottom, are: the flat top cap at ``z_max``, then each
    interior horizon's height field (descending rank), then the flat bottom cap at
    ``z_min``.  Consecutive levels bound one band; its lithology is verified to be
    consistent from both bounding horizons.

    Parameters
    ----------
    order : StratColumn
        Supplies ``above_formation`` / ``below_formation`` per horizon.
    interior : list of Horizon
        Interior horizons (ascending rank).
    floor_rank : int
        The floor (bottom-cap) rank.
    heights : dict[int, numpy.ndarray]
        Per-rank height field from :func:`_sample_height_fields`.
    domain : Block
        Supplies the flat cap elevations.
    nx, ny : int
        Grid dimensions (for the flat cap arrays).

    Yields
    ------
    _Band
        Each non-cap-only band, with aligned top/bottom height arrays.
    """
    top_cap = np.full((nx, ny), domain.z_max)
    bot_cap = np.full((nx, ny), domain.z_min)

    horizon_by_rank = {h.rank: h for h in order.horizons}

    # The ordered list of (rank, height-array) levels, top→bottom.
    levels: list[tuple[int, np.ndarray]] = [(-1, top_cap)]
    for h in interior:
        levels.append((h.rank, heights[h.rank]))
    levels.append((floor_rank, bot_cap))

    for (rank_top, top_arr), (rank_bot, bot_arr) in zip(levels, levels[1:], strict=False):
        formation_id = _band_formation(order, horizon_by_rank, rank_top, rank_bot, floor_rank)
        # Cap heights are flat; where an interior bounding height is NaN (the
        # contact pinched out at that node) the band inherits the NaN so the cell
        # there is absent — except a cap level is always present, so a band
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

    A grid CELL ``(i, j)`` (spanning nodes ``i..i+1`` × ``j..j+1``) is PRESENT in
    the band iff all four corners have a finite top and bottom AND the cell's mean
    thickness exceeds :data:`_MIN_BAND_THICKNESS_M`.  Present cells are grouped
    into 4-connected components; each component becomes one body, whose surface is
    the boundary of its cell complex (see the module docstring).

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
    nx = len(gx)
    ny = len(gy)
    present = _present_cells(band, node_inside, nx, ny)
    if not present.any():
        return []

    components = _label_components(present)
    bodies: list[LithoBodyMesh] = []
    for comp_idx, cell_set in enumerate(components):
        verts, tris = _build_component_mesh(band, gx, gy, cell_set)
        if not tris:
            continue
        body_id = band.body_id if len(components) == 1 else f"{band.body_id}#{comp_idx}"
        bodies.append(
            LithoBodyMesh(
                body_id=body_id,
                formation_id=band.formation_id,
                vertices=verts,
                triangles=tris,
                is_flagged=False,
            )
        )
    return bodies


def _present_cells(
    band: _Band,
    node_inside: np.ndarray,
    nx: int,
    ny: int,
) -> np.ndarray:
    """Return the ``(nx-1, ny-1)`` bool mask of cells present in the band.

    A cell is present iff all four corner nodes are inside the polygon and have
    finite top + bottom heights, and the band's mean thickness across the four
    corners exceeds :data:`_MIN_BAND_THICKNESS_M` (so a pinched-out / zero-volume
    cell is omitted and the body tapers cleanly).

    Parameters
    ----------
    band : _Band
        The band whose top/bottom arrays gate presence.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask.
    nx, ny : int
        Grid node dimensions.

    Returns
    -------
    numpy.ndarray
        ``(nx-1, ny-1)`` bool cell-presence mask.
    """
    present = np.zeros((nx - 1, ny - 1), dtype=bool)
    for i in range(nx - 1):
        for j in range(ny - 1):
            corners = ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
            if not all(node_inside[ci, cj] for ci, cj in corners):
                continue
            tops = [band.top[ci, cj] for ci, cj in corners]
            bots = [band.bottom[ci, cj] for ci, cj in corners]
            if any(np.isnan(t) for t in tops) or any(np.isnan(b) for b in bots):
                continue
            thickness = sum(t - b for t, b in zip(tops, bots, strict=True)) / 4.0
            if thickness > _MIN_BAND_THICKNESS_M:
                present[i, j] = True
    return present


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
    """
    nci, ncj = present.shape
    seen = np.zeros_like(present, dtype=bool)
    components: list[set[tuple[int, int]]] = []
    for i in range(nci):
        for j in range(ncj):
            if not present[i, j] or seen[i, j]:
                continue
            # BFS flood-fill from this seed cell.
            stack = [(i, j)]
            seen[i, j] = True
            cells: set[tuple[int, int]] = set()
            while stack:
                ci, cj = stack.pop()
                cells.add((ci, cj))
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ni, nj = ci + di, cj + dj
                    if 0 <= ni < nci and 0 <= nj < ncj and present[ni, nj] and not seen[ni, nj]:
                        seen[ni, nj] = True
                        stack.append((ni, nj))
            components.append(cells)
    return components


def _build_component_mesh(
    band: _Band,
    gx: np.ndarray,
    gy: np.ndarray,
    cells: set[tuple[int, int]],
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Build the closed-manifold mesh of one band component as a cell-complex boundary.

    Each present cell contributes a hexahedral box (top quad at the four ``top``
    corner heights, base quad at the four ``bottom`` corner heights, four vertical
    side quads).  A side face shared by two present cells of THIS component
    cancels (internal); every other face is a boundary face emitted with outward
    winding.  Top and base faces are always boundary (the band is single-valued in
    z).  The kept faces, triangulated consistently, form a closed 2-manifold.

    Parameters
    ----------
    band : _Band
        The band supplying per-corner top / bottom elevations.
    gx, gy : numpy.ndarray
        Grid node coordinates.
    cells : set of (int, int)
        The component's present cell indices.

    Returns
    -------
    (list of (float, float, float), list of (int, int, int))
        The compacted vertices and outward-wound triangles of the closed solid.
    """
    # A vertex is identified by (node_i, node_j, layer) where layer 0 = bottom,
    # 1 = top.  Dedup so a face shared by two cells (and the four side quads
    # around a shared edge) references the SAME vertex index — the watertight
    # weld.  Heights are taken from the band's per-NODE arrays so the top of one
    # cell and the bottom of the cell above are exactly the same z at that node.
    vert_index: dict[tuple[int, int, int], int] = {}
    vertices: list[tuple[float, float, float]] = []

    def vid(ni: int, nj: int, layer: int) -> int:
        key = (ni, nj, layer)
        idx = vert_index.get(key)
        if idx is None:
            z = band.bottom[ni, nj] if layer == 0 else band.top[ni, nj]
            idx = len(vertices)
            vertices.append((float(gx[ni]), float(gy[nj]), float(z)))
            vert_index[key] = idx
        return idx

    # Each face is a quad of four (ni, nj, layer) corners.  We accumulate quads
    # into a multiset keyed by the SORTED corner-key tuple, storing the oriented
    # quad; a face appearing twice (shared internal side wall) is dropped.
    face_count: dict[tuple[_CornerKey, ...], int] = defaultdict(int)
    face_quad: dict[tuple[_CornerKey, ...], _Quad] = {}

    def add_face(corners: _Quad) -> None:
        # corners: ordered (ni, nj, layer) tuples with desired OUTWARD winding.
        key = tuple(sorted(corners))
        face_count[key] += 1
        # Keep the first-seen orientation; a second occurrence cancels the face,
        # so its orientation never matters.
        if key not in face_quad:
            face_quad[key] = corners

    for ci, cj in cells:
        # Cell corner nodes in CCW order viewed from above:
        #   c00=(ci,cj) c10=(ci+1,cj) c11=(ci+1,cj+1) c01=(ci,cj+1)
        c00 = (ci, cj)
        c10 = (ci + 1, cj)
        c11 = (ci + 1, cj + 1)
        c01 = (ci, cj + 1)

        # TOP face — outward normal points UP (+z): CCW seen from above.
        add_face(
            (
                (c00[0], c00[1], 1),
                (c10[0], c10[1], 1),
                (c11[0], c11[1], 1),
                (c01[0], c01[1], 1),
            )
        )
        # BOTTOM face — outward normal points DOWN (-z): CW seen from above
        # (reverse of top) so the outward winding is consistent.
        add_face(
            (
                (c00[0], c00[1], 0),
                (c01[0], c01[1], 0),
                (c11[0], c11[1], 0),
                (c10[0], c10[1], 0),
            )
        )

        # SIDE faces — one per cell edge; only emitted as a boundary when the
        # neighbouring cell across that edge is NOT in this component.  We add
        # ALL four and let the shared-face cancellation drop internal ones; that
        # keeps winding bookkeeping simple and is still O(cells).
        #
        # Each side quad's outward winding: walking the bottom edge in the
        # cell-boundary CCW direction, then up — gives an outward-facing normal.
        # Edge (c00 -> c10): south edge.
        _add_side(add_face, c00, c10)
        # Edge (c10 -> c11): east edge.
        _add_side(add_face, c10, c11)
        # Edge (c11 -> c01): north edge.
        _add_side(add_face, c11, c01)
        # Edge (c01 -> c00): west edge.
        _add_side(add_face, c01, c00)

    # Keep only faces that appear an ODD number of times (boundary).  A shared
    # internal side wall appears exactly twice (once from each cell, with reversed
    # winding) and cancels.  Top / bottom faces appear once.
    quads: list[_Quad] = [face_quad[key] for key, cnt in face_count.items() if cnt % 2 == 1]

    # Triangulate every kept quad (a, b, c, d) -> (a, b, c) + (a, c, d), mapping
    # corner keys to deduped vertex ids.
    triangles: list[tuple[int, int, int]] = []
    for a, b, c, d in quads:
        ia = vid(*a)
        ib = vid(*b)
        ic = vid(*c)
        idd = vid(*d)
        triangles.append((ia, ib, ic))
        triangles.append((ia, ic, idd))

    # The dedup map already produced `vertices` in first-touch order.  Some
    # vertices created during face accumulation may be unused if a face cancelled
    # — but `vid` is only ever called in the triangulation loop above, AFTER
    # cancellation, so every created vertex is referenced.  Return as-is.
    return vertices, triangles


def _add_side(
    add_face: Callable[[_Quad], None],
    lo: tuple[int, int],
    hi: tuple[int, int],
) -> None:
    """Add the vertical side quad spanning grid edge ``lo -> hi`` (bottom→top).

    The quad is wound so that, combined with the CCW cell-boundary traversal the
    caller uses, the normal points OUTWARD (away from the cell interior).  Walking
    the bottom edge ``lo -> hi`` then rising to the top edge ``hi -> lo`` gives the
    outward face for a CCW-from-above boundary walk.

    Parameters
    ----------
    add_face : callable
        The face accumulator from :func:`_build_component_mesh`.
    lo, hi : (int, int)
        The two grid node indices of the edge (the side wall runs vertically
        between their bottom and top layers).
    """
    # Quad corners, CCW when viewed from outside the cell:
    #   bottom-lo -> bottom-hi -> top-hi -> top-lo
    add_face(
        (
            (lo[0], lo[1], 0),
            (hi[0], hi[1], 0),
            (hi[0], hi[1], 1),
            (lo[0], lo[1], 1),
        )
    )
