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
