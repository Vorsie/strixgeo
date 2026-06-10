"""Litho-3D solid-builder performance benchmarks (milestone-2, Task 9).

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

Synthetic fence design
----------------------
* Investigations sit on a sparse grid so each body spans genuinely non-
  collinear (x, y) anchors — collinear inputs degenerate into flagged slabs
  and would measure the wrong (trivial) code path.  We use the same
  row-offset trick as ``bench_tin_surface.py``.
* Bodies are stacked vertically within each investigation column (body k's
  ``base_depth_m`` == body k+1's ``top_depth_m``) so the per-contact surface
  cache inside :func:`build_body_solids` is exercised: the base surface of
  body k and the top surface of body k+1 share the same elevation → one
  :func:`compute_tin` call, not two.

Bracketing scales:

* small  — 10 bodies × ~6 investigations  (tiny fence, quick interactive).
* medium — 50 bodies × ~12 investigations (realistic project section).
* large  — 200 bodies × ~30 investigations (stress upper bound; a corridor
  of 30 CPTs each penetrating 200 m would give this many stacked units if
  every 1 m were a distinct formation, which is unrealistic — this is a
  genuine stress case, not an expected real-world size).

Baseline numbers land in CLAUDE.local.md after a stable run.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.litho_solid_builder import BodyLayerPick, build_body_solids


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
