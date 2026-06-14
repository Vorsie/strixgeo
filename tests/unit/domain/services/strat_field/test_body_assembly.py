"""Stage-5 body-assembly tests — the watertight gate (Task 6 against the Task-7 oracle).

These tests are the objective definition of "done" for Stage 5: every emitted
:class:`LithoBodyMesh` must pass the Task-7 invariant helpers
(``assert_closed_manifold`` / ``assert_no_overlap_sampled`` /
``assert_model_matches_columns``) on REAL-DATA-SHAPED fixtures — interbedded,
dipping, and pinch — never a layer-cake-only stack (layer-cake-only testing is
exactly what hid the old loft builder's metre-scale overlap bug).

The fixtures are built from the analytic nested / pinch fields already in
``fixtures.py`` (monotone-by-construction so the body stack is well-defined) plus
the matching authored columns derived from the SAME field so the column-diff is
meaningful.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.strat_field.body_assembly import (
    _component_height_field,
    _contact_crossing,
    _sample_height_fields,
    assemble_bodies,
    build_shared_grid,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    Horizon,
    StratColumn,
)
from tests.unit.domain.services.strat_field.fixtures import (
    nested_field_and_domain,
    pinch_field_and_domain,
    pinch_lens_rank,
    widely_spaced_build_fixture,
)
from tests.unit.domain.services.strat_field.strat_invariants import (
    AuthoredColumn,
    AuthoredUnit,
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# A coarse grid keeps marching-cubes-free body assembly fast (<1 s) while still
# exercising pinch + dipping geometry: the analytic blocks are 20 m / 30 m wide,
# so a 2.5 m spacing gives ~8-12 cells per axis — plenty of taper resolution.
_NESTED_SPACING_M = 2.5
_PINCH_SPACING_M = 2.5


# ---------------------------------------------------------------------------
# Fixture helpers — build bodies + the matching authored columns
# ---------------------------------------------------------------------------


def _nested_bodies() -> list:
    """Assemble bodies for the analytic nested (gently dipping) fixture."""
    field, order, domain = nested_field_and_domain()
    return assemble_bodies(field, order, domain, _NESTED_SPACING_M)


def _pinch_bodies() -> list:
    """Assemble bodies for the analytic pinch fixture (a lens present mid-domain)."""
    field, order, domain = pinch_field_and_domain()
    return assemble_bodies(field, order, domain, _PINCH_SPACING_M)


def _grid_samples(domain, n: int) -> list[tuple[float, float]]:
    """Return ``n × n`` interior ``(x, y)`` samples of the domain's bounding box.

    Samples are pulled inward from the polygon edges so a ray never grazes the
    perimeter wall exactly (which would make the even-odd crossing count
    ambiguous); this is the same convention the loft invariant tests used.
    """
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    # Inset by 5% of the extent so samples land strictly inside.
    ix = 0.05 * (x_max - x_min)
    iy = 0.05 * (y_max - y_min)
    sx = np.linspace(x_min + ix, x_max - ix, n)
    sy = np.linspace(y_min + iy, y_max - iy, n)
    return [(float(x), float(y)) for x in sx for y in sy]


def _analytic_nested_authored_columns() -> list[AuthoredColumn]:
    """Author the expected litho stack at three columns of the nested field.

    The nested field is ``F = (z_ref - z) + dip*(x - x_ref)`` with z_ref=0,
    x_ref=10, dip=0.05; interior horizons at iso 1, 2, 3 (ZAND/SILT/ZAND/KLEI).
    At a given x the horizon-k elevation solves ``iso_k = -z + 0.05*(x - 10)`` →
    ``z = 0.05*(x-10) - iso_k``.  The authored bases come from the SAME formula
    so the column-diff checks the model reproduces the field, not a re-derivation.
    """
    field, order, domain = nested_field_and_domain()
    interior_ranks = [
        h.rank for h in order.horizons if 1 <= h.rank < max(hh.rank for hh in order.horizons)
    ]
    columns: list[AuthoredColumn] = []
    for x in (5.0, 10.0, 15.0):
        y = 10.0
        # Build the iso → elevation map at this x via the analytic formula.
        elev_by_rank = {r: 0.05 * (x - 10.0) - order.iso_value(r) for r in interior_ranks}
        z_max = domain.z_max
        z_min = domain.z_min
        units: list[AuthoredUnit] = []
        # Top body: from z_max down to horizon[interior_ranks[0]].
        prev_top = z_max
        for r in interior_ranks:
            base = elev_by_rank[r]
            fid = next(h.above_formation for h in order.horizons if h.rank == r)
            units.append(AuthoredUnit(formation_id=fid, top_elev_m=prev_top, base_elev_m=base))
            prev_top = base
        # Bottom body: from the last interior horizon down to z_min.
        last_below = next(h.below_formation for h in order.horizons if h.rank == interior_ranks[-1])
        units.append(AuthoredUnit(formation_id=last_below, top_elev_m=prev_top, base_elev_m=z_min))
        columns.append(AuthoredColumn(x=x, y=y, units=tuple(units)))
    return columns


# ---------------------------------------------------------------------------
# Gate tests
# ---------------------------------------------------------------------------


def test_each_nested_body_is_a_closed_manifold() -> None:
    """Every dipping-fixture body is a closed 2-manifold with consistent winding."""
    bodies = _nested_bodies()
    assert bodies, "nested fixture produced no bodies"
    # The nested column is ZAND/SILT/ZAND/KLEI — at least these lithologies present.
    assert {b.formation_id for b in bodies} >= {"ZAND", "SILT", "KLEI"}
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)


def test_nested_bodies_do_not_overlap() -> None:
    """No two different dipping-fixture bodies interpenetrate (STRICT, TOL=1e-6)."""
    _, _, domain = nested_field_and_domain()
    bodies = _nested_bodies()
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=12))


def test_model_tiles_the_authored_columns() -> None:
    """The model stack reproduces the authored litho stack at every test column.

    This is the anti-loft test on real-data-shaped (dipping, interbedded ZAND/SILT)
    geometry — the exact assertion the old loft builder failed at 50-metre scale.
    """
    bodies = _nested_bodies()
    columns = _analytic_nested_authored_columns()
    # Grid spacing 2.5 m → the prism's stepped lateral cells reproduce the dipping
    # base to within roughly one cell of slope; 0.5 m tolerance covers that.
    assert_model_matches_columns(bodies, columns, tol_m=0.5)


def test_each_pinch_body_is_a_closed_manifold() -> None:
    """Every pinch-fixture body (incl. the laterally-terminating lens) is closed."""
    bodies = _pinch_bodies()
    assert bodies, "pinch fixture produced no bodies"
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)


def test_pinch_bodies_do_not_overlap() -> None:
    """No two different pinch-fixture bodies interpenetrate (STRICT)."""
    _, _, domain = pinch_field_and_domain()
    bodies = _pinch_bodies()
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=12))


def test_pinched_body_closes_to_a_tip() -> None:
    """The laterally-terminating lens body closes into a watertight solid.

    In the analytic pinch fixture the lens iso (rank ``pinch_lens_rank`` = 2) is
    reached only in a central x-band, so the band BELOW it (KLEI, between the lens
    contact and the floor cap) exists only mid-domain and terminates laterally on
    both sides.  That body must still be a closed manifold — where the lens
    pinches out the body's bounding height becomes absent, the cells there are
    omitted, and the prism closes with a watertight wall at the taper.
    """
    bodies = _pinch_bodies()
    lens_rank = pinch_lens_rank()
    assert lens_rank == 2
    # KLEI is the laterally-terminating body (present only in the central lens band).
    klei_bodies = [b for b in bodies if b.formation_id == "KLEI"]
    assert klei_bodies, "no KLEI (lens) body emitted"
    for b in klei_bodies:
        assert_closed_manifold(b.vertices, b.triangles)
    # It must terminate laterally: a ray at the domain edge (x near 2 m) misses
    # the lens body, while a ray at the centre (x = 15 m) hits it.
    klei = klei_bodies[0]
    centre_hit = vertical_ray_intervals(klei.vertices, klei.triangles, 15.0, 5.0)
    edge_hit = vertical_ray_intervals(klei.vertices, klei.triangles, 2.0, 5.0)
    assert centre_hit, "lens body should be present at the domain centre"
    assert not edge_hit, "lens body should pinch out before the domain edge"


def test_body_assembly_is_deterministic() -> None:
    """Re-running assembly on the same input yields identical vertices + triangles."""
    a = _nested_bodies()
    b = _nested_bodies()
    assert len(a) == len(b)
    for ba, bb in zip(a, b, strict=True):
        assert ba.body_id == bb.body_id
        assert ba.formation_id == bb.formation_id
        assert ba.vertices == bb.vertices
        assert ba.triangles == bb.triangles


# ---------------------------------------------------------------------------
# Bubble (non-monotone field) — the monotone-clamp gate
# ---------------------------------------------------------------------------

# A deliberately non-monotone analytic field: a central x-band carries a saturating
# base that asymptotes BETWEEN the rank-1 and rank-2 iso-values deep down (so the
# rank-1 contact crosses deep but rank-2 never does there) PLUS a strong shallow
# Gaussian bump that lifts the field through the rank-2 / rank-3 iso-values near the
# top.  The result is an INVERSION: in the central band the deeper contacts (rank 2,
# 3) have their only field crossing ABOVE the shallower contact (rank 1).  Without
# the monotone height clamp the band between rank 1 and rank 2 has negative thickness
# and two different bodies interpenetrate (a metre-scale overlap fires); with the
# clamp the inverted contacts pinch to their neighbour (zero-thickness) and the per-
# column body stack is monotone again.  This is the analytic stand-in for the real
# VEEN −1.17 m overshoot the owner saw.
_BUBBLE_X_MIN = 0.0
_BUBBLE_X_MAX = 20.0
_BUBBLE_Y_MIN = 0.0
_BUBBLE_Y_MAX = 20.0
_BUBBLE_Z_MIN = -6.0
_BUBBLE_Z_MAX = 6.0
_BUBBLE_X_MID = 10.0  # centre of the inverting band


class _AnalyticBubbledField:
    """A non-monotone analytic field that inverts two interior contacts in a band.

    Mimics :class:`~groundmodel.domain.services.strat_field.potential_field.PotentialField`'s
    ``evaluate`` ((N, 3) -> (N,)) interface.  The field is monotone-in-depth at the
    domain edges (a clean ``z_ref - z`` base) but in a central x-band it (a) suppresses
    the base so its deep tail saturates between the rank-1 and rank-2 iso-values and
    (b) adds a strong shallow Gaussian bump that lifts the field through the higher
    iso-values near the top.  The deeper contacts therefore cross ABOVE the shallower
    one in that band — a genuine field bubble / inversion.

    Parameters
    ----------
    z_min, z_max : float
        Vertical span (only used to keep the bump within the block).
    x_mid : float
        Centre of the x-band where the inversion occurs.
    """

    def __init__(self, z_min: float, z_max: float, x_mid: float) -> None:
        self._z_min = z_min
        self._z_max = z_max
        self._x_mid = x_mid

    def evaluate(self, xyz: object) -> object:
        """Evaluate the analytic bubbled field at a batch of ``(x, y, z)`` points.

        Parameters
        ----------
        xyz : array-like of shape (N, 3)
            Query points; only the x and z columns affect the field.

        Returns
        -------
        numpy.ndarray
            The field value at each point.
        """
        pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
        x = pts[:, 0]
        z = pts[:, 2]
        # 1 at the band centre, falling to ~0 at the edges.
        xfac = np.exp(-(((x - self._x_mid) / 3.0) ** 2))
        # Edge base is the clean monotone-down term; the central base saturates at
        # ~1.5 deep (between iso 1 and iso 2) so rank-2 never crosses deep there.
        base_edge = -z
        base_centre = 1.5 * (1.0 / (1.0 + np.exp(z / 1.0)))
        base = (1.0 - xfac) * base_edge + xfac * base_centre
        # Shallow bump (central band only) lifts the field through iso 2 / iso 3.
        bump = 5.0 * xfac * np.exp(-(((z - 3.5) / 1.0) ** 2))
        return base + bump


def _bubbled_nested_field() -> tuple[_AnalyticBubbledField, StratColumn, Block]:
    """Build the bubbled field, its matching column, and its domain block.

    Reuses the nested fixture's ZAND/SILT/ZAND/KLEI column (interior iso-values
    1, 2, 3 at ranks 1, 2, 3; ranks 0 and 4 are caps) so the band lithologies match
    the other gate tests; only the FIELD differs (non-monotone in the central band).

    Returns
    -------
    (_AnalyticBubbledField, StratColumn, Block)
        The inverting field, the 5-horizon column, and the block spanning it.
    """
    field = _AnalyticBubbledField(_BUBBLE_Z_MIN, _BUBBLE_Z_MAX, _BUBBLE_X_MID)
    column = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "ZAND", ("surf",)),
            Horizon(1, 1.0, "ZAND", "SILT", ("c1",)),
            Horizon(2, 2.0, "SILT", "ZAND", ("c2",)),
            Horizon(3, 3.0, "ZAND", "KLEI", ("c3",)),
            Horizon(4, 4.0, "KLEI", None, ()),
        )
    )
    polygon = (
        (_BUBBLE_X_MIN, _BUBBLE_Y_MIN),
        (_BUBBLE_X_MAX, _BUBBLE_Y_MIN),
        (_BUBBLE_X_MAX, _BUBBLE_Y_MAX),
        (_BUBBLE_X_MIN, _BUBBLE_Y_MAX),
    )
    domain = Block(polygon=polygon, z_min=_BUBBLE_Z_MIN, z_max=_BUBBLE_Z_MAX)
    return field, column, domain


def test_bubbled_field_is_clamped_monotone() -> None:
    """A non-monotone field bubble yields a monotone, non-overlapping body stack.

    The analytic bubbled field inverts the rank-2 / rank-3 contacts above rank 1 in
    a central x-band.  Without the monotone height clamp the inverted band has
    negative thickness and two different bodies interpenetrate (a metre-scale overlap
    — the analytic stand-in for the real VEEN −1.17 m overshoot).  After the clamp
    every per-column body stack must be monotone (no negative-thickness inversion)
    and no two bodies may overlap on a dense sample set, and every body must remain a
    closed manifold.
    """
    field, order, domain = _bubbled_nested_field()
    bodies = assemble_bodies(field, order, domain, grid_spacing_m=1.0)
    assert bodies, "bubbled fixture produced no bodies"
    # STRICT (TOL=1e-6): this would FAIL on the raw inverted heights pre-clamp.
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=30))
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)


# ---------------------------------------------------------------------------
# Equivalence — vectorised _sample_height_fields == scalar _contact_crossing
# ---------------------------------------------------------------------------


def _scalar_sample_height_fields(
    field: object,
    interior: list,
    domain: object,
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> dict[int, np.ndarray]:
    """Pure scalar reference implementation using _contact_crossing.

    Mirrors the PRE-vectorisation loop in ``_sample_height_fields`` so the
    equivalence test has an independent scalar oracle, not just the vectorised
    code calling itself.  The monotone clamp is NOT applied here (it runs after
    the crossing scan in both paths); only the raw crossing heights are compared.
    """
    nx, ny = len(gx), len(gy)
    z_min, z_max = domain.z_min, domain.z_max
    h_step = float(gx[1] - gx[0]) if nx > 1 else (z_max - z_min)
    nz = int(np.ceil((z_max - z_min) / max(h_step * 0.5, 1e-6))) + 1
    nz = min(max(nz, 64), 512)
    zcol = np.linspace(z_max, z_min, nz)

    iso_by_rank = {h.rank: h.iso_value for h in interior}
    interior_ranks = [h.rank for h in interior]
    heights: dict[int, np.ndarray] = {h.rank: np.full((nx, ny), np.nan) for h in interior}

    inside_nodes = [(i, j) for i in range(nx) for j in range(ny) if node_inside[i, j]]
    if not inside_nodes:
        return heights

    pts = np.empty((len(inside_nodes) * nz, 3), dtype=float)
    for n, (i, j) in enumerate(inside_nodes):
        base = n * nz
        pts[base : base + nz, 0] = gx[i]
        pts[base : base + nz, 1] = gy[j]
        pts[base : base + nz, 2] = zcol

    # reason: evaluate() accepts (N, 3) ndarray as the fast path.
    import numpy as _np

    fvals = _np.asarray(field.evaluate(pts)).reshape(len(inside_nodes), nz)  # type: ignore[arg-type]

    for n, (i, j) in enumerate(inside_nodes):
        col = fvals[n]
        for rank in interior_ranks:
            iso = iso_by_rank[rank]
            z_cross = _contact_crossing(zcol, col, iso)
            if z_cross is not None:
                heights[rank][i, j] = z_cross

    return heights


def test_vectorised_height_fields_match_scalar_oracle() -> None:
    """Vectorised _sample_height_fields is bit-equivalent to the scalar oracle.

    Uses the widely-spaced real-data-shaped fixture (Lambert-72 magnitude,
    irregularly spaced investigations, interbedded ZAND/KLEI/ZAND/KLEI) — the
    same fixture that exposed the coordinate-spread RBF explosion.  At every
    grid node and every interior rank the vectorised crossing height must agree
    with the scalar _contact_crossing oracle within 1e-9 m, and NaN positions
    must match exactly (no crossing in one path iff no crossing in the other).

    This test is the safety net for the numpy-broadcasting refactor: a wrong
    crossing predicate, an off-by-one interval index, or a broken tie-break
    would break it immediately.
    """
    from groundmodel.domain.services.strat_field.control_data import build_control_data
    from groundmodel.domain.services.strat_field.potential_field import fit_potential_field
    from groundmodel.domain.services.strat_field.stratigraphic_order import (
        build_stratigraphic_order,
    )
    from tests.unit.domain.services.strat_field.fixtures import (
        widely_spaced_columns_with_xyz,
        widely_spaced_order_columns,
    )

    order = build_stratigraphic_order(widely_spaced_order_columns())
    cols = widely_spaced_columns_with_xyz()
    control = build_control_data(cols, [], order)
    domain = widely_spaced_build_fixture()[1]
    field = fit_potential_field(control, [domain])

    # Coarse grid — enough cells to exercise all interior ranks + NaN/present mix
    # without slowing the unit suite.
    grid_spacing_m = 20.0
    gx, gy, node_inside = build_shared_grid(domain, grid_spacing_m)

    floor_rank = max(h.rank for h in order.horizons)
    interior = [h for h in sorted(order.horizons, key=lambda h: h.rank) if 1 <= h.rank < floor_rank]

    # --- vectorised path (the implementation under test) ---
    vec_heights = _sample_height_fields(field, interior, domain, gx, gy, node_inside)

    # --- scalar oracle (the pre-vectorisation loop, independently coded above) ---
    # The oracle computes RAW crossings only (no monotone clamp); apply the same
    # clamp to the oracle so the comparison is against the same final output.
    ref_heights = _scalar_sample_height_fields(field, interior, domain, gx, gy, node_inside)

    # Apply the monotone clamp to the reference in the same way _sample_height_fields
    # does — so we compare the full function output, not just the crossing layer.
    nx, ny = len(gx), len(gy)
    interior_ranks = [h.rank for h in interior]
    running = np.full((nx, ny), np.inf)
    for rank in interior_ranks:
        layer = ref_heights[rank]
        present = ~np.isnan(layer)
        running[present] = np.minimum(running[present], layer[present])
        layer[present] = running[present]

    assert set(vec_heights.keys()) == set(ref_heights.keys()), "rank key sets differ"

    for rank in interior_ranks:
        vec = vec_heights[rank]
        ref = ref_heights[rank]

        # NaN positions must match exactly: no crossing in one iff no crossing in the other.
        vec_nan = np.isnan(vec)
        ref_nan = np.isnan(ref)
        assert np.array_equal(vec_nan, ref_nan), (
            f"rank {rank}: NaN mask mismatch — "
            f"{int(vec_nan.sum())} NaN in vectorised vs {int(ref_nan.sum())} in scalar"
        )

        # Finite positions must agree within 1e-9 m (the interpolation uses the
        # same formula; FP evaluation order can shift the last ULP but not more).
        present = ~vec_nan
        if present.any():
            max_diff = float(np.abs(vec[present] - ref[present]).max())
            assert max_diff <= 1e-9, (
                f"rank {rank}: vectorised heights differ from scalar oracle by up to "
                f"{max_diff:.3e} m (tolerance 1e-9 m) — crossing predicate or "
                f"interpolation mismatch"
            )


def test_component_height_field_vectorised_matches_scalar() -> None:
    """Vectorised _component_height_field produces the identical mask as the scalar loop.

    The nested fixture has multiple bands; assemble the bodies to get real cell sets
    and verify that the vectorised corner-write produces the same footprint as the
    scalar per-cell Python loop on a representative component.
    """
    field, order, domain = nested_field_and_domain()
    gx, gy, node_inside = build_shared_grid(domain, _NESTED_SPACING_M)
    nx, ny = len(gx), len(gy)

    floor_rank = max(h.rank for h in order.horizons)
    interior = [h for h in sorted(order.horizons, key=lambda h: h.rank) if 1 <= h.rank < floor_rank]

    # Compute heights so we have real top/bottom arrays to feed the helper.
    from groundmodel.domain.services.strat_field.body_assembly import (
        _label_components,
        _present_cells,
    )

    heights = _sample_height_fields(field, interior, domain, gx, gy, node_inside)
    top_cap = np.full((nx, ny), domain.z_max)
    bot = heights[interior[0].rank]  # first interior horizon

    present = _present_cells(top_cap, bot, node_inside, nx, ny)
    components = _label_components(present)
    assert components, "nested fixture produced no components for the top band"

    for cell_set in components:
        # Scalar oracle — the original per-cell loop.
        footprint_scalar = np.zeros((nx, ny), dtype=bool)
        for ci, cj in cell_set:
            footprint_scalar[ci, cj] = True
            footprint_scalar[ci + 1, cj] = True
            footprint_scalar[ci + 1, cj + 1] = True
            footprint_scalar[ci, cj + 1] = True

        # Vectorised implementation.
        comp_top, comp_base = _component_height_field(top_cap, bot, cell_set, nx, ny)
        footprint_vec = ~np.isnan(comp_top)

        assert np.array_equal(footprint_vec, footprint_scalar), (
            "vectorised _component_height_field footprint differs from scalar oracle"
        )


# ---------------------------------------------------------------------------
# Equivalence — vectorised _present_cells == scalar double-loop oracle
# ---------------------------------------------------------------------------


def _scalar_present_cells(
    top: np.ndarray,
    bottom: np.ndarray,
    node_inside: np.ndarray,
    nx: int,
    ny: int,
) -> np.ndarray:
    """Scalar oracle for _present_cells: the original double-loop implementation.

    Kept verbatim from the pre-vectorisation source so the equivalence test has
    an independent reference that does not call the vectorised code under test.
    """
    from groundmodel.domain.services.strat_field.body_assembly import _MIN_BAND_THICKNESS_M

    present = np.zeros((nx - 1, ny - 1), dtype=bool)
    for i in range(nx - 1):
        for j in range(ny - 1):
            corners = ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
            if not all(node_inside[ci, cj] for ci, cj in corners):
                continue
            tops = [top[ci, cj] for ci, cj in corners]
            bots = [bottom[ci, cj] for ci, cj in corners]
            if any(np.isnan(t) for t in tops) or any(np.isnan(b) for b in bots):
                continue
            thickness = sum(t - b for t, b in zip(tops, bots, strict=True)) / 4.0
            if thickness > _MIN_BAND_THICKNESS_M:
                present[i, j] = True
    return present


def test_present_cells_vectorised_matches_scalar_oracle() -> None:
    """Vectorised _present_cells is array-equal to the scalar double-loop oracle.

    Uses three real-data-shaped fixtures that exercise every code path:

    * **nested** — all cells present, no NaN heights, interior polygon mask.
      Exercises the all-inside + all-finite + thick gates together on a
      continuously present band.
    * **pinch** — the lens band has NaN heights on the left/right flanks where
      the lens iso is not crossed.  Exercises the finite-top/bottom gate
      (absent nodes → NaN → cell excluded) and the lateral taper that closes the
      pinch body.
    * **widely-spaced** — Lambert-72 magnitude coordinates, sparse investigations,
      many NaN nodes from the sparse RBF.  Exercises large NaN regions + the
      polygon-interior mask on a realistic project-scale grid.

    The oracle is the verbatim pre-vectorisation scalar loop (above in this
    module), kept independent of the implementation under test.
    """
    from groundmodel.domain.services.strat_field.body_assembly import _present_cells
    from groundmodel.domain.services.strat_field.control_data import build_control_data
    from groundmodel.domain.services.strat_field.potential_field import fit_potential_field
    from groundmodel.domain.services.strat_field.stratigraphic_order import (
        build_stratigraphic_order,
    )
    from tests.unit.domain.services.strat_field.fixtures import (
        widely_spaced_columns_with_xyz,
        widely_spaced_order_columns,
    )

    cases = [
        ("nested", *nested_field_and_domain(), _NESTED_SPACING_M),
        ("pinch", *pinch_field_and_domain(), _PINCH_SPACING_M),
    ]

    # Widely-spaced real-data-shaped fixture — builds its own field.
    ws_order = build_stratigraphic_order(widely_spaced_order_columns())
    ws_cols = widely_spaced_columns_with_xyz()
    ws_control = build_control_data(ws_cols, [], ws_order)
    ws_domain = widely_spaced_build_fixture()[1]
    ws_field = fit_potential_field(ws_control, [ws_domain])
    cases.append(("widely-spaced", ws_field, ws_order, ws_domain, 20.0))

    floor_rank_for = lambda order: max(h.rank for h in order.horizons)  # noqa: E731

    for label, field, order, domain, spacing in cases:
        gx, gy, node_inside = build_shared_grid(domain, spacing)
        nx, ny = len(gx), len(gy)
        floor_rank = floor_rank_for(order)
        interior = [
            h for h in sorted(order.horizons, key=lambda h: h.rank) if 1 <= h.rank < floor_rank
        ]
        heights = _sample_height_fields(field, interior, domain, gx, gy, node_inside)

        # Test every band (top-cap band + each interior horizon band).
        top_cap = np.full((nx, ny), domain.z_max)
        bot_cap = np.full((nx, ny), domain.z_min)
        levels = [top_cap] + [heights[h.rank] for h in interior] + [bot_cap]

        for band_idx, (top_arr, bot_arr) in enumerate(zip(levels, levels[1:], strict=False)):
            vec = _present_cells(top_arr, bot_arr, node_inside, nx, ny)
            ref = _scalar_present_cells(top_arr, bot_arr, node_inside, nx, ny)
            assert np.array_equal(vec, ref), (
                f"fixture={label!r} band={band_idx}: vectorised _present_cells "
                f"differs from scalar oracle — {int((vec != ref).sum())} cells differ"
            )


# ---------------------------------------------------------------------------
# Equivalence — vectorised _label_components == scalar BFS oracle (order incl.)
# ---------------------------------------------------------------------------


def _scalar_label_components(present: np.ndarray) -> list[set[tuple[int, int]]]:
    """Scalar BFS oracle for _label_components: verbatim pre-vectorisation source.

    Kept independent of the scipy.ndimage implementation under test so the
    equivalence test does not compare the code to itself.
    """
    nci, ncj = present.shape
    seen = np.zeros_like(present, dtype=bool)
    components: list[set[tuple[int, int]]] = []
    for i in range(nci):
        for j in range(ncj):
            if not present[i, j] or seen[i, j]:
                continue
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


def test_label_components_vectorised_matches_scalar_oracle() -> None:
    """Vectorised _label_components matches the scalar BFS oracle — SET content AND order.

    Three mask fixtures are tested:

    * **single component** — the whole mask is True; both paths must return one
      set containing every cell.
    * **two disconnected blobs** — a top-left 2×2 block and a bottom-right 2×2
      block separated by a gap.  The scalar BFS seeds the top-left blob first
      (row-major), so the oracle returns it as component[0].  The scipy.ndimage
      path assigns label 1 to the first C-order cell — which is also the
      top-left corner — so the order must match.  This is the CRITICAL test of
      the component-order equivalence argument documented in _label_components.
    * **nested-fixture real mask** — the actual presence mask from the nested
      analytic fixture's top band; exercises a non-trivial polygon-clipped shape
      where component count and membership must match exactly.

    Comparing as ORDERED lists of sets (not just unordered collections) pins the
    component-index → body-id-suffix mapping that determines deterministic bundle
    storage ids.
    """
    from groundmodel.domain.services.strat_field.body_assembly import _label_components

    # --- fixture 1: single fully-connected component ---
    single = np.ones((4, 5), dtype=bool)
    vec1 = _label_components(single)
    ref1 = _scalar_label_components(single)
    assert len(vec1) == len(ref1) == 1, "single-component count mismatch"
    assert vec1[0] == ref1[0], "single-component cell set mismatch"

    # --- fixture 2: two disconnected blobs, order is load-bearing ---
    two_blobs = np.zeros((8, 8), dtype=bool)
    # Blob A: top-left 2×2 — first in raster scan → must be component[0]
    two_blobs[0, 0] = two_blobs[0, 1] = two_blobs[1, 0] = two_blobs[1, 1] = True
    # Blob B: bottom-right 2×2 — second in raster scan → must be component[1]
    two_blobs[6, 6] = two_blobs[6, 7] = two_blobs[7, 6] = two_blobs[7, 7] = True
    vec2 = _label_components(two_blobs)
    ref2 = _scalar_label_components(two_blobs)
    assert len(vec2) == len(ref2) == 2, (
        f"two-blob component count: vectorised={len(vec2)}, scalar={len(ref2)}"
    )
    # Order is the critical invariant: component[0] must be blob A, [1] blob B.
    for comp_idx in range(2):
        assert vec2[comp_idx] == ref2[comp_idx], (
            f"two-blob component[{comp_idx}] cell set mismatch — "
            "scipy.ndimage label order does not match scalar BFS raster order"
        )

    # --- fixture 3: real polygon-clipped mask from the nested analytic fixture ---
    field, order, domain = nested_field_and_domain()
    gx, gy, node_inside = build_shared_grid(domain, _NESTED_SPACING_M)
    nx, ny = len(gx), len(gy)
    floor_rank = max(h.rank for h in order.horizons)
    interior = [h for h in sorted(order.horizons, key=lambda h: h.rank) if 1 <= h.rank < floor_rank]
    heights = _sample_height_fields(field, interior, domain, gx, gy, node_inside)
    top_cap = np.full((nx, ny), domain.z_max)
    bot_first = heights[interior[0].rank]

    from groundmodel.domain.services.strat_field.body_assembly import _present_cells

    real_mask = _present_cells(top_cap, bot_first, node_inside, nx, ny)
    vec3 = _label_components(real_mask)
    ref3 = _scalar_label_components(real_mask)
    assert len(vec3) == len(ref3), (
        f"nested-fixture component count: vectorised={len(vec3)}, scalar={len(ref3)}"
    )
    for comp_idx, (v_set, r_set) in enumerate(zip(vec3, ref3, strict=True)):
        assert v_set == r_set, (
            f"nested-fixture component[{comp_idx}] cell set mismatch "
            f"(vectorised {len(v_set)} cells vs scalar {len(r_set)} cells)"
        )


# ---------------------------------------------------------------------------
# Equivalence — vectorised _build_component_mesh == scalar oracle (same solid)
# ---------------------------------------------------------------------------


def _build_component_mesh_scalar(
    top: np.ndarray,
    bottom: np.ndarray,
    gx: np.ndarray,
    gy: np.ndarray,
    cells: set[tuple[int, int]],
) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Verbatim scalar oracle for _build_component_mesh — the pre-vectorisation implementation.

    Copied from the production code before the vectorisation commit so that the
    equivalence test has an independent reference that does not share any code
    path with the implementation under test.  The oracle is kept here (test file
    only) and never imported into production modules.
    """
    from collections import defaultdict

    _CornerKey = tuple[int, int, int]
    _Quad = tuple[_CornerKey, _CornerKey, _CornerKey, _CornerKey]

    vert_index: dict[tuple[int, int, int], int] = {}
    vertices: list[tuple[float, float, float]] = []

    def vid(ni: int, nj: int, layer: int) -> int:
        key = (ni, nj, layer)
        idx = vert_index.get(key)
        if idx is None:
            z = bottom[ni, nj] if layer == 0 else top[ni, nj]
            idx = len(vertices)
            vertices.append((float(gx[ni]), float(gy[nj]), float(z)))
            vert_index[key] = idx
        return idx

    face_count: dict[tuple, int] = defaultdict(int)
    face_quad: dict[tuple, tuple] = {}

    def add_face(corners: tuple) -> None:
        key = tuple(sorted(corners))
        face_count[key] += 1
        if key not in face_quad:
            face_quad[key] = corners

    def add_side(lo: tuple[int, int], hi: tuple[int, int]) -> None:
        add_face(
            (
                (lo[0], lo[1], 0),
                (hi[0], hi[1], 0),
                (hi[0], hi[1], 1),
                (lo[0], lo[1], 1),
            )
        )

    for ci, cj in cells:
        c00 = (ci, cj)
        c10 = (ci + 1, cj)
        c11 = (ci + 1, cj + 1)
        c01 = (ci, cj + 1)
        add_face(
            ((c00[0], c00[1], 1), (c10[0], c10[1], 1), (c11[0], c11[1], 1), (c01[0], c01[1], 1))
        )
        add_face(
            ((c00[0], c00[1], 0), (c01[0], c01[1], 0), (c11[0], c11[1], 0), (c10[0], c10[1], 0))
        )
        add_side(c00, c10)
        add_side(c10, c11)
        add_side(c11, c01)
        add_side(c01, c00)

    quads = [face_quad[key] for key, cnt in face_count.items() if cnt % 2 == 1]
    triangles: list[tuple[int, int, int]] = []
    for a, b, c, d in quads:
        ia, ib, ic, idd = vid(*a), vid(*b), vid(*c), vid(*d)
        triangles.append((ia, ib, ic))
        triangles.append((ia, ic, idd))

    return vertices, triangles


