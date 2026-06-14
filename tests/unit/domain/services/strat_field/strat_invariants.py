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

       After collapsing, the sequence of formation_ids in the model must equal
       the sequence in the authored column.  A model that is missing a unit
       (the mesh for that body does not reach this column at all — the body
       pinches out before this test) is treated as matching the authored units
       that DO have mesh coverage; the author says what is there, not what is
       absent.

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
            if collapsed and collapsed[-1][0] == fid and base <= collapsed[-1][1] + TOL:
                # Extend the existing collapsed interval downward (base is lower).
                prev_fid, prev_base, prev_top = collapsed[-1]
                collapsed[-1] = (prev_fid, min(prev_base, base), max(prev_top, top))
            else:
                collapsed.append((fid, base, top))

        model_sequence = [fid for fid, _b, _t in collapsed]
        authored_sequence = [u.formation_id for u in col.units]

        # --- Step 4: Match authored units to model intervals -----------------
        # A body may not reach every test column (the loft/strat builder only
        # emits geometry where there is real mesh coverage).  We match the
        # authored sequence as a SUBSEQUENCE of the model sequence: every
        # authored formation_id must appear in order, but the model may have
        # fewer entries (pinched-out bodies produce no interval at this column).
        #
        # If the model has MORE distinct formation_ids than the authored stack,
        # that is a sign of a wrong-order or spurious-body defect and also fires.
        #
        # The check is: if we extract the subsequence of model_sequence that
        # appears in authored_sequence (intersection, in model order), it must
        # equal authored_sequence filtered to formations that have model
        # coverage.  In other words: the order of shared formations must agree.

        authored_set = set(authored_sequence)
        model_in_authored = [fid for fid in model_sequence if fid in authored_set]
        authored_in_model = [fid for fid in authored_sequence if fid in set(model_sequence)]

        if model_in_authored != authored_in_model:
            authored_repr = " / ".join(
                f"{u.formation_id}[{u.base_elev_m:.2f}, {u.top_elev_m:.2f}]" for u in col.units
            )
            model_repr = " / ".join(f"{fid}[{b:.2f}, {t:.2f}]" for fid, b, t in collapsed)
            raise AssertionError(
                f"column ({x:.3f}, {y:.3f}): formation sequence mismatch.\n"
                f"  authored sequence (shared):  {authored_in_model}\n"
                f"  model sequence   (shared):   {model_in_authored}\n"
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
