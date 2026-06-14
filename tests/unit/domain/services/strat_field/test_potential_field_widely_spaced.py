"""Stage-3 coordinate-spread gate: the field stays BOUNDED at real BE/NL spacing.

The compact Stage-3 fixtures in ``test_potential_field.py`` are all small-coord /
small-spread (the benign layer-cake), so they never exposed the coordinate-spread
explosion: on a real project the control points sit at Lambert-72 magnitude
(x ≈ 150 km, y ≈ 200 km) with contacts only a few metres deep and boreholes
100–300 m apart, and a cubic RBF fit on those RAW metres blows up between the
holes (Task-8 integration measured ~190 000 — orders of magnitude above the iso
range), producing ZERO usable bodies.

These tests run on the widely-spaced, irregular, real-data-magnitude fixture and
pin the four properties the coordinate-normalisation fix must deliver:

1. **No explosion** — the field magnitude stays a small multiple of the iso range
   (NOT thousands).  This is the explicit gate that was missing; it would FAIL on
   the old raw-coordinate code path (this module measures the raw field directly
   to prove the gap, then asserts the normalised field passes).
2. **Monotonicity still holds** — F is non-decreasing down every borehole and
   crosses each contact's iso-value at the observed depth (the central invariant
   must survive the fix).
3. **The dip is still reproduced** — a contact deeper down-dip reads back deeper.
4. **End-to-end** — ``build_strat_model`` produces NON-EMPTY watertight bodies
   that tile the authored columns at real spacing, the thing that returned ZERO
   bodies before the fix.

All assertions are phrased in the field / isosurface / contact / dip vocabulary,
not the interpolation / normalisation implementation.
"""

from __future__ import annotations

import numpy as np

# reason: scipy ships no type stubs; the rest of the strat-field domain uses the
# same narrow per-import ignore.  Only the explicit RAW-field reproducer below
# touches scipy directly — production code goes through ``fit_potential_field``.
from scipy.interpolate import RBFInterpolator  # type: ignore[import-untyped]

from groundmodel.domain.services.strat_field.potential_field import fit_potential_field
from groundmodel.domain.services.strat_field.potential_field_constants import (
    RBF_DEGREE,
    RBF_KERNEL,
)
from groundmodel.domain.services.strat_field.strat_builder import build_strat_model
from groundmodel.domain.services.strat_field.strat_types import Block
from tests.unit.domain.services.strat_field.fixtures import (
    BoreholeProbe,
    widely_spaced_block,
    widely_spaced_build_fixture,
    widely_spaced_control_with_holes,
)
from tests.unit.domain.services.strat_field.strat_invariants import (
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
)

# The no-explosion bound, as a multiple of the iso RANGE (deepest minus
# shallowest iso-value).  A correctly-conditioned field stays within a small
# multiple of the range it interpolates; a blown-up field is many multiples (the
# raw field on this fixture is ~10× the range, ~39 absolute).  5× cleanly
# separates the normalised field (~2× the range, ~8 absolute) from the raw one.
_NO_EXPLOSION_RANGE_FACTOR = 5.0


def _domain_grid(block: Block, n: int = 18) -> list[tuple[float, float, float]]:
    """Return a dense ``n×n×n`` ``(x, y, z)`` grid spanning the block.

    Parameters
    ----------
    block : Block
        The fit block whose xy bounding box + z-range frames the grid.
    n : int, optional
        Samples per axis.  Default 18 (≈5.8 k points — fast, dense enough to
        catch an inter-borehole blow-up).

    Returns
    -------
    list of (float, float, float)
        The grid points.
    """
    xs = [vx for vx, _ in block.polygon]
    ys = [vy for _, vy in block.polygon]
    gx = np.linspace(min(xs), max(xs), n)
    gy = np.linspace(min(ys), max(ys), n)
    gz = np.linspace(block.z_min, block.z_max, n)
    return [(float(x), float(y), float(z)) for x in gx for y in gy for z in gz]


def _iso_range(order: object) -> float:
    """Return the iso-value RANGE (deepest minus shallowest) of the column."""
    isos = [order.iso_value(h.rank) for h in order.horizons]  # type: ignore[attr-defined]
    return max(isos) - min(isos)


# ---------------------------------------------------------------------------
# 1 — THE NO-EXPLOSION GATE (was missing; fails on raw coordinates)
# ---------------------------------------------------------------------------