def _same_solid_via_ray(
    verts_a: list[tuple[float, float, float]],
    tris_a: list[tuple[int, int, int]],
    verts_b: list[tuple[float, float, float]],
    tris_b: list[tuple[int, int, int]],
    gx: np.ndarray,
    gy: np.ndarray,
    label: str,
) -> None:
    """Assert two meshes represent the same solid via dense vertical ray sampling.

    Casts rays on a 30×30 grid spanning ``gx × gy`` (inset by one cell to avoid
    edge ambiguity) and asserts that ``vertical_ray_intervals`` returns the same
    ``(base, top)`` intervals from both meshes within 1e-9 m at every sample.
    """
    xs = np.linspace(float(gx[1]), float(gx[-2]), 30) if len(gx) > 2 else np.array([float(gx[0])])
    ys = np.linspace(float(gy[1]), float(gy[-2]), 30) if len(gy) > 2 else np.array([float(gy[0])])
    for x in xs:
        for y in ys:
            iv_a = vertical_ray_intervals(verts_a, tris_a, float(x), float(y))
            iv_b = vertical_ray_intervals(verts_b, tris_b, float(x), float(y))
            assert len(iv_a) == len(iv_b), (
                f"[{label}] at ({x:.3f},{y:.3f}): interval count differs "
                f"(vectorised {len(iv_a)} vs scalar {len(iv_b)})"
            )
            for (base_a, top_a), (base_b, top_b) in zip(iv_a, iv_b, strict=True):
                assert abs(base_a - base_b) <= 1e-9 and abs(top_a - top_b) <= 1e-9, (
                    f"[{label}] at ({x:.3f},{y:.3f}): interval mismatch "
                    f"vectorised=({base_a:.9f},{top_a:.9f}) "
                    f"scalar=({base_b:.9f},{top_b:.9f})"
                )


