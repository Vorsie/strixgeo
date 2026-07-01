"""Geometry-invariant assert helpers for the implicit stratigraphic 3-D builder.

Test-only module of plain functions (NOT pytest test cases).  Imported by
``test_strat_invariants.py`` and will be imported by Stage-5's
``test_assemble_bodies.py`` (Task 6) once the body-assembly service exists.

Ported from ``tests/unit/domain/services/loft_invariants.py`` (the loft
builder's counterpart, which is deleted in Task 9 so this becomes the single
home).  The ported helpers are functionally identical; only their docstrings
are updated to remove the ``LoftField`` / ``assert_tiles_domain`` references
that do not apply to the strat builder.

Contracts exposed
-----------------
* :func:`assert_closed_manifold` — every undirected edge shared by exactly 2
  triangles; every directed edge appears exactly once (consistent outward
  winding).
* :func:`vertical_ray_intervals` — the SHARED primitive; ray-cast a vertical
  line through a closed mesh, return solid ``(base, top)`` intervals via
  even-odd crossing pairing.
* :func:`assert_no_overlap_sampled` — no two DIFFERENT bodies occupy the same
  vertical interval at any sampled ``(x, y)``.  The overlap tolerance is the
  strict :data:`TOL` = 1e-6 m — touching faces of adjacent tiled bodies do
  NOT count as overlap, and a sub-tolerance seam is not a real gap.
* :func:`assert_model_matches_columns` — the section-column diff: for each
  authored column the model's ray-sampled formation sequence must match the
  authored formation sequence (no overlaps, same formation order, authored base
  elevations reproduced within ``tol_m``).  This is the assertion that would
  have caught the old loft builder's 50-metre-scale overlaps.

Pure geometry — no I/O, no logging.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

# Overlap / touching-face tolerance.  Comparisons closer than this are treated
# as coincident.  A shared face between two neighbouring bodies is hit by the
# ray at exactly the same elevation from both triangles; deduplication inside
# ``vertical_ray_intervals`` collapses these so the seam does not register as
# a sub-TOL overlap.
TOL: float = 1e-6

# Map-plane nudge applied to a ray's query point so it never lands EXACTLY on a
# shared cell seam (a vertical face between two laterally-abutting bodies).  A
# ray coplanar with such a seam grazes the coincident +z/-z faces of BOTH
# abutting bodies (``_point_in_triangle_2d`` is edge-inclusive), so each body
# spuriously reports the seam voxel — two abutting bodies read as a one-voxel
# OVERLAP even though they only TOUCH.  Nudging the query a hair toward +x/+y
# resolves the ray onto exactly one side of every seam — the map-plane analogue
# of the labeller's half-open ``[base, top)`` convention (a point on a boundary
# belongs to one cell, never both).  The shift is far below any real voxel size
# (sub-µm at metre-scale grids) yet far above the ``1e-12`` barycentric epsilon
# in ``_point_in_triangle_2d``, so it changes no non-degenerate query: a sample
# at a voxel CENTRE stays in its voxel, a sample OUTSIDE the footprint stays
# outside.  It only disambiguates the measure-zero on-seam case.
_SEAM_NUDGE_M: float = 1e-9


# ---------------------------------------------------------------------------
# Manifold / winding
# ---------------------------------------------------------------------------


def assert_closed_manifold(
    vertices: Sequence[tuple[float, float, float]],
    triangles: Sequence[tuple[int, int, int]],
) -> None:
    """Assert the mesh is a closed 2-manifold with consistent outward winding.

    Two checks:

    1. **Closed manifold** — every undirected edge ``{i, j}`` is shared by
       exactly two triangles.  A boundary (open) edge appears once; a
       non-manifold edge appears three or more times.
    2. **Consistent winding** — every DIRECTED edge ``(i, j)`` appears exactly
       once, i.e. each shared edge is traversed in OPPOSITE directions by its
       two triangles (the hallmark of a consistently-oriented closed surface).

    Parameters
    ----------
    vertices : Sequence[tuple[float, float, float]]
        Mesh vertices (unused beyond a non-empty guard; kept for a uniform
        helper signature).
    triangles : Sequence[tuple[int, int, int]]
        Triangle index triples.

    Raises
    ------
    AssertionError
        With a diagnostic naming the first offending edge and its multiplicity.
    """
    assert triangles, "mesh has no triangles"

    undirected: Counter[frozenset[int]] = Counter()
    directed: Counter[tuple[int, int]] = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            undirected[frozenset((u, v))] += 1
            directed[(u, v)] += 1

    for edge, count in undirected.items():
        if count != 2:
            i, j = tuple(edge)
            raise AssertionError(
                f"not a closed manifold: undirected edge {{{i}, {j}}} is shared "
                f"by {count} triangle(s), expected exactly 2"
            )

    for (u, v), count in directed.items():
        if count != 1:
            raise AssertionError(
                f"inconsistent winding: directed edge ({u} -> {v}) appears "
                f"{count} time(s), expected exactly 1 (its two triangles should "
                f"traverse the shared edge in opposite directions)"
            )


# ---------------------------------------------------------------------------
# Vertical ray casting
# ---------------------------------------------------------------------------


def _point_in_triangle_2d(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    cx: float,
    cy: float,
) -> bool:
    """Return True iff ``(px, py)`` lies inside triangle ``(a, b, c)`` in the xy-plane.

    Barycentric sign test; a point on an edge counts as inside (``>= -eps``) so
    a ray skimming a shared triangle edge is not silently dropped.  The caller
    deduplicates near-coincident crossings so an edge-grazing double count is
    collapsed before pairing.

    Parameters
    ----------
    px, py : float
        Query point in the xy-plane.
    ax, ay, bx, by, cx, cy : float
        Triangle vertex positions in the xy-plane.

    Returns
    -------
    bool
        ``True`` when the query point is inside or on the boundary of the
        triangle; ``False`` for a degenerate (zero-area) triangle footprint.
    """
    # Degenerate (zero-area) footprint never contains a point.
    denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denom) < 1e-15:
        return False
    eps = 1e-12
    la = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
    lb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
    lc = 1.0 - la - lb
    return la >= -eps and lb >= -eps and lc >= -eps


def vertical_ray_intervals(
    vertices: Sequence[tuple[float, float, float]],
    triangles: Sequence[tuple[int, int, int]],
    x: float,
    y: float,
) -> list[tuple[float, float]]:
    """Return the solid ``(base, top)`` intervals of a mesh along the vertical line at ``(x, y)``.

    Casts a vertical ray (the +z line at ``(x, y)``), collects the z-elevation
    of every triangle whose 2-D footprint contains ``(x, y)``, deduplicates
    near-coincident crossings (an edge shared by two triangles is hit by both),
    sorts them, and pairs them odd-even into solid intervals.

    Even-odd assumption
    -------------------
    A closed manifold is crossed an EVEN number of times by any line in general
    position; consecutive crossings (sorted) bound alternating solid/void spans,
    so pairing ``(crossings[0], crossings[1])``,
    ``(crossings[2], crossings[3])``, … recovers the solid intervals.  This
    holds only for a CLOSED mesh — call :func:`assert_closed_manifold` first.

    On-seam queries
    ---------------
    "Line in general position" is exactly what a query landing on a shared cell
    seam is NOT: a ray coplanar with a vertical face between two laterally-
    abutting bodies grazes the coincident top/bottom faces of BOTH bodies'
    boundary cells (the edge-inclusive :func:`_point_in_triangle_2d`), so the
    even-odd pairing splits the body into spurious one-voxel slivers AND each
    abutting body reports the seam voxel — two bodies that only TOUCH read as an
    OVERLAP.  The query is therefore nudged by :data:`_SEAM_NUDGE_M` toward
    ``+x``/``+y`` so it resolves onto exactly one side of every seam (the map-
    plane analogue of the labeller's half-open ``[base, top)`` convention).  The
    shift is far below any real voxel size and far above the barycentric epsilon,
    so it disambiguates ONLY the measure-zero on-seam case — a voxel-centre or
    outside-footprint query is unaffected.

    Parameters
    ----------
    vertices : Sequence[tuple[float, float, float]]
        Mesh vertices ``(x, y, z)``.
    triangles : Sequence[tuple[int, int, int]]
        Triangle index triples.
    x, y : float
        Map-plane query coordinates.

    Returns
    -------
    list[tuple[float, float]]
        ``(base, top)`` intervals (base below top).  Empty when the ray misses
        the mesh footprint.
    """
    # Nudge off any shared cell seam so the ray resolves onto exactly one side
    # (see "On-seam queries" above).  A horizontal face's interpolated z is
    # constant across the face, so this sub-µm map-plane shift leaves every
    # returned interval elevation bit-identical for a non-degenerate query.
    x = x + _SEAM_NUDGE_M
    y = y + _SEAM_NUDGE_M
    zs: list[float] = []
    for a, b, c in triangles:
        ax, ay, az = vertices[a]
        bx, by, bz = vertices[b]
        cx, cy, cz = vertices[c]
        if not _point_in_triangle_2d(x, y, ax, ay, bx, by, cx, cy):
            continue
        # Planar interpolation of z at (x, y) within the triangle.  Solve the
        # barycentric weights again (cheap) and blend the corner elevations.
        denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(denom) < 1e-15:
            continue  # vertical / zero-area triangle contributes no crossing
        la = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
        lb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
        lc = 1.0 - la - lb
        zs.append(la * az + lb * bz + lc * cz)

    if not zs:
        return []

    zs.sort()
    # Deduplicate crossings that coincide within tolerance: a shared horizontal
    # edge is hit by both its triangles, doubling the crossing count.  Collapsing
    # near-equal crossings restores the even-odd pairing.
    deduped: list[float] = [zs[0]]
    for z in zs[1:]:
        if abs(z - deduped[-1]) > TOL:
            deduped.append(z)

    # Even-odd pairing.  A closed manifold always yields an even crossing count,
    # so the ``len - 1`` stop never drops a real interval.  An ODD count means the
    # mesh is not closed (or the ray exactly grazed a vertex) — the trailing
    # crossing is dropped by design, which surfaces as an overlap/column-diff
    # assertion failure downstream rather than a silent wrong answer here.
    intervals: list[tuple[float, float]] = []
    for k in range(0, len(deduped) - 1, 2):
        base, top = deduped[k], deduped[k + 1]
        if top - base > TOL:
            intervals.append((base, top))
    return intervals


# ---------------------------------------------------------------------------
# Internal interval helpers
# ---------------------------------------------------------------------------


def _intervals_overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Return the overlap length of two ``(base, top)`` intervals (0 if disjoint).

    Parameters
    ----------
    a, b : tuple[float, float]
        Interval pairs ``(base, top)`` with ``base < top``.

    Returns
    -------
    float
        The length of the intersection, or 0.0 when the intervals are disjoint
        or only touch at a single point.
    """
    lo = max(a[0], b[0])
    hi = min(a[1], b[1])
    return max(0.0, hi - lo)


def _union_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Merge a list of ``(base, top)`` intervals into disjoint sorted spans.

    Touching intervals (gap ≤ :data:`TOL`) are merged so the band-to-band
    seams of a tiling do not register as holes.

    Parameters
    ----------
    intervals : list[tuple[float, float]]
        Unsorted list of ``(base, top)`` intervals.

    Returns
    -------
    list[tuple[float, float]]
        Sorted, disjoint, merged intervals.
    """
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged: list[tuple[float, float]] = [ordered[0]]
    for base, top in ordered[1:]:
        last_base, last_top = merged[-1]
        if base <= last_top + TOL:
            merged[-1] = (last_base, max(last_top, top))
        else:
            merged.append((base, top))
    return merged


# ---------------------------------------------------------------------------
# No-overlap (pairwise, sampled)
# ---------------------------------------------------------------------------


def assert_no_overlap_sampled(
    meshes: Sequence[object],
    samples: Sequence[tuple[float, float]],
) -> None:
    """Assert no two DIFFERENT bodies' meshes interpenetrate at any sample point.

    For each ``(x, y)`` sample, gather every mesh's vertical intervals and
    assert that intervals belonging to DIFFERENT bodies do not overlap by more
    than :data:`TOL`.  Intervals from the SAME body (same ``body_id``) are
    allowed to stack — a body that appears more than once (e.g. a lens void
    carved from a matrix) may produce multiple disjoint intervals.

    Parameters
    ----------
    meshes : Sequence[object]
        Objects exposing ``body_id``, ``vertices``, ``triangles`` (e.g.
        :class:`~groundmodel.domain.value_objects.litho_body_mesh.LithoBodyMesh`).
    samples : Sequence[tuple[float, float]]
        Map-plane ``(x, y)`` query points.

    Raises
    ------
    AssertionError
        Naming the sample, the two bodies, and the overlap length.
    """
    for x, y in samples:
        per_body: list[tuple[str, tuple[float, float]]] = []
        for m in meshes:
            body_id = getattr(m, "body_id")
            for iv in vertical_ray_intervals(m.vertices, m.triangles, x, y):  # type: ignore[attr-defined]
                per_body.append((body_id, iv))
        for i in range(len(per_body)):
            for j in range(i + 1, len(per_body)):
                bid_i, iv_i = per_body[i]
                bid_j, iv_j = per_body[j]
                if bid_i == bid_j:
                    continue
                ov = _intervals_overlap(iv_i, iv_j)
                if ov > TOL:
                    raise AssertionError(
                        f"overlap at ({x:.3f}, {y:.3f}): body {bid_i!r} interval "
                        f"{iv_i} overlaps body {bid_j!r} interval {iv_j} by "
                        f"{ov:.6f} m (> {TOL})"
                    )


def assert_no_overlap_rastered(
    meshes: Sequence[object],
    *,
    nx: int = 16,
    ny: int = 16,
) -> None:
    """Assert no two bodies interpenetrate, sampling a DENSE grid over the hull.

    :func:`assert_no_overlap_sampled` only checks the ``(x, y)`` points the
    caller supplies — typically a handful (~6), so an overlap confined to a
    region BETWEEN those points slips through undetected.  This variant derives
    the map-plane bounding box from every mesh's vertices and rasters an
    ``nx x ny`` grid of CELL-CENTRE sample points across it, so a localised
    interpenetration (a corner overlap, a thin sliver) is caught without the
    caller having to guess where it is.

    Cell centres (``(i + 0.5) / nx``) are used rather than grid nodes so a
    sample never lands exactly on a box edge / shared vertical seam, where a
    grazing ray could spuriously read a contact as an overlap (the half-open
    seam convention that :func:`assert_no_overlap_sampled` documents).

    Parameters
    ----------
    meshes : Sequence[object]
        Objects exposing ``body_id``, ``vertices``, ``triangles``.
    nx, ny : int
        Grid resolution across the x / y extent of the combined hull.

    Raises
    ------
    AssertionError
        Via :func:`assert_no_overlap_sampled` — naming the offending sample,
        the two bodies, and the overlap length.
    """
    xs: list[float] = []
    ys: list[float] = []
    for m in meshes:
        for vx, vy, _vz in m.vertices:  # type: ignore[attr-defined]
            xs.append(vx)
            ys.append(vy)
    if not xs:
        return  # no geometry → nothing to sample
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    x_span = x_max - x_min
    y_span = y_max - y_min
    samples = [
        (
            x_min + (i + 0.5) / nx * x_span,
            y_min + (j + 0.5) / ny * y_span,
        )
        for i in range(nx)
        for j in range(ny)
    ]
    assert_no_overlap_sampled(meshes, samples)


# ---------------------------------------------------------------------------
# Section-column diff value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AuthoredUnit:
    """One lithostratigraphic unit as observed at a test location.

    Parameters
    ----------
    formation_id : str
        The lithology formation id (e.g. ``"ZAND"``, ``"KLEI"``).
    top_elev_m : float
        Top elevation in metres (positive-up; typically ``surface - top_depth``).
    base_elev_m : float
        Base elevation in metres, strictly less than ``top_elev_m``.
    """

    formation_id: str
    top_elev_m: float
    base_elev_m: float


@dataclass(frozen=True)
class AuthoredColumn:
    """Authored litho stack at one investigation location.

    The ``units`` tuple is ordered top→bottom (shallowest unit first, i.e.
    units[0].top_elev_m > units[1].top_elev_m > …).

    Parameters
    ----------
    x : float
        Easting of the investigation in project CRS.
    y : float
        Northing of the investigation in project CRS.
    units : tuple[AuthoredUnit, ...]
        Authored litho stack, ordered top → bottom.
    """

    x: float
    y: float
    units: tuple[AuthoredUnit, ...]


# ---------------------------------------------------------------------------
# Section-column diff
# ---------------------------------------------------------------------------


def _is_subsequence(sub: Sequence[str], full: Sequence[str]) -> bool:
    """Return whether ``sub`` is a subsequence of ``full`` (order-preserving).

    ``sub`` is a subsequence of ``full`` iff ``full`` can be reduced to ``sub``
    by deleting zero or more elements WITHOUT reordering the rest.  Used to test
    that the model's formation order matches the authored order up to pinch-outs
    (deletions) but never a reordering or a spurious formation.

    Parameters
    ----------
    sub : Sequence[str]
        The candidate subsequence (the model formation order).
    full : Sequence[str]
        The reference sequence (the authored formation order).

    Returns
    -------
    bool
        ``True`` if every element of ``sub`` can be matched in ``full`` in order.
    """
    it = iter(full)
    return all(any(s == f for f in it) for s in sub)


def assert_model_matches_columns(
    bodies: Sequence[object],
    columns: Sequence[AuthoredColumn],
    tol_m: float,
) -> None:
    """Assert the 3-D model reproduces the authored column stacks at every test location.

    This is the critical invariant the old loft builder violated: when a mesh
    assignment error caused two different bodies to occupy the same vertical span
    at a test location, the 50-metre-scale overlaps would have fired here.

    For each :class:`AuthoredColumn`, this helper:

    1. **Ray-samples** every body at ``(x, y)`` via
       :func:`vertical_ray_intervals`, tagging each interval with its body's
       ``formation_id``.  The resulting "model stack" is the set of all
       ``(formation_id, base, top)`` solid intervals at that column, sorted
       top→bottom (descending top elevation).

    2. **Checks no-overlap** between intervals from DIFFERENT bodies at this
       column.  An overlap > :data:`TOL` fires immediately (the loft failure
       reproducer).

    3. **Checks formation sequence**: the model stack's formation sequence
       (collapsing consecutive same-formation intervals before comparing) must
       match the authored column's formation sequence in the same top→bottom
       order.

       Matching rule (collapse-then-compare)
       -------------------------------------
       Two or more touching intervals with the same ``formation_id`` are
       collapsed into one before comparing, because a body whose mesh was
       built by lofting two slightly-offset sections may produce two back-to-
       back intervals at a test column where the authored stack shows a single
       unit.  This is a legal rendering artefact: the material is the same, the
       boundary is an internal seam.  What matters is the ORDER of distinct
       soil types, not the exact slice count.

       After collapsing, the model formation sequence must be a SUBSEQUENCE of
       the authored sequence: every model formation appears, in order, after
       deleting zero or more authored units (the units that pinched out before
       this column).  A reordering or a spurious formation breaks the
       subsequence and fires.  For an interbedded authored stack almost any
       order is a valid subsequence, so this check is intentionally weak there —
       the per-position base-elevation check below is the real discriminator for
       an interbedded reordering (a swapped interbed lands at the wrong base).

    4. **Checks base elevations**: for each authored unit whose ``formation_id``
       appears in the collapsed model stack, the model's interval base elevation
       must match the authored base elevation within ``tol_m``.

    Parameters
    ----------
    bodies : Sequence[object]
        Objects exposing ``body_id``, ``formation_id``, ``vertices``,
        ``triangles`` (duck-typed; ``LithoBodyMesh`` satisfies this).
    columns : Sequence[AuthoredColumn]
        The expected authored litho stacks, one per investigation location.
    tol_m : float
        Elevation tolerance in metres for base-elevation comparison.

    Raises
    ------
    AssertionError
        With a diagnostic naming the column ``(x, y)``, the authored vs model
        stacks, and the specific divergence (overlap, sequence mismatch, or base
        elevation error).
    """
    for col in columns:
        x, y = col.x, col.y

        # --- Step 1: Ray-sample every body, tag with formation_id -------------
        # Each entry: (body_id, formation_id, base, top)
        raw: list[tuple[str, str, float, float]] = []
        for m in bodies:
            body_id: str = getattr(m, "body_id")
            formation_id: str = getattr(m, "formation_id")
            for base, top in vertical_ray_intervals(m.vertices, m.triangles, x, y):  # type: ignore[attr-defined]
                raw.append((body_id, formation_id, base, top))

        if not raw:
            # No body has mesh coverage at this column — this is fine if the
            # whole column is a pinch-out corridor, but always passes the diff
            # (there is nothing to contradict the authored stack).
            continue

        # Sort model intervals top→bottom (descending top elevation).
        raw.sort(key=lambda r: -r[3])

        # --- Step 2: No-overlap between DIFFERENT bodies at this column -------
        for i in range(len(raw)):
            for j in range(i + 1, len(raw)):
                bid_i, _, base_i, top_i = raw[i]
                bid_j, _, base_j, top_j = raw[j]
                if bid_i == bid_j:
                    continue
                ov = _intervals_overlap((base_i, top_i), (base_j, top_j))
                if ov > TOL:
                    authored_repr = " / ".join(
                        f"{u.formation_id}[{u.base_elev_m:.2f}, {u.top_elev_m:.2f}]"
                        for u in col.units
                    )
                    model_repr = " / ".join(
                        f"{fid}[{b:.2f}, {t:.2f}]@{bid}" for bid, fid, b, t in raw
                    )
                    raise AssertionError(
                        f"column ({x:.3f}, {y:.3f}): bodies {bid_i!r} and "
                        f"{bid_j!r} overlap by {ov:.6f} m — this is the "
                        f"exact class of defect the old loft builder had at "
                        f"50-metre scale.\n"
                        f"  authored: {authored_repr}\n"
                        f"  model:    {model_repr}"
                    )

        # --- Step 3: Collapse consecutive same-formation intervals -----------
        # A legal mesh seam can split one authored unit into two back-to-back
        # intervals with the same formation_id; collapse them so that only the
        # formation SEQUENCE (the distinct soil-type order) is compared.
        collapsed: list[tuple[str, float, float]] = []  # (formation_id, base, top)
        for _, fid, base, top in raw:
            # Merge ONLY when this interval actually TOUCHES the previous one of
            # the same formation: sorted top→bottom, the previous entry is
            # shallower, so they touch iff this interval's TOP reaches up to the
            # previous BASE (collapsed[-1][1]).  Comparing this base to the
            # previous base would always be true for disjoint intervals and would
            # silently swallow a real GAP between two same-formation bodies — a
            # hole the diff must surface, not hide.
            if collapsed and collapsed[-1][0] == fid and top >= collapsed[-1][1] - TOL:
                # Extend the existing collapsed interval downward (base is lower).
                prev_fid, prev_base, prev_top = collapsed[-1]
                collapsed[-1] = (prev_fid, min(prev_base, base), max(prev_top, top))
            else:
                collapsed.append((fid, base, top))

        model_sequence = [fid for fid, _b, _t in collapsed]
        authored_sequence = [u.formation_id for u in col.units]

        # --- Step 4: the model sequence must be a SUBSEQUENCE of the authored ---
        # A body may not reach every test column (the strat builder only emits
        # geometry where there is real mesh coverage), so the model may be MISSING
        # authored units (pinch-outs) — but it must never REORDER them or invent a
        # formation the authored stack does not have.  The exact rule: the model's
        # top→bottom formation sequence must be a subsequence of the authored
        # sequence (every model formation appears, in order, deleting zero or more
        # authored units).  A reordering or a spurious formation breaks the
        # subsequence and fires here.  A set-membership filter would instead
        # MISFIRE on a repeated formation with a partial pinch-out (authored
        # ZAND/SILT/ZAND, model ZAND/SILT) — a legal outcome — so it is wrong.
        #
        # NOTE: for an interbedded authored stack almost any order is a valid
        # subsequence, so this check is intentionally weak there; the per-position
        # base-elevation check (Step 5) is the real discriminator for interbedded
        # reordering (a swapped interbed lands at the wrong base elevation).
        if not _is_subsequence(model_sequence, authored_sequence):
            authored_repr = " / ".join(
                f"{u.formation_id}[{u.base_elev_m:.2f}, {u.top_elev_m:.2f}]" for u in col.units
            )
            model_repr = " / ".join(f"{fid}[{b:.2f}, {t:.2f}]" for fid, b, t in collapsed)
            raise AssertionError(
                f"column ({x:.3f}, {y:.3f}): formation sequence mismatch — the "
                f"model order is not a subsequence of the authored order.\n"
                f"  authored sequence: {authored_sequence}\n"
                f"  model sequence:    {model_sequence}\n"
                f"  authored full: {authored_repr}\n"
                f"  model full:    {model_repr}"
            )

        # --- Step 5: Check base elevations for covered formations ------------
        # Build a lookup from formation_id → model base elevation for the
        # collapsed stack.  When multiple same-id collapsed intervals exist (a
        # genuinely repeated formation, e.g. interbedded ZAND/SILT/ZAND), pair
        # by position using the shared ordered subsequence.
        model_base_by_position: dict[int, float] = {}
        model_pos = 0
        for authored_pos, authored_unit in enumerate(col.units):
            fid = authored_unit.formation_id
            # Advance to the next model interval for this formation.
            while model_pos < len(collapsed) and collapsed[model_pos][0] != fid:
                model_pos += 1
            if model_pos >= len(collapsed):
                # This formation is not in the model at this column (pinch-out).
                # Skip the base-elevation check — there is nothing to compare.
                continue
            model_base = collapsed[model_pos][1]
            model_base_by_position[authored_pos] = model_base
            model_pos += 1

        for authored_pos, authored_unit in enumerate(col.units):
            if authored_pos not in model_base_by_position:
                continue  # unit pinched out at this column — no check
            model_base = model_base_by_position[authored_pos]
            authored_base = authored_unit.base_elev_m
            err = abs(model_base - authored_base)
            if err > tol_m:
                authored_repr = " / ".join(
                    f"{u.formation_id}[{u.base_elev_m:.2f}, {u.top_elev_m:.2f}]" for u in col.units
                )
                model_repr = " / ".join(f"{fid}[{b:.2f}, {t:.2f}]" for fid, b, t in collapsed)
                raise AssertionError(
                    f"column ({x:.3f}, {y:.3f}): base elevation of "
                    f"{authored_unit.formation_id!r} unit #{authored_pos} "
                    f"differs by {err:.4f} m (tol {tol_m} m).\n"
                    f"  authored base: {authored_base:.4f} m\n"
                    f"  model base:    {model_base:.4f} m\n"
                    f"  authored full: {authored_repr}\n"
                    f"  model full:    {model_repr}"
                )