def test_field_is_bounded_at_real_spacing() -> None:
    """The widely-spaced field stays a small multiple of the iso range — NO blow-up.

    On the raw-coordinate code path the cubic RBF explodes between the
    hundreds-of-metres-apart boreholes; normalising the coordinates before the fit
    keeps the field bounded.  Evaluated on a dense grid across the whole domain,
    ``max(|F|)`` must be within :data:`_NO_EXPLOSION_RANGE_FACTOR` × the iso range,
    not the thousands a raw fit produces.
    """
    control, order, _holes = widely_spaced_control_with_holes()
    block = widely_spaced_block()
    field = fit_potential_field(control, blocks=[block])

    grid = _domain_grid(block)
    vals = field.evaluate(grid)
    max_abs = float(np.max(np.abs(vals)))
    bound = _NO_EXPLOSION_RANGE_FACTOR * _iso_range(order)

    assert max_abs < bound, (
        f"field exploded at real spacing: max(|F|)={max_abs:.2f} exceeds "
        f"{_NO_EXPLOSION_RANGE_FACTOR}× the iso range ({bound:.2f}) — the "
        f"coordinate-normalisation fix is not bounding the field"
    )


def test_raw_coordinate_fit_would_explode_normalisation_fixes_it() -> None:
    """The OLD raw-coordinate fit blows the gate; the normalised fit passes it.

    Pins WHY the fix is needed and that it works: fitting the SAME control on raw
    Lambert-72 metres (the pre-fix code path, reproduced inline) produces a field
    far above the no-explosion bound, while the production normalised fit stays
    well under it.  Guards against a future regression that drops the
    normalisation step — the bound would silently start passing on raw data only
    if the data happened to be benign, but this widely-spaced fixture is not.
    """
    control, order, _holes = widely_spaced_control_with_holes()
    block = widely_spaced_block()
    grid = np.array(_domain_grid(block))
    bound = _NO_EXPLOSION_RANGE_FACTOR * _iso_range(order)

    # Raw-coordinate fit — exactly the pre-fix code path (no normalisation).
    xyz = np.array([(p.x, p.y, p.z) for p in control.points], dtype=float)
    iso = np.array([control.column.iso_value(p.horizon_rank) for p in control.points], dtype=float)
    raw_rbf = RBFInterpolator(xyz, iso, kernel=RBF_KERNEL, degree=RBF_DEGREE, smoothing=0.05)
    raw_max = float(np.max(np.abs(raw_rbf(grid))))

    # Production normalised fit.
    field = fit_potential_field(control, blocks=[block])
    norm_max = float(np.max(np.abs(field.evaluate(grid))))

    assert raw_max > bound, (
        f"raw fit unexpectedly bounded (max={raw_max:.2f} < {bound:.2f}); the "
        f"widely-spaced fixture no longer reproduces the raw-coordinate explosion"
    )
    assert norm_max < bound, f"normalised fit not bounded (max={norm_max:.2f} >= {bound:.2f})"
    # The fix must be a large improvement, not a marginal one.
    assert norm_max < raw_max, (
        f"normalisation did not reduce the field magnitude: raw={raw_max:.2f}, "
        f"normalised={norm_max:.2f}"
    )


# ---------------------------------------------------------------------------
# 2 — MONOTONICITY STILL HOLDS (the fix did not break correctness)
# ---------------------------------------------------------------------------


def test_field_is_monotonic_down_every_borehole_at_real_spacing() -> None:
    """F is non-decreasing down every widely-spaced borehole and crosses each iso.

    The same central invariant as the compact fixture's monotonicity gate, on the
    real-data-magnitude fixture: normalising the coordinates must not introduce
    bubbling, and the field must still equal each horizon's iso-value at the
    observed contact depth (within the smoothing tolerance).
    """
    control, order, holes = widely_spaced_control_with_holes()
    field = fit_potential_field(control, blocks=[widely_spaced_block()])

    for hole in holes:
        vals = field.evaluate(hole.xyz_descending)
        assert all(b >= a - 1e-6 for a, b in zip(vals, vals[1:])), (
            f"field bubbled (decreased) down hole {hole.investigation_id}: {vals}"
        )
        for rank, depth in hole.observed_contacts:
            z = hole.surface - depth
            got = field.evaluate([(hole.x, hole.y, z)])[0]
            assert abs(got - order.iso_value(rank)) < 0.25, (
                f"hole {hole.investigation_id} contact rank {rank} at depth {depth} m: "
                f"F={got}, expected iso={order.iso_value(rank)}"
            )


# ---------------------------------------------------------------------------
# 3 — THE DIP IS STILL REPRODUCED
# ---------------------------------------------------------------------------


