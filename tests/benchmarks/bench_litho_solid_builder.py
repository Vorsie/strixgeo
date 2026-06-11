"""Litho-3D solid-builder performance benchmarks (milestone-2 + M3, Task 9).

Run with::

    uv run pytest tests/benchmarks/bench_litho_solid_builder.py --benchmark-enable -v

:func:`~groundmodel.domain.services.litho_solid_builder.build_body_solids` is
the new CPU-bound per-model surface introduced by the litho-3D milestone-2:
given all member-layer picks across a fence it fits one TIN-capped closed mesh
per body.  Per the CLAUDE.md "when to add a benchmark" rule (CPU-bound per-
element function, introduced alongside the code it measures) it lands here.

The function runs **once per model, on the user-clicked Build** — not per
render frame and not auto-batched.  Even the 200-body stress case is expected
to land comfortably in Python's interactive range.

Synthetic fence design (baseline — no lenses)
----------------------------------------------
* Investigations sit on a sparse grid so each body spans genuinely non-
  collinear (x, y) anchors — collinear inputs degenerate into flagged slabs
  and would measure the wrong (trivial) code path.  We use the same
  row-offset trick as ``bench_tin_surface.py``.
* Bodies are stacked vertically within each investigation column (body k's
  ``base_depth_m`` == body k+1's ``top_depth_m``) so the per-contact surface
  cache inside :func:`build_body_solids` is exercised: the base surface of
  body k and the top surface of body k+1 share the same elevation → one
  :func:`compute_tin` call, not two.

Baseline bracketing scales:

* small  — 10 bodies × ~6 investigations  (tiny fence, quick interactive).
* medium — 50 bodies × ~12 investigations (realistic project section).
* large  — 200 bodies × ~30 investigations (stress upper bound; a corridor
  of 30 CPTs each penetrating 200 m would give this many stacked units if
  every 1 m were a distinct formation, which is unrealistic — this is a
  genuine stress case, not an expected real-world size).

Enclosed-lens design (M3 code path)
-------------------------------------
One in every ten bodies is replaced by a MATRIX / LENS / MATRIX triplet:

* The surrounding *matrix* body spans the full depth band at every
  investigation.  At lens-present (interior) investigations the column is
  split: an upper matrix span, then the thin lens body, then a lower matrix
  span — so the matrix body_id appears both above and below the lens at each
  interior hole.  Outer-ring investigations carry the matrix as a single
  unbroken span.
* The thin *lens* body is present only at the interior subset of
  investigations, making it truly enclosed (absent at all boundary holes).
  :func:`detect_enclosed_lenses` detects it and :func:`build_body_solids`
  assembles the matrix as a solid-with-void (``is_flagged=False``).
* The ``lens`` benchmark builds the same total depth column as the baseline
  medium case, exercising the M3 void-carve path on ~1 lens per 10 bodies.

Baseline numbers land in CLAUDE.local.md after a stable run.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.litho_solid_builder import BodyLayerPick, build_body_solids

# ---------------------------------------------------------------------------
# Shared grid helpers
# ---------------------------------------------------------------------------

# Fraction of the investigation grid that hosts lens-present columns.
# The outermost ring (first/last in each axis) stays lens-absent so the lens
# body is truly enclosed (no edge holes).  Interior = a subset that is at
# least 3 non-collinear investigations so detect_enclosed_lenses fires on
# them and build_extent_solid can triangulate.
_LENS_PERIOD = 10  # one lens body per this many regular bodies
_LENS_INNER_FRACTION = 0.5  # fraction of investigations used as lens-present
_FACIES_PERIOD = 10  # one shared (facies) body per this many regular bodies
# Three competitor lithologies cycling over shared-body slots; must be ≥2 to
# trigger the facies path.  Using 3 exercises the Voronoi (circumcenter) branch.
_FACIES_COMPETITORS = ["COMP-A", "COMP-B", "COMP-C"]


def _synthetic_picks(
    n_bodies: int,
    n_investigations: int,
) -> list[BodyLayerPick]:
    """Build a synthetic fence of *n_bodies* stacked bodies at *n_investigations*.

    Investigations are placed on a staggered grid (50 m spacing, row-offset
    on odd rows) so every body spans genuinely non-collinear (x, y) anchors —
    required for :func:`compute_tin` to produce real triangles rather than
    falling back to flagged slabs.

    Bodies are stacked vertically: body k spans depth ``k * layer_m`` to
    ``(k + 1) * layer_m`` at every investigation.  The base of body k equals
    the top of body k+1, so the shared-surface cache in
    :func:`build_body_solids` is exercised (one :func:`compute_tin` call per
    contact level, not two).

    Parameters
    ----------
    n_bodies : int
        Number of distinct bodies to generate.
    n_investigations : int
        Number of investigation anchors per body.

    Returns
    -------
    list[BodyLayerPick]
        All picks in body-major order (body 0 all investigations, then body 1,
        …). Order is arbitrary; the builder groups by ``body_id`` internally.
    """
    # Lay investigations on a staggered grid so no three are collinear.
    inv_x: list[float] = []
    inv_y: list[float] = []
    side = max(2, int(math.ceil(math.sqrt(n_investigations))))
    spacing = 50.0  # 50 m between anchors — realistic borehole/CPT spacing

    for k in range(n_investigations):
        col = k % side
        row = k // side
        x = col * spacing + (row % 2) * 12.5  # stagger even/odd rows
        y = row * spacing
        inv_x.append(x)
        inv_y.append(y)

    surface_elev_m = 5.0  # constant ground surface; only depth matters
    layer_m = 2.0  # each body spans 2 m

    picks: list[BodyLayerPick] = []
    for b in range(n_bodies):
        body_id = f"body-{b:04d}"
        formation_id = f"form-{b % 8:02d}"  # 8 lithologies cycling
        top_depth = b * layer_m
        base_depth = (b + 1) * layer_m
        for i in range(n_investigations):
            picks.append(
                BodyLayerPick(
                    investigation_id=f"inv-{i:04d}",
                    x_m=inv_x[i],
                    y_m=inv_y[i],
                    surface_elev_m=surface_elev_m,
                    body_id=body_id,
                    formation_id=formation_id,
                    top_depth_m=top_depth,
                    base_depth_m=base_depth,
                )
            )
    return picks


def _synthetic_picks_with_lenses(
    n_matrix_bodies: int,
    n_investigations: int,
) -> tuple[list[BodyLayerPick], int]:
    """Build a synthetic fence that includes enclosed-lens bodies (~1 per 10 matrix bodies).

    The overall depth column is identical to :func:`_synthetic_picks` — the same
    staggered grid and ``layer_m`` spacing — but every ``_LENS_PERIOD``-th body
    is replaced by a MATRIX / LENS / MATRIX triplet:

    * **Matrix body** — present at every investigation with the same body_id.
      At lens-present investigations the column carries an upper matrix span,
      then the thin lens, then a lower matrix span; at lens-absent investigations
      the matrix span is unbroken (no gap).
    * **Lens body** — present only at an interior subset of investigations
      (``_LENS_INNER_FRACTION`` of all holes, chosen from the middle of the
      sorted grid so they are never on the boundary).  This satisfies
      :func:`detect_enclosed_lenses`'s condition that above == below == matrix
      at every hole where the lens appears.
    * Regular bodies (non-lens slots) are identical to :func:`_synthetic_picks`.

    Parameters
    ----------
    n_matrix_bodies : int
        Total number of bodies in the depth column (including matrix bodies that
        host a lens).  The actual number of ``BodyLayerPick``-distinct body IDs
        returned is ``n_matrix_bodies + n_lens_bodies`` where
        ``n_lens_bodies = n_matrix_bodies // _LENS_PERIOD``.
    n_investigations : int
        Number of investigation anchors per body.

    Returns
    -------
    tuple[list[BodyLayerPick], int]
        ``(picks, total_bodies)`` where *total_bodies* is the number of distinct
        body IDs (matrix + lens) so the caller can pass it to :func:`_sanity_check`.
    """
    # Build the same staggered investigation grid as _synthetic_picks.
    inv_x: list[float] = []
    inv_y: list[float] = []
    side = max(2, int(math.ceil(math.sqrt(n_investigations))))
    spacing = 50.0

    for k in range(n_investigations):
        col = k % side
        row = k // side
        x = col * spacing + (row % 2) * 12.5
        y = row * spacing
        inv_x.append(x)
        inv_y.append(y)

    surface_elev_m = 5.0
    layer_m = 2.0

    # Interior investigation subset used as lens-present holes.  We take the
    # middle fraction of the sorted index list to avoid boundary investigations.
    n_inner = max(3, int(round(n_investigations * _LENS_INNER_FRACTION)))
    # Centre the selection so the first and last indices are never included.
    margin = max(1, (n_investigations - n_inner) // 2)
    inner_inv_indices: set[int] = set(range(margin, margin + n_inner))
    # Ensure we have at least 3 inner AND at least 3 outer so both the lens
    # TIN and the matrix outer-extent TIN triangulate successfully.
    if len(inner_inv_indices) < 3 or (n_investigations - len(inner_inv_indices)) < 3:
        # Fall back to a fixed interior subset that satisfies both constraints.
        inner_inv_indices = set(range(1, n_investigations - 1))

    picks: list[BodyLayerPick] = []
    lens_body_ids: set[str] = set()

    for b in range(n_matrix_bodies):
        top_depth = b * layer_m
        base_depth = (b + 1) * layer_m
        formation_id = f"form-{b % 8:02d}"

        if b % _LENS_PERIOD == _LENS_PERIOD // 2:
            # --- Enclosed-lens slot ---
            # The matrix body spans the full band at every hole; at inner
            # holes it is split by a thin lens body in the middle third.
            matrix_id = f"matrix-{b:04d}"
            lens_id = f"lens-{b:04d}"
            lens_form = f"lens-form-{b % 3:02d}"  # distinct lithology from matrix
            lens_body_ids.add(lens_id)

            # Lens occupies the middle third of the 2 m band.
            lens_top_depth = top_depth + layer_m / 3.0
            lens_base_depth = top_depth + 2.0 * layer_m / 3.0

            for i in range(n_investigations):
                inv_id = f"inv-{i:04d}"
                x, y = inv_x[i], inv_y[i]
                if i in inner_inv_indices:
                    # Upper matrix span (top → lens_top)
                    picks.append(
                        BodyLayerPick(
                            investigation_id=inv_id,
                            x_m=x,
                            y_m=y,
                            surface_elev_m=surface_elev_m,
                            body_id=matrix_id,
                            formation_id=formation_id,
                            top_depth_m=top_depth,
                            base_depth_m=lens_top_depth,
                        )
                    )
                    # Lens body
                    picks.append(
                        BodyLayerPick(
                            investigation_id=inv_id,
                            x_m=x,
                            y_m=y,
                            surface_elev_m=surface_elev_m,
                            body_id=lens_id,
                            formation_id=lens_form,
                            top_depth_m=lens_top_depth,
                            base_depth_m=lens_base_depth,
                        )
                    )
                    # Lower matrix span (lens_base → base)
                    picks.append(
                        BodyLayerPick(
                            investigation_id=inv_id,
                            x_m=x,
                            y_m=y,
                            surface_elev_m=surface_elev_m,
                            body_id=matrix_id,
                            formation_id=formation_id,
                            top_depth_m=lens_base_depth,
                            base_depth_m=base_depth,
                        )
                    )
                else:
                    # Outer holes: matrix spans the full depth band, no lens.
                    picks.append(
                        BodyLayerPick(
                            investigation_id=inv_id,
                            x_m=x,
                            y_m=y,
                            surface_elev_m=surface_elev_m,
                            body_id=matrix_id,
                            formation_id=formation_id,
                            top_depth_m=top_depth,
                            base_depth_m=base_depth,
                        )
                    )
        else:
            # --- Regular (non-lens) body --- identical to _synthetic_picks.
            body_id = f"body-{b:04d}"
            for i in range(n_investigations):
                picks.append(
                    BodyLayerPick(
                        investigation_id=f"inv-{i:04d}",
                        x_m=inv_x[i],
                        y_m=inv_y[i],
                        surface_elev_m=surface_elev_m,
                        body_id=body_id,
                        formation_id=formation_id,
                        top_depth_m=top_depth,
                        base_depth_m=base_depth,
                    )
                )

    # Total distinct body IDs = n_matrix_bodies regular/matrix + n_lens_bodies.
    # Regular bodies use "body-NNNN"; matrix bodies that host a lens use
    # "matrix-NNNN" (counted as part of n_matrix_bodies slot); lens bodies are
    # additive.  Distinct body count = n_matrix_bodies + len(lens_body_ids).
    total_bodies = n_matrix_bodies + len(lens_body_ids)
    return picks, total_bodies


def _sanity_check(meshes: list, n_bodies: int) -> None:
    """Assert that the build produced real solids, not all flagged slabs.

    With ≥3 non-collinear investigations every body must produce a proper
    mesh.  A fully-flagged result means the synthetic picks were collinear
    and the benchmark is measuring the wrong (trivial) path.

    Parameters
    ----------
    meshes : list
        Output of :func:`build_body_solids`.
    n_bodies : int
        Expected number of meshes.
    """
    assert len(meshes) == n_bodies, f"Expected {n_bodies} meshes, got {len(meshes)}"
    flagged_count = sum(1 for m in meshes if m.is_flagged)
    # All investigations are non-collinear, so zero should be flagged.
    assert flagged_count == 0, (
        f"{flagged_count}/{n_bodies} bodies were flagged — picks may be collinear; "
        f"the benchmark is measuring the degenerate path, not the real TIN path"
    )


def _sanity_check_with_lenses(meshes: list, total_bodies: int) -> None:
    """Assert lens-model sanity: correct mesh count and no flagged matrix bodies.

    Matrix bodies that host an enclosed lens are assembled via the M3 void-carve
    path (:func:`build_extent_solid` + :func:`append_void`).  They must NOT be
    flagged — a flagged matrix means the builder fell through to the disk-marker
    path, exercising the wrong code branch.

    Lens bodies themselves (``body_id`` starts with ``"lens-"``) are small
    through-going slabs; they must also be unflagged because the inner subset
    has ≥3 non-collinear investigations.

    Parameters
    ----------
    meshes : list
        Output of :func:`build_body_solids`.
    total_bodies : int
        Expected total mesh count (matrix + lens + regular bodies).
    """
    assert len(meshes) == total_bodies, (
        f"Expected {total_bodies} meshes (matrix + lens + regular), got {len(meshes)}"
    )
    matrix_meshes = [m for m in meshes if m.body_id.startswith("matrix-")]
    flagged_matrices = [m for m in matrix_meshes if m.is_flagged]
    assert not flagged_matrices, (
        f"{len(flagged_matrices)} matrix bodies are flagged — "
        f"the void-carve path was NOT exercised: {[m.body_id for m in flagged_matrices]}"
    )
    lens_meshes = [m for m in meshes if m.body_id.startswith("lens-")]
    flagged_lenses = [m for m in lens_meshes if m.is_flagged]
    assert not flagged_lenses, (
        f"{len(flagged_lenses)} lens bodies are flagged — "
        f"the inner subset may be collinear: {[m.body_id for m in flagged_lenses]}"
    )


def _synthetic_picks_with_facies(
    n_bodies: int,
    n_investigations: int,
) -> tuple[list[BodyLayerPick], int]:
    """Build a synthetic fence where a fraction of bodies are multi-patch shared bodies.

    Every ``_FACIES_PERIOD``-th body slot is replaced by a shared body with 2–3
    distinct competitors directly above it, triggering the facies path in
    :func:`build_body_solids`.

    The shared body is present at every investigation (full footprint).  The
    competitors are assigned by cycling ``_FACIES_COMPETITORS`` round-robin over the
    sorted investigation indices so at least 2 distinct competitors appear at the
    ≥3 non-collinear investigations required for the facies partition TIN.  The
    competitor occupies a thin slab above the shared body (half a ``layer_m`` thick)
    and the shared body spans the normal ``layer_m`` band below it.

    Regular (non-facies) body slots are identical to :func:`_synthetic_picks`.

    Parameters
    ----------
    n_bodies : int
        Number of body slots.  Each facies slot contributes 1 shared body + N
        competitor bodies (N = len(_FACIES_COMPETITORS)), so the total distinct body
        IDs is slightly more than ``n_bodies``.
    n_investigations : int
        Number of investigation anchors.

    Returns
    -------
    tuple[list[BodyLayerPick], int]
        ``(picks, total_distinct_bodies)`` where *total_distinct_bodies* counts
        all distinct ``body_id`` values emitted (shared + competitor + regular).
    """
    # Build the staggered investigation grid (same as _synthetic_picks).
    inv_x: list[float] = []
    inv_y: list[float] = []
    side = max(2, int(math.ceil(math.sqrt(n_investigations))))
    spacing = 50.0

    for k in range(n_investigations):
        col = k % side
        row = k // side
        x = col * spacing + (row % 2) * 12.5
        y = row * spacing
        inv_x.append(x)
        inv_y.append(y)

    surface_elev_m = 5.0
    layer_m = 2.0
    comp_layer_m = layer_m / 2.0  # competitor slab is half the body thickness

    picks: list[BodyLayerPick] = []
    competitor_body_ids: set[str] = set()

    for b in range(n_bodies):
        formation_id = f"form-{b % 8:02d}"

        if b % _FACIES_PERIOD == _FACIES_PERIOD // 2:
            # --- Facies slot ---
            # The shared body spans the lower half of the depth band; the competitor
            # slab sits immediately above it (upper half of the band).
            shared_top_depth = b * layer_m + comp_layer_m  # shared body starts after the comp slab
            shared_base_depth = (b + 1) * layer_m
            comp_top_depth = b * layer_m
            comp_base_depth = shared_top_depth

            shared_id = f"shared-{b:04d}"

            for i in range(n_investigations):
                inv_id = f"inv-{i:04d}"
                x, y = inv_x[i], inv_y[i]
                # Assign competitor round-robin by investigation index so all three
                # competitor labels appear across the investigation set.
                comp_label = _FACIES_COMPETITORS[i % len(_FACIES_COMPETITORS)]
                comp_id = f"{comp_label}-{b:04d}"
                competitor_body_ids.add(comp_id)

                # Competitor pick (above the shared body).
                picks.append(
                    BodyLayerPick(
                        investigation_id=inv_id,
                        x_m=x,
                        y_m=y,
                        surface_elev_m=surface_elev_m,
                        body_id=comp_id,
                        formation_id=comp_label,
                        top_depth_m=comp_top_depth,
                        base_depth_m=comp_base_depth,
                    )
                )
                # Shared body pick.
                picks.append(
                    BodyLayerPick(
                        investigation_id=inv_id,
                        x_m=x,
                        y_m=y,
                        surface_elev_m=surface_elev_m,
                        body_id=shared_id,
                        formation_id=formation_id,
                        top_depth_m=shared_top_depth,
                        base_depth_m=shared_base_depth,
                    )
                )
        else:
            # --- Regular body --- identical to _synthetic_picks.
            body_id = f"body-{b:04d}"
            top_depth = b * layer_m
            base_depth = (b + 1) * layer_m
            for i in range(n_investigations):
                picks.append(
                    BodyLayerPick(
                        investigation_id=f"inv-{i:04d}",
                        x_m=inv_x[i],
                        y_m=inv_y[i],
                        surface_elev_m=surface_elev_m,
                        body_id=body_id,
                        formation_id=formation_id,
                        top_depth_m=top_depth,
                        base_depth_m=base_depth,
                    )
                )

    # Count distinct body IDs: n_bodies regular/shared slots + competitor bodies.
    # Regular slots use "body-NNNN"; shared slots use "shared-NNNN" (1 per facies
    # slot, counted within n_bodies); competitor bodies are additive.
    total_distinct = n_bodies + len(competitor_body_ids)
    return picks, total_distinct


def _sanity_check_with_facies(meshes: list, total_bodies: int) -> None:
    """Assert facies-model sanity: correct count and no flagged competitor bodies.

    Competitor bodies (``body_id`` starts with ``"COMP-A-"``, ``"COMP-B-"``, or
    ``"COMP-C-"``) must NOT be flagged — a flagged competitor means the builder
    took the disk-marker fallback instead of the facies prism path, which would
    indicate the geometry is degenerate or the facies trigger was not reached.

    Parameters
    ----------
    meshes : list
        Output of :func:`build_body_solids`.
    total_bodies : int
        Expected total mesh count (shared + competitor + regular bodies).
    """
    assert len(meshes) == total_bodies, f"Expected {total_bodies} meshes, got {len(meshes)}"
    comp_prefix = tuple(f"{c}-" for c in _FACIES_COMPETITORS)
    competitor_meshes = [m for m in meshes if m.body_id.startswith(comp_prefix)]
    flagged_comps = [m for m in competitor_meshes if m.is_flagged]
    assert not flagged_comps, (
        f"{len(flagged_comps)} competitor bodies are flagged (disk markers) — "
        f"the facies prism path was NOT taken: {[m.body_id for m in flagged_comps]}"
    )


# ---------------------------------------------------------------------------
# Small — 10 bodies × 6 investigations
# ---------------------------------------------------------------------------


def test_bench_build_body_solids_small(benchmark) -> None:
    """Small fence: 10 bodies × 6 investigations (~60 picks total).

    Represents a short corridor fence with a handful of formations — a
    quick on-demand Build that should feel instantaneous.
    """
    n_bodies, n_inv = 10, 6
    picks = _synthetic_picks(n_bodies, n_inv)
    meshes = benchmark(build_body_solids, picks)
    _sanity_check(meshes, n_bodies)


# ---------------------------------------------------------------------------
# Medium — 50 bodies × 12 investigations
# ---------------------------------------------------------------------------


def test_bench_build_body_solids_medium(benchmark) -> None:
    """Medium fence: 50 bodies × 12 investigations (~600 picks total).

    Represents a realistic project section (12 CPTs/boreholes, 50
    stacked formation units).  This is the expected common case.
    """
    n_bodies, n_inv = 50, 12
    picks = _synthetic_picks(n_bodies, n_inv)
    meshes = benchmark(build_body_solids, picks)
    _sanity_check(meshes, n_bodies)


# ---------------------------------------------------------------------------
# Large — 200 bodies × 30 investigations
# ---------------------------------------------------------------------------


def test_bench_build_body_solids_large(benchmark) -> None:
    """Large fence: 200 bodies × 30 investigations (~6 000 picks total).

    Stress upper bound — a 30-CPT corridor with 200 stacked units is not a
    realistic geology but proves the builder scales gracefully.  Runs once
    per user-clicked Build, not per render frame, so even several seconds
    would be acceptable — but we expect well under a second given SciPy's
    C-backed Delaunay.
    """
    n_bodies, n_inv = 200, 30
    picks = _synthetic_picks(n_bodies, n_inv)
    meshes = benchmark(build_body_solids, picks)
    _sanity_check(meshes, n_bodies)


# ---------------------------------------------------------------------------
# Enclosed-lens — 50 matrix bodies × 12 investigations, ~5 lenses (M3 path)
# ---------------------------------------------------------------------------


def test_bench_build_body_solids_with_lenses(benchmark) -> None:
    """Medium fence with enclosed lenses: 50 matrix bodies × 12 investigations.

    Every tenth body slot is a MATRIX / LENS / MATRIX triplet (~5 lenses).
    The M3 void-carve path (:func:`build_extent_solid` + :func:`append_void`)
    is exercised on each matrix-with-void body; lens bodies are built via
    :func:`assemble_body` over the interior investigation subset.

    This case exposes any overhead introduced by :func:`detect_enclosed_lenses`
    (O(n_spans)), :func:`merged_body_extent`, and :func:`build_extent_solid`
    relative to the plain-body path.  The overall pick count is slightly larger
    than the medium baseline (~660 picks vs ~600) because each lens-present
    investigation carries three picks instead of one.

    The sanity assertions confirm that:

    * The total mesh count equals n_matrix_bodies + n_lens_bodies (no missing
      or duplicate meshes).
    * Matrix bodies are NOT flagged — they were built via the void-carve path
      (``is_flagged=False``), not the disk-marker fallback.
    * Lens bodies are NOT flagged — the inner investigation subset is
      non-collinear and yields a real TIN.
    """
    n_matrix, n_inv = 50, 12
    picks, total_bodies = _synthetic_picks_with_lenses(n_matrix, n_inv)
    meshes = benchmark(build_body_solids, picks)
    _sanity_check_with_lenses(meshes, total_bodies)


# ---------------------------------------------------------------------------
# Facies — 50 bodies × 12 investigations, ~5 shared bodies with competitors
# ---------------------------------------------------------------------------


def test_bench_build_body_solids_with_facies(benchmark) -> None:
    """Medium fence with facies competition: 50 body slots × 12 investigations.

    Every tenth body slot is a shared body with 2–3 distinct competitors
    (``_FACIES_COMPETITORS``) directly above it, exercising
    :func:`assemble_facies_competitors` and the Voronoi/midpoint partition path
    inside :func:`build_body_solids`.

    The sanity assertions confirm that:

    * The total mesh count equals n_bodies + n_competitor_bodies.
    * Competitor bodies (``body_id`` starts with a ``_FACIES_COMPETITORS`` prefix)
      are NOT flagged — they were built as real facies prisms via the clipped-
      prism path, not as degenerate disk markers.  A flagged competitor means the
      facies partition path was bypassed, so this assertion gates whether the
      correct code branch ran.
    """
    n_bodies, n_inv = 50, 12
    # With 50 body slots and _FACIES_PERIOD=10, slots b=5,15,25,35,45 are
    # facies slots (b % 10 == 5), giving 5 shared bodies each with
    # len(_FACIES_COMPETITORS)=3 competitor IDs → 15 competitor bodies total.
    # Expected total distinct bodies = 50 (regular + shared slots) + 15 = 65.
    picks, total_bodies = _synthetic_picks_with_facies(n_bodies, n_inv)
    meshes = benchmark(build_body_solids, picks)
    _sanity_check_with_facies(meshes, total_bodies)