def _make_flat_band(
    gx: np.ndarray,
    gy: np.ndarray,
    z_top: float,
    z_bot: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Return flat (nx, ny) top/bottom arrays at constant elevations."""
    nx, ny = len(gx), len(gy)
    return np.full((nx, ny), z_top), np.full((nx, ny), z_bot)


def test_vectorised_mesh_same_solid_full_rectangle() -> None:
    """Vectorised _build_component_mesh produces the same solid as the scalar oracle — full band.

    A 6×5 rectangular grid, all cells present, no NaN nodes, flat top/bottom.
    This is the simplest shape — every top/bottom face is present, all four side
    walls are boundary on the perimeter and internal in the interior.  If the XOR
    mask mis-classifies any interior face as boundary (or any boundary face as
    interior) the manifold check or ray-interval check fires.
    """
    from groundmodel.domain.services.strat_field.body_assembly import _build_component_mesh

    # 7 × 6 nodes → 6 × 5 cells.
    gx = np.linspace(0.0, 6.0, 7)
    gy = np.linspace(0.0, 5.0, 6)
    top_arr, bot_arr = _make_flat_band(gx, gy, z_top=2.0, z_bot=0.0)

    # 6 × 5 cell grid: ci in 0..5, cj in 0..4.
    all_cells: set[tuple[int, int]] = {(ci, cj) for ci in range(6) for cj in range(5)}

    verts_v, tris_v = _build_component_mesh(top_arr, bot_arr, gx, gy, all_cells)
    verts_s, tris_s = _build_component_mesh_scalar(top_arr, bot_arr, gx, gy, all_cells)

    # Both outputs must be closed manifolds.
    assert_closed_manifold(verts_v, tris_v)
    assert_closed_manifold(verts_s, tris_s)

    # Ray-sample equivalence on the 30×30 interior grid.
    _same_solid_via_ray(verts_v, tris_v, verts_s, tris_s, gx, gy, "full-rectangle")


def test_vectorised_mesh_same_solid_pinch_hole() -> None:
    """Vectorised _build_component_mesh handles an interior void (pinch-out hole) correctly.

    A 9×9 cell grid with a 3×3 hole of absent cells in the centre — the shape that
    most directly tests the XOR side-face detection.  Interior faces (between two
    present cells) must cancel; faces bordering the hole (where a present cell has
    an absent neighbour) must be emitted as boundary walls.  A wrong XOR direction
    or off-by-one in the padded-mask shift would misclassify these.
    """
    from groundmodel.domain.services.strat_field.body_assembly import _build_component_mesh

    # 10×10 nodes → 9×9 cells.
    gx = np.linspace(0.0, 9.0, 10)
    gy = np.linspace(0.0, 9.0, 10)
    nx, ny = len(gx), len(gy)
    top_arr, bot_arr = _make_flat_band(gx, gy, z_top=3.0, z_bot=0.0)

    # All 81 cells present minus the central 3×3 (ci=3..5, cj=3..5).
    hole = {(ci, cj) for ci in range(3, 6) for cj in range(3, 6)}
    all_cells: set[tuple[int, int]] = {
        (ci, cj) for ci in range(nx - 1) for cj in range(ny - 1)
    } - hole

    verts_v, tris_v = _build_component_mesh(top_arr, bot_arr, gx, gy, all_cells)
    verts_s, tris_s = _build_component_mesh_scalar(top_arr, bot_arr, gx, gy, all_cells)

    assert_closed_manifold(verts_v, tris_v)
    assert_closed_manifold(verts_s, tris_s)

    # Ray-sample equivalence — must agree both inside and outside the hole.
    _same_solid_via_ray(verts_v, tris_v, verts_s, tris_s, gx, gy, "pinch-hole")


def test_vectorised_mesh_same_solid_split_components() -> None:
    """Vectorised _build_component_mesh handles per-component boundaries when a band splits.

    A 12×4 cell grid split into two disconnected 4×4 blobs separated by a 4-cell
    gap.  The two blobs are passed as SEPARATE cell sets (simulating what
    ``emit_prism_bodies_with_fields`` does per connected component) and each must
    independently produce a closed manifold identical to the scalar oracle.  This
    test verifies that the local-mask bounding box (ci_min/cj_min offset) correctly
    handles a component that starts at a non-zero ci/cj — a regression risk when
    the offset arithmetic is wrong.
    """
    from groundmodel.domain.services.strat_field.body_assembly import _build_component_mesh

    # 13×5 nodes → 12×4 cells.
    gx = np.linspace(0.0, 12.0, 13)
    gy = np.linspace(0.0, 4.0, 5)
    top_arr, bot_arr = _make_flat_band(gx, gy, z_top=1.5, z_bot=-0.5)

    # Blob A: columns ci=0..3, cj=0..3  (4×4 = 16 cells).
    blob_a: set[tuple[int, int]] = {(ci, cj) for ci in range(4) for cj in range(4)}
    # Blob B: columns ci=8..11, cj=0..3 (4×4 = 16 cells) — separated by a 4-col gap.
    blob_b: set[tuple[int, int]] = {(ci, cj) for ci in range(8, 12) for cj in range(4)}

    for label, blob in (("split-blob-A", blob_a), ("split-blob-B", blob_b)):
        verts_v, tris_v = _build_component_mesh(top_arr, bot_arr, gx, gy, blob)
        verts_s, tris_s = _build_component_mesh_scalar(top_arr, bot_arr, gx, gy, blob)

        assert_closed_manifold(verts_v, tris_v)
        assert_closed_manifold(verts_s, tris_s)

        _same_solid_via_ray(verts_v, tris_v, verts_s, tris_s, gx, gy, label)