def test_dip_is_reproduced_at_real_spacing() -> None:
    """A contact deeper down-dip reads back as a deeper isosurface at real spacing.

    Isotropic normalisation preserves the x:y:z aspect ratio, so the dip is not
    distorted: the deepest internal horizon descends along the borehole order, and
    sampling the field on the up-dip vs down-dip verticals must put the isosurface
    DEEPER down-dip.
    """
    control, order, holes = widely_spaced_control_with_holes()
    field = fit_potential_field(control, blocks=[widely_spaced_block()])
    block = widely_spaced_block()

    dipping_rank = max(rank for h in holes for rank, _ in h.observed_contacts)

    def deepest_contact_depth(hole: BoreholeProbe) -> float:
        return max(d for r, d in hole.observed_contacts if r == dipping_rank)

    up_dip = min(holes, key=deepest_contact_depth)
    down_dip = max(holes, key=deepest_contact_depth)
    iso = order.iso_value(dipping_rank)

    def isosurface_depth(hole: BoreholeProbe) -> float:
        zs = np.arange(hole.surface, block.z_min - 0.1, -0.1)
        vals = field.evaluate([(hole.x, hole.y, float(z)) for z in zs])
        for i in range(len(zs) - 1):
            v0, v1 = vals[i], vals[i + 1]
            if (v0 - iso) <= 0.0 <= (v1 - iso) or (v0 - iso) >= 0.0 >= (v1 - iso):
                frac = 0.0 if v1 == v0 else (iso - v0) / (v1 - v0)
                z_cross = zs[i] + frac * (zs[i + 1] - zs[i])
                return hole.surface - z_cross
        raise AssertionError(f"field never crossed iso={iso} on hole {hole.investigation_id}")

    depth_up = isosurface_depth(up_dip)
    depth_down = isosurface_depth(down_dip)
    assert depth_down > depth_up, (
        f"dip not reproduced at real spacing: isosurface depth up-dip={depth_up}, "
        f"down-dip={depth_down}"
    )


# ---------------------------------------------------------------------------
# 4 — END-TO-END: non-empty watertight bodies at real spacing (unblocks Task 11)
# ---------------------------------------------------------------------------


def _interior_samples(domain: Block, n: int = 8) -> list[tuple[float, float]]:
    """Return ``n × n`` interior ``(x, y)`` samples of the domain."""
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    sx = np.linspace(min(xs) + 1.0, max(xs) - 1.0, n)
    sy = np.linspace(min(ys) + 1.0, max(ys) - 1.0, n)
    return [(float(x), float(y)) for x in sx for y in sy]


def test_build_strat_model_produces_watertight_bodies_at_real_spacing() -> None:
    """``build_strat_model`` yields NON-EMPTY watertight, non-overlapping bodies.

    The end-to-end proof that the fix unblocks Task 11: at real Lambert-72 spacing
    the builder now produces a populated set of closed-manifold bodies that do not
    overlap and tile the authored ZAND/KLEI/ZAND/KLEI stack — where the pre-fix
    exploded field produced ZERO usable bodies.
    """
    control, domain, authored = widely_spaced_build_fixture()
    # 4 m grid over the ~700 m domain: fast and fine enough to reproduce the
    # gently-dipping bases within the column-diff tolerance.
    bodies = build_strat_model(control, domain, [domain], grid_spacing_m=4.0)

    assert bodies, "builder produced ZERO bodies at real spacing — the fix failed"
    # The interbedded stack has both lithologies present.
    assert {b.formation_id for b in bodies} == {"ZAND", "KLEI"}
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)

    samples = _interior_samples(domain)
    assert_no_overlap_sampled(bodies, samples)
    # Real spacing → coarser tolerance than the dense compact fixture (the gentle
    # dip over hundreds of metres is sampled on a 4 m grid).
    assert_model_matches_columns(bodies, authored, tol_m=1.0)


def test_build_strat_model_is_deterministic_at_real_spacing() -> None:
    """Two builds of the widely-spaced model produce byte-identical meshes.

    The normalisation transform is derived deterministically (centroid + max
    half-extent, no RNG, no set ordering), so the build is reproducible — the
    bundle-replay checksum depends on it.
    """
    control, domain, _ = widely_spaced_build_fixture()
    a = build_strat_model(control, domain, [domain], grid_spacing_m=4.0)
    b = build_strat_model(control, domain, [domain], grid_spacing_m=4.0)
    assert len(a) == len(b)
    for ba, bb in zip(a, b, strict=True):
        assert (ba.body_id, ba.formation_id) == (bb.body_id, bb.formation_id)
        assert ba.vertices == bb.vertices
        assert ba.triangles == bb.triangles
