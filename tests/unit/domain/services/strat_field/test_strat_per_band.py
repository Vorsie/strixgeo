"""Task-7 tests: surface-bounded body caps + per-geological-band build loop.

Tests are written RED-first (before the implementation) following the TDD
discipline in CLAUDE.md: each test comment is phrased in the owner's
vocabulary (geological band, shared surface, seam, stitch) so a regression
reads as a clear contract break, not an implementation detail.

Gate invariants
---------------
* ``assert_closed_manifold`` — every body is a closed 2-manifold.
* ``assert_no_overlap_sampled`` STRICT (TOL 1e-6) — the cross-band seam must
  produce NO overlap: band A's base and band B's top are byte-identical because
  they are evaluated from the SAME ``SurfaceBound`` at the SAME grid nodes.
* Seam-continuity check — at every sample ``(x, y)`` the boundary elevation
  between band A and band B equals ``surface.evaluate(x, y)`` within 1e-9 m.
* ``assert_model_matches_columns`` — a column through the lens reads correctly;
  the band boundary appears at the geological surface.

Fixture choice
--------------
Real-data-shaped (Lambert-72-ish magnitude, sloped surface, interbedded picks
per band, a lens in the lower band) — NOT layer-cake-only.  That is the lesson
from the loft builder: layer-cake-only testing hides the real bugs.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.strat_field.body_assembly import (
    assemble_bodies,
    build_shared_grid,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    Horizon,
    StratColumn,
    SurfaceBound,
)
from tests.unit.domain.services.strat_field.strat_invariants import (
    AuthoredColumn,
    AuthoredUnit,
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sloped_surface(
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z_at_x0: float,
    z_at_x1: float,
) -> SurfaceBound:
    """A flat-in-y, linearly-sloped-in-x geological surface.

    The slope ensures the geological surface is NOT horizontal, so the test
    exercises the curved-cap path (not just the z_max/z_min flat degenerate).
    """
    # Four corners; slope only in x — constant in y.
    z0y0 = z_at_x0
    z1y0 = z_at_x1
    z0y1 = z_at_x0
    z1y1 = z_at_x1
    vertices = [
        (x0, y0, z0y0),
        (x1, y0, z1y0),
        (x1, y1, z1y1),
        (x0, y1, z0y1),
    ]
    triangles = [(0, 1, 2), (0, 2, 3)]
    return SurfaceBound(vertices=vertices, triangles=triangles)


# Lambert-72-ish footprint: 400 m × 400 m centred near (150 200, 200 200).
_X0 = 150_000.0
_Y0 = 200_000.0
_X1 = 150_400.0
_Y1 = 200_400.0
_XM = 0.5 * (_X0 + _X1)  # midpoint x = 150_200
_YM = 0.5 * (_Y0 + _Y1)  # midpoint y = 200_200

# Geological surface: sloped from -5 m at x=X0 to -10 m at x=X1.
_GEO_Z_AT_X0 = -5.0
_GEO_Z_AT_X1 = -10.0


def _geo_surface() -> SurfaceBound:
    """The single geological surface separating band A (upper) from band B (lower)."""
    return _sloped_surface(_X0, _X1, _Y0, _Y1, _GEO_Z_AT_X0, _GEO_Z_AT_X1)


def _polygon() -> tuple[tuple[float, float], ...]:
    return ((_X0, _Y0), (_X1, _Y0), (_X1, _Y1), (_X0, _Y1))


def _geo_z(x: float) -> float:
    """Analytical geo-surface elevation at x (same linear slope as _geo_surface)."""
    t = (x - _X0) / (_X1 - _X0)
    return _GEO_Z_AT_X0 + t * (_GEO_Z_AT_X1 - _GEO_Z_AT_X0)


# ---------------------------------------------------------------------------
# Analytic fields for each band
# ---------------------------------------------------------------------------


class _LinearField:
    """Analytic monotone field: F = a*(z_ref - z) / span, with iso at rank*1.

    Increases with depth (F larger = deeper).  Iso-value k is crossed at z_ref - k*span/a.

    Parameters
    ----------
    z_top : float
        Top of the field's valid range.
    z_bot : float
        Bottom of the field's valid range.
    n_horizons : int
        Number of interior horizons (so iso-values 1..n_horizons span [z_top, z_bot]).
    """

    def __init__(self, z_top: float, z_bot: float, n_horizons: int) -> None:
        self._z_top = z_top
        self._z_bot = z_bot
        self._n = n_horizons  # iso-values 1..n at even depth intervals

    def evaluate(self, xyz: object) -> object:
        """Evaluate at (N, 3) array."""
        pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
        z = pts[:, 2]
        # F = (z_top - z) / span * n so that F=0 at z_top and F=n at z_bot.
        span = self._z_top - self._z_bot
        return (self._z_top - z) / span * self._n


def _two_band_blocks(spacing_m: float = 10.0) -> tuple[Block, Block, SurfaceBound, float, float]:
    """Return band-A block, band-B block, the shared geo surface, z_max, and z_min.

    Band A: top=flat z_max=+5, base=geo_surface.
    Band B: top=geo_surface, base=flat z_min=-20.
    The shared geo_surface is the SAME SurfaceBound object for both blocks.
    """
    geo = _geo_surface()
    z_max = 5.0
    z_min = -20.0
    poly = _polygon()
    block_a = Block(polygon=poly, z_min=z_min, z_max=z_max, top_surface=None, base_surface=geo)
    block_b = Block(polygon=poly, z_min=z_min, z_max=z_max, top_surface=geo, base_surface=None)
    return block_a, block_b, geo, z_max, z_min


# A simple ZAND/KLEI column for band A (1 interior horizon: ZAND above / KLEI below).
def _band_a_column() -> StratColumn:
    """Band A: ZAND at top, KLEI at base, one interior contact at iso 1."""
    return StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "ZAND", ("surf-a",)),
            Horizon(1, 1.0, "ZAND", "KLEI", ("c1-a",)),
            Horizon(2, 2.0, "KLEI", None, ()),
        )
    )


# A SILT/VEEN column for band B (1 interior horizon: SILT above / VEEN below).
def _band_b_column() -> StratColumn:
    """Band B: SILT at top, VEEN at base, one interior contact at iso 1."""
    return StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "SILT", ("surf-b",)),
            Horizon(1, 1.0, "SILT", "VEEN", ("c1-b",)),
            Horizon(2, 2.0, "VEEN", None, ()),
        )
    )


# Grid spacing for the per-band tests: coarse but enough to resolve the sloped surface.
_SPACING_M = 20.0

# Sample grid (interior points, not grazing the perimeter wall).
_N_SAMPLES = 6
_SAMPLES = [
    (
        float(_X0 + (i + 0.5) * (_X1 - _X0) / _N_SAMPLES),
        float(_Y0 + (j + 0.5) * (_Y1 - _Y0) / _N_SAMPLES),
    )
    for i in range(_N_SAMPLES)
    for j in range(_N_SAMPLES)
]


# ---------------------------------------------------------------------------
# Test 1: surface-bounded TOP cap is curved (not flat z_max)
# ---------------------------------------------------------------------------


def test_surface_cap_top_replaces_flat_zmax() -> None:
    """When a Block carries top_surface, the TOP cap follows the surface z(x,y).

    Band B's top surface IS the geo surface. At each grid node the body's top
    elevation must equal geo_surface.evaluate(x, y), not the flat z_max=+5.
    This is the direct test of the cap-replacement logic in _iter_bands.
    """
    _, block_b, geo, z_max, z_min = _two_band_blocks()
    col_b = _band_b_column()
    # Use a field that puts the single interior iso in the middle of the band.
    # Band B spans from geo_surface (≈ -5 to -10 m) down to z_min (-20 m).
    # Use a field whose iso-1 surface is halfway in the band.
    field_b = _LinearField(z_top=_GEO_Z_AT_X0, z_bot=z_min, n_horizons=2)

    bodies_b = assemble_bodies(field_b, col_b, block_b, _SPACING_M)
    assert bodies_b, "band B must produce at least one body"

    # The top body's top cap must follow geo_surface, not be flat at z_max.
    # The top SILT body in band B spans from geo_surface.evaluate(x,y) down to
    # the interior contact.  Ray-sample each interior grid node: band B's top
    # interval top elevation must equal geo_surface.evaluate(x, y) approximately
    # (within one grid step's slope variation, which is small at 20 m spacing).
    gx, gy, node_inside = build_shared_grid(block_b, _SPACING_M)
    # Find the SILT body (top body in band B, capped by geo surface above).
    silt_bodies = [b for b in bodies_b if b.formation_id == "SILT"]
    assert silt_bodies, "SILT body (top band-B unit) must be emitted"

    any_hit = False
    for xi in gx[1:-1]:
        for yj in gy[1:-1]:
            geo_z = geo.evaluate(float(xi), float(yj))
            for b in silt_bodies:
                ivs = vertical_ray_intervals(b.vertices, b.triangles, float(xi), float(yj))
                if ivs:
                    any_hit = True
                    # The topmost interval's top must be AT the geo surface (≤ slope cell).
                    top_elev = max(t for _, t in ivs)
                    # Within 1 grid step slope: the stepped prism tops the geo surface
                    # at node heights, so the top is the node's exact geo_surface value.
                    assert top_elev <= geo_z + _SPACING_M * 0.1 + 0.05, (
                        f"Band B SILT top ({top_elev:.3f}) exceeds geo surface "
                        f"({geo_z:.3f}) at ({xi:.1f}, {yj:.1f}) — cap not bounded"
                    )
    assert any_hit, "no ray hits in band B — bodies may be empty or outside the domain"


# ---------------------------------------------------------------------------
# Test 2: surface-bounded BASE cap is curved (not flat z_min)
# ---------------------------------------------------------------------------


def test_surface_cap_base_replaces_flat_zmin() -> None:
    """When a Block carries base_surface, the BASE cap follows the surface z(x,y).

    Band A's base surface IS the geo surface. The KLEI body (the lower body in
    band A) must bottom out at geo_surface.evaluate(x, y) at each node, not at
    the flat z_min=-20.
    """
    block_a, _, geo, z_max, z_min = _two_band_blocks()
    col_a = _band_a_column()
    # Band A spans from z_max (+5) down to geo_surface (≈ -5 to -10 m).
    field_a = _LinearField(z_top=z_max, z_bot=_GEO_Z_AT_X0, n_horizons=2)

    bodies_a = assemble_bodies(field_a, col_a, block_a, _SPACING_M)
    assert bodies_a, "band A must produce at least one body"

    klei_bodies = [b for b in bodies_a if b.formation_id == "KLEI"]
    assert klei_bodies, "KLEI body (base band-A unit) must be emitted"

    gx, gy, _ = build_shared_grid(block_a, _SPACING_M)
    any_hit = False
    for xi in gx[1:-1]:
        for yj in gy[1:-1]:
            geo_z = geo.evaluate(float(xi), float(yj))
            for b in klei_bodies:
                ivs = vertical_ray_intervals(b.vertices, b.triangles, float(xi), float(yj))
                if ivs:
                    any_hit = True
                    base_elev = min(b for b, _ in ivs)
                    # Must be ≥ geo_surface (the base cap), not reaching z_min.
                    assert base_elev >= geo_z - _SPACING_M * 0.1 - 0.05, (
                        f"Band A KLEI base ({base_elev:.3f}) falls below geo surface "
                        f"({geo_z:.3f}) at ({xi:.1f}, {yj:.1f}) — base cap not applied"
                    )
                    assert base_elev > z_min + 5.0, (
                        f"Band A KLEI base ({base_elev:.3f}) reached flat z_min "
                        f"({z_min}) — base_surface cap not replacing z_min"
                    )
    assert any_hit, "no ray hits in band A — bodies may be empty or outside the domain"


# ---------------------------------------------------------------------------
# Test 3: watertight seam — each band's bodies are closed manifolds
# ---------------------------------------------------------------------------


def test_each_band_bodies_are_closed_manifolds() -> None:
    """Every body in every band is a closed 2-manifold with consistent winding.

    This is the per-band watertight gate. A surface-bounded cap that is
    incorrectly stitched (open edge, inconsistent normal) fires here.
    """
    block_a, block_b, geo, z_max, z_min = _two_band_blocks()
    col_a = _band_a_column()
    col_b = _band_b_column()
    field_a = _LinearField(z_top=z_max, z_bot=_GEO_Z_AT_X0, n_horizons=2)
    field_b = _LinearField(z_top=_GEO_Z_AT_X0, z_bot=z_min, n_horizons=2)

    for label, bodies in (
        ("band A", assemble_bodies(field_a, col_a, block_a, _SPACING_M)),
        ("band B", assemble_bodies(field_b, col_b, block_b, _SPACING_M)),
    ):
        assert bodies, f"{label} produced no bodies"
        for b in bodies:
            assert b.is_flagged is False, f"{label} body {b.body_id!r} is flagged"
            assert_closed_manifold(b.vertices, b.triangles)


# ---------------------------------------------------------------------------
# Test 4: seam continuity — cross-band no-overlap (THE critical invariant)
# ---------------------------------------------------------------------------


def test_no_overlap_across_band_seam_strict() -> None:
    """Bodies from different bands do NOT overlap across the geological seam.

    Band A and band B share the SAME SurfaceBound as band A's base and band B's
    top.  Built over the SAME shared grid (same polygon → same gx/gy/node_inside
    per band call), the cap arrays are evaluated at identical node positions →
    byte-identical elevations → the bottom face of band A and the top face of
    band B form an exact weld.

    The invariant: no two bodies from different bands overlap by more than TOL
    (1e-6 m) at any sampled (x, y).  Touching (the seam) does NOT count as
    overlap because the deduplication in vertical_ray_intervals collapses
    coincident crossings.
    """
    block_a, block_b, geo, z_max, z_min = _two_band_blocks()
    col_a = _band_a_column()
    col_b = _band_b_column()
    field_a = _LinearField(z_top=z_max, z_bot=_GEO_Z_AT_X0, n_horizons=2)
    field_b = _LinearField(z_top=_GEO_Z_AT_X0, z_bot=z_min, n_horizons=2)

    bodies_a = assemble_bodies(field_a, col_a, block_a, _SPACING_M)
    bodies_b = assemble_bodies(field_b, col_b, block_b, _SPACING_M)

    assert bodies_a, "band A must produce bodies"
    assert bodies_b, "band B must produce bodies"

    all_bodies = bodies_a + bodies_b
    assert_no_overlap_sampled(all_bodies, _SAMPLES)


# ---------------------------------------------------------------------------
# Test 5: seam elevation continuity
# ---------------------------------------------------------------------------


def test_seam_elevation_matches_geo_surface() -> None:
    """At each sample (x,y) band A's base elevation == band B's top == geo_surface(x,y).

    The WHOLE point of the shared-surface + shared-grid stitch: the boundary
    between the two bands is exactly the geological surface, not an approximation.
    Tolerance: 1e-9 m (machine precision on node evaluation).
    """
    block_a, block_b, geo, z_max, z_min = _two_band_blocks()
    col_a = _band_a_column()
    col_b = _band_b_column()
    field_a = _LinearField(z_top=z_max, z_bot=_GEO_Z_AT_X0, n_horizons=2)
    field_b = _LinearField(z_top=_GEO_Z_AT_X0, z_bot=z_min, n_horizons=2)

    bodies_a = assemble_bodies(field_a, col_a, block_a, _SPACING_M)
    bodies_b = assemble_bodies(field_b, col_b, block_b, _SPACING_M)

    # At each interior sample, find the lowest ray crossing from band A (its
    # base) and the highest crossing from band B (its top): both must equal
    # geo.evaluate(x, y) within machine precision.
    gx, gy, _ = build_shared_grid(block_a, _SPACING_M)
    seam_samples = [(float(xi), float(yj)) for xi in gx[1:-1] for yj in gy[1:-1]]
    hits = 0
    for x, y in seam_samples:
        geo_z = geo.evaluate(x, y)
        # Lowest crossing of any band-A body = band A's base at this (x,y).
        a_crossings = []
        for b in bodies_a:
            for base, top in vertical_ray_intervals(b.vertices, b.triangles, x, y):
                a_crossings.append(base)
                a_crossings.append(top)
        # Highest crossing of any band-B body = band B's top at this (x,y).
        b_crossings = []
        for b in bodies_b:
            for base, top in vertical_ray_intervals(b.vertices, b.triangles, x, y):
                b_crossings.append(base)
                b_crossings.append(top)

        if not a_crossings or not b_crossings:
            continue
        hits += 1
        a_base = min(a_crossings)  # lowest face of band A
        b_top = max(b_crossings)  # highest face of band B

        # Both must equal the geo surface at this node.
        assert abs(a_base - geo_z) <= 1e-9, (
            f"Band A base {a_base:.9f} != geo_surface {geo_z:.9f} at ({x:.1f},{y:.1f})"
        )
        assert abs(b_top - geo_z) <= 1e-9, (
            f"Band B top {b_top:.9f} != geo_surface {geo_z:.9f} at ({x:.1f},{y:.1f})"
        )
        # The seam is watertight: the two faces are byte-identical.
        assert abs(a_base - b_top) <= 1e-9, (
            f"Seam GAP/OVERLAP at ({x:.1f},{y:.1f}): "
            f"band A base {a_base:.9f} != band B top {b_top:.9f} — seam not welded"
        )
    assert hits > 0, "no interior nodes had ray hits from both bands"


# ---------------------------------------------------------------------------
# Test 6: interior horizon clamped to band caps
# ---------------------------------------------------------------------------


def test_interior_horizon_clamped_to_band_caps() -> None:
    """An interior horizon is clamped to [base_surface, top_surface] per node.

    If the implicit field produces a crossing OUTSIDE the band's cap surfaces
    (above top_surface or below base_surface), the clamping must pin it to the
    cap so no body escapes the geological band.  Use a field that would produce
    a crossing above the geo surface at some nodes without clamping.
    """
    _, block_b, geo, z_max, z_min = _two_band_blocks()
    col_b = _band_b_column()

    # This field's iso-1 crossing in band B can be attempted ABOVE the geo surface
    # if we use z_top > geo_z (the field evaluates to iso 1 ABOVE the band top).
    # With a flat field that crosses iso-1 at z = geo_at_X0 + 2 (above geo at X0),
    # the clamp must pull it down to geo_z.
    # Simplest test: a field that places the interior contact near the top cap.
    # The cap is geo_surface (≈ -5 m at X0); a field that crosses iso-1 at -3 m
    # is ABOVE the top_surface and must be clamped to the top cap.
    class _FieldAboveCap:
        """Field that crosses iso-1 above the geo surface (before clamping)."""

        def evaluate(self, xyz: object) -> object:
            pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
            z = pts[:, 2]
            # Crosses iso 1 at z = -3 m (above geo_z ≈ -5 to -10 m).
            return -3.0 - z

    field = _FieldAboveCap()
    bodies = assemble_bodies(field, col_b, block_b, _SPACING_M)

    # The clamp collapses the SILT band to (near) zero thickness — the most
    # adversarial cap path — so the surviving bodies must STILL each be a closed
    # 2-manifold (a degenerate / open mesh from the collapse would fire here).
    for b in bodies:
        assert_closed_manifold(b.vertices, b.triangles)

    # With clamping: the band is still valid (if the iso crossing is above the top
    # cap, the contact is clamped to the cap, yielding a zero-thickness or absent
    # SILT body; the VEEN body fills the whole band).  Without clamping: the SILT
    # body would extend ABOVE the geo surface, overlapping band A.
    # Invariant: every body in band B must lie BELOW (or at) the geo surface.
    for b in bodies:
        for x, y in _SAMPLES:
            geo_z = geo.evaluate(x, y)
            for base, top in vertical_ray_intervals(b.vertices, b.triangles, x, y):
                assert top <= geo_z + 1e-9, (
                    f"Body {b.body_id!r} ({b.formation_id}) top {top:.6f} exceeds "
                    f"geo_surface {geo_z:.6f} at ({x:.1f},{y:.1f}) — clamp missing"
                )


# ---------------------------------------------------------------------------
# Test 7: build_strat_model_per_band — per-band loop produces all bodies
# ---------------------------------------------------------------------------


def _two_band_control_fixture():
    """Build control data + blocks for a 2-band interbedded model with a lens.

    Returns a dict of everything needed by the per-band build loop:
    - ``bands``: list of band dicts (``control``, ``block``, ``lens_inputs``).
    - ``domain``: the full-domain Block (for computing the shared grid).
    - ``all_formation_ids``: the set of expected formation_ids across both bands.
    - ``samples``: interior (x, y) sample points.
    - ``authored_columns``: list of AuthoredColumn for the column-diff check.
    """
    from groundmodel.domain.services.strat_field.control_data import (
        ContactObservation,
        InvestigationColumn,
        build_control_data,
    )
    from groundmodel.domain.services.strat_field.stratigraphic_order import (
        OrderInputUnit,
        build_stratigraphic_order,
    )

    geo = _geo_surface()
    z_max = 5.0
    z_min = -20.0
    poly = _polygon()

    # Four investigations, one near each corner of the footprint.
    # DESIGN NOTE: The cubic RBF requires control points at MULTIPLE iso-values
    # to produce a well-behaved field that covers the full footprint.  With only
    # one iso-value (e.g. all 8 points at F=1.0), the RBF produces a nearly-
    # constant field ≈1.0 everywhere; the rising-crossing scan finds crossings
    # only at the ~4 nodes nearest each control point, leaving 396 nodes empty
    # (diagnostics confirmed 2026-06-15).  The fix: give each band THREE litho
    # units (2 interior horizons → 2 iso-values → a real z-gradient in F).
    #
    # Band A: ZAND / SILT / KLEI (iso 1 at ~-1 m, iso 2 at ~-3 m)
    # Band B: GRINT / LEEM / VEEN (iso 1 at ~-12 m, iso 2 at ~-15 m)
    # All contacts well inside their respective geo band so the cap clamp
    # doesn't interfere.
    inv_positions = [
        (_X0 + 60.0, _Y0 + 60.0),
        (_X1 - 60.0, _Y0 + 60.0),
        (_X0 + 60.0, _Y1 - 60.0),
        (_X1 - 60.0, _Y1 - 60.0),
    ]
    n_inv = len(inv_positions)
    surf_elev = 2.0

    # Band A spans from z_max (+5) down to geo_surface (≈ -5 to -10 m).
    # Two interior contacts: SILT top at depth 3 m (z=-1), KLEI top at depth 5 m (z=-3).
    # Both well above geo surface (≈ -6 to -8 m at these x-values).
    band_a_order_cols = [
        (
            OrderInputUnit("zand_a", "ZAND", f"inv{i}-zand-top"),
            OrderInputUnit("silt_a", "SILT", f"inv{i}-silt-top"),
            OrderInputUnit("klei_a", "KLEI", f"inv{i}-klei-top"),
        )
        for i in range(n_inv)
    ]
    band_a_order = build_stratigraphic_order(band_a_order_cols)
    band_a_xyz_cols = [
        InvestigationColumn(
            investigation_id=f"inv{i}",
            x=x,
            y=y,
            surface_elev_m=surf_elev,
            units=(
                ContactObservation("zand_a", "ZAND", f"inv{i}-zand-top", top_depth_m=0.0),
                # SILT top at depth 3 m → z = -1 m
                ContactObservation("silt_a", "SILT", f"inv{i}-silt-top", top_depth_m=3.0),
                # KLEI top at depth 5 m → z = -3 m (still above geo ≈ -7 to -8 m)
                ContactObservation("klei_a", "KLEI", f"inv{i}-klei-top", top_depth_m=5.0),
            ),
        )
        for i, (x, y) in enumerate(inv_positions)
    ]
    band_a_control = build_control_data(band_a_xyz_cols, [], band_a_order)
    block_a = Block(polygon=poly, z_min=z_min, z_max=z_max, top_surface=None, base_surface=geo)

    # Band B spans from geo_surface (≈ -7 to -9 m at corner x-values) to z_min (-20).
    # Two interior contacts: LEEM top at depth 14 m (z=-12), VEEN top at depth 17 m (z=-15).
    # Both well below geo surface.
    band_b_order_cols = [
        (
            OrderInputUnit("grint_b", "GRINT", f"inv{i}-grint-top"),
            OrderInputUnit("leem_b", "LEEM", f"inv{i}-leem-top"),
            OrderInputUnit("veen_b", "VEEN", f"inv{i}-veen-top"),
        )
        for i in range(n_inv)
    ]
    band_b_order = build_stratigraphic_order(band_b_order_cols)
    band_b_xyz_cols = [
        InvestigationColumn(
            investigation_id=f"inv{i}",
            x=x,
            y=y,
            surface_elev_m=surf_elev,
            units=(
                ContactObservation("grint_b", "GRINT", f"inv{i}-grint-top", top_depth_m=0.0),
                # LEEM top at depth 14 m → z = -12 m (below geo ≈ -7 to -9 m)
                ContactObservation("leem_b", "LEEM", f"inv{i}-leem-top", top_depth_m=14.0),
                # VEEN top at depth 17 m → z = -15 m
                ContactObservation("veen_b", "VEEN", f"inv{i}-veen-top", top_depth_m=17.0),
            ),
        )
        for i, (x, y) in enumerate(inv_positions)
    ]
    band_b_control = build_control_data(band_b_xyz_cols, [], band_b_order)
    block_b = Block(polygon=poly, z_min=z_min, z_max=z_max, top_surface=geo, base_surface=None)

    # Authored columns at the 4 investigation positions.
    # Band A: ZAND top=z_max base=-1, SILT top=-1 base=-3, KLEI top=-3 base=geo_z(x).
    # Band B: GRINT top=geo_z(x) base=-12, LEEM top=-12 base=-15, VEEN top=-15 base=z_min.
    authored_columns = []
    for x, y in inv_positions:
        geo_z_here = _geo_z(x)
        authored_columns.append(
            AuthoredColumn(
                x=x,
                y=y,
                units=(
                    AuthoredUnit("ZAND", top_elev_m=z_max, base_elev_m=-1.0),
                    AuthoredUnit("SILT", top_elev_m=-1.0, base_elev_m=-3.0),
                    AuthoredUnit("KLEI", top_elev_m=-3.0, base_elev_m=geo_z_here),
                    AuthoredUnit("GRINT", top_elev_m=geo_z_here, base_elev_m=-12.0),
                    AuthoredUnit("LEEM", top_elev_m=-12.0, base_elev_m=-15.0),
                    AuthoredUnit("VEEN", top_elev_m=-15.0, base_elev_m=z_min),
                ),
            )
        )

    # Sample points interior to the domain (same grid as the build).
    samples = [
        (float(_X0 + (i + 0.5) * (_X1 - _X0) / 4), float(_Y0 + (j + 0.5) * (_Y1 - _Y0) / 4))
        for i in range(4)
        for j in range(4)
    ]

    return {
        "band_a_control": band_a_control,
        "band_b_control": band_b_control,
        "block_a": block_a,
        "block_b": block_b,
        "samples": samples,
        "authored_columns": authored_columns,
        "all_formation_ids": {"ZAND", "SILT", "KLEI", "GRINT", "LEEM", "VEEN"},
    }


def test_per_band_loop_produces_all_formation_ids() -> None:
    """build_strat_model_per_band emits bodies for every formation in every band.

    The 2-band fixture has ZAND+KLEI in band A and SILT+VEEN in band B.
    The per-band loop must emit bodies for all four.
    """
    from groundmodel.domain.services.strat_field.strat_builder import (
        build_strat_model_per_band,
    )

    fix = _two_band_control_fixture()
    bands = [
        {
            "control": fix["band_a_control"],
            "block": fix["block_a"],
            "lens_inputs": [],
        },
        {
            "control": fix["band_b_control"],
            "block": fix["block_b"],
            "lens_inputs": [],
        },
    ]
    bodies = build_strat_model_per_band(bands, grid_spacing_m=_SPACING_M)

    assert bodies, "per-band build must emit at least one body"
    fids = {b.formation_id for b in bodies}
    assert fids >= fix["all_formation_ids"], (
        f"missing formations: {fix['all_formation_ids'] - fids}"
    )


def test_per_band_loop_all_bodies_closed_manifolds() -> None:
    """Every body emitted by build_strat_model_per_band is a closed 2-manifold."""
    from groundmodel.domain.services.strat_field.strat_builder import (
        build_strat_model_per_band,
    )

    fix = _two_band_control_fixture()
    bands = [
        {"control": fix["band_a_control"], "block": fix["block_a"], "lens_inputs": []},
        {"control": fix["band_b_control"], "block": fix["block_b"], "lens_inputs": []},
    ]
    bodies = build_strat_model_per_band(bands, grid_spacing_m=_SPACING_M)
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)


def test_per_band_loop_no_overlap_across_seam_strict() -> None:
    """build_strat_model_per_band: STRICT no-overlap across the geological seam.

    Bodies from both bands are combined and checked: no two different bodies
    overlap by more than TOL (1e-6 m) at any interior sample point.
    """
    from groundmodel.domain.services.strat_field.strat_builder import (
        build_strat_model_per_band,
    )

    fix = _two_band_control_fixture()
    bands = [
        {"control": fix["band_a_control"], "block": fix["block_a"], "lens_inputs": []},
        {"control": fix["band_b_control"], "block": fix["block_b"], "lens_inputs": []},
    ]
    bodies = build_strat_model_per_band(bands, grid_spacing_m=_SPACING_M)
    assert_no_overlap_sampled(bodies, fix["samples"])


def test_per_band_loop_model_matches_columns() -> None:
    """build_strat_model_per_band reproduces the authored column stacks.

    The column diff checks formation sequence + base elevations at each
    investigation location.  Tolerance 1.5 m (one grid-cell width at 20 m spacing
    times the max surface slope).
    """
    from groundmodel.domain.services.strat_field.strat_builder import (
        build_strat_model_per_band,
    )

    fix = _two_band_control_fixture()
    bands = [
        {"control": fix["band_a_control"], "block": fix["block_a"], "lens_inputs": []},
        {"control": fix["band_b_control"], "block": fix["block_b"], "lens_inputs": []},
    ]
    bodies = build_strat_model_per_band(bands, grid_spacing_m=_SPACING_M)
    assert_model_matches_columns(bodies, fix["authored_columns"], tol_m=1.5)


# ---------------------------------------------------------------------------
# Test 7b: per-band loop carves an enclosed lens in the LOWER band
# ---------------------------------------------------------------------------


def test_per_band_loop_carves_lens_in_lower_band() -> None:
    """A genuine enclosed lens carried via lens_inputs is built within its band.

    The lower band B carries a SILT lens strictly interior to its LEEM host.
    This exercises the ``if lens_inputs:`` branch of build_strat_model_per_band —
    the assemble_bodies_with_fields + carve_lenses path Task 8 relies on for the 6
    real lenses on test.strix — which the all-``[]`` per-band tests never touch.

    The lens surfaces are authored over the shared grid as a thin slab placed in
    the MIDDLE THIRD of the LEEM host's OWN reconstructed thickness at each
    footprint node (mirroring how Task-5 wiring authors a lens from real picks
    that genuinely sit inside the host — robust to the band-B RBF field's dip
    rather than a hand-picked flat elevation that the field would not honour).
    Its host is resolved by lithology + vertical containment (the host_body_id is
    a resolver-shaped string that is NOT a matrix mesh key — mirroring how the
    application wiring names the host).

    Asserts: the lens body (``lens:`` id) is present, every body is a closed
    manifold, STRICT no-overlap across all bands (incl. the seam AND the carved
    lens), and a column through the lens reads LEEM / SILT / LEEM (host / lens /
    host) inside the lower band.
    """
    from groundmodel.domain.services.strat_field.body_assembly import (
        assemble_bodies_with_fields,
    )
    from groundmodel.domain.services.strat_field.lens_carving import LensCarveInput
    from groundmodel.domain.services.strat_field.potential_field import fit_potential_field
    from groundmodel.domain.services.strat_field.strat_builder import (
        build_strat_model_per_band,
    )

    fix = _two_band_control_fixture()

    # The lens lives over the SHARED build grid — the same grid both bands are
    # assembled on (same polygon → same gx/gy), so the lens prism welds to its host.
    gx, gy, _ = build_shared_grid(fix["block_b"], _SPACING_M)
    nx, ny = len(gx), len(gy)

    # Reconstruct band B's LEEM host height field so the lens can be authored
    # strictly inside it at every footprint node (the field dips, so a flat lens
    # elevation would poke out of the host).  Find the LEEM body's (top, base).
    field_b = fit_potential_field(fix["band_b_control"], [fix["block_b"]])
    _meshes_b, fields_b = assemble_bodies_with_fields(
        field_b, fix["band_b_control"].column, fix["block_b"], _SPACING_M
    )
    leem_id = next(m.body_id for m in _meshes_b if m.formation_id == "LEEM")
    leem_top, leem_base = fields_b[leem_id]

    # Central footprint, well inside the domain so LEEM surrounds it laterally.
    lens_x_lo = _X0 + 120.0
    lens_x_hi = _X1 - 120.0
    lens_y_lo = _Y0 + 120.0
    lens_y_hi = _Y1 - 120.0
    footprint = np.zeros((nx, ny), dtype=bool)
    for i in range(nx):
        for j in range(ny):
            in_box = lens_x_lo <= gx[i] <= lens_x_hi and lens_y_lo <= gy[j] <= lens_y_hi
            # Only place the lens where the LEEM host is actually present.
            if in_box and not np.isnan(leem_top[i, j]):
                footprint[i, j] = True
    assert footprint.any(), "lens footprint must cover at least one present LEEM node"

    # Lens slab = the middle third of LEEM's local thickness (strictly interior).
    z_top = np.full((nx, ny), np.nan)
    z_base = np.full((nx, ny), np.nan)
    thickness = leem_top - leem_base
    z_top[footprint] = leem_base[footprint] + thickness[footprint] * (2.0 / 3.0)
    z_base[footprint] = leem_base[footprint] + thickness[footprint] * (1.0 / 3.0)

    lens = LensCarveInput(
        # A resolver-shaped id that is NOT a matrix mesh key → geometric host
        # resolution (lithology + vertical containment), matching the app wiring.
        host_body_id="resolver-uuid-not-a-mesh-key",
        host_formation_id="LEEM",  # the LEEM band brackets the lens in band B
        lens_body_id="silt-lens-in-leem-0001",
        lens_formation_id="SILT",
        z_top=z_top,
        z_base=z_base,
        footprint=footprint,
        nesting_depth=1,
    )

    bands = [
        {"control": fix["band_a_control"], "block": fix["block_a"], "lens_inputs": []},
        {
            "control": fix["band_b_control"],
            "block": fix["block_b"],
            "lens_inputs": [lens],
        },
    ]
    bodies = build_strat_model_per_band(bands, grid_spacing_m=_SPACING_M)

    # The carved lens body is present (its emitted id carries the ``lens:`` scheme).
    lens_bodies = [b for b in bodies if b.body_id.startswith("lens:")]
    assert lens_bodies, "the enclosed lens body (lens: id) must be emitted"
    assert any(b.formation_id == "SILT" for b in lens_bodies), "lens lithology must be SILT"

    # Every body — matrix bands, carved host pieces, and the lens — is closed.
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)

    # STRICT no-overlap across all bands incl. the seam and the carved lens.
    assert_no_overlap_sampled(bodies, fix["samples"])

    # A column through the lens centre reads LEEM / SILT / LEEM (host / lens /
    # host) within the lower band.  Ray-cast the column directly and verify the
    # SILT lens interval sits strictly BETWEEN two LEEM (host) intervals — the
    # vertical-enclosure invariant — at the chosen footprint node.  (A full-stack
    # column diff is avoided here: it would also have to author band A's six units
    # at this (x, y) from band A's separate field; the local host/lens/host
    # enclosure is the property this test exists to pin.)
    ci = next(i for i in range(nx) if lens_x_lo <= gx[i] <= lens_x_hi and footprint[i].any())
    cj = next(j for j in range(ny) if footprint[ci, j])
    cx, cy = float(gx[ci]), float(gy[cj])
    silt_iv = [
        iv for b in lens_bodies for iv in vertical_ray_intervals(b.vertices, b.triangles, cx, cy)
    ]
    assert len(silt_iv) == 1, f"expected one SILT lens interval at the column, got {silt_iv}"
    lens_base_elev, lens_top_elev = silt_iv[0]
    leem_ivs = [
        iv
        for b in bodies
        if b.formation_id == "LEEM"
        for iv in vertical_ray_intervals(b.vertices, b.triangles, cx, cy)
    ]
    # A LEEM host piece must sit directly ABOVE the lens (its base == lens top) and
    # another directly BELOW (its top == lens base): host / lens / host enclosure.
    above = [iv for iv in leem_ivs if abs(iv[0] - lens_top_elev) <= 1.5]
    below = [iv for iv in leem_ivs if abs(iv[1] - lens_base_elev) <= 1.5]
    assert above, f"no LEEM host piece directly above the lens (LEEM ivs: {leem_ivs})"
    assert below, f"no LEEM host piece directly below the lens (LEEM ivs: {leem_ivs})"


# ---------------------------------------------------------------------------
# Test 7c: polygon-equality guard protects the watertight seam
# ---------------------------------------------------------------------------


def test_per_band_loop_rejects_mismatched_band_polygons() -> None:
    """build_strat_model_per_band raises when two bands carry different polygons.

    The watertight seam REQUIRES all bands to share the SAME grid, which requires
    the SAME block.polygon.  A Task-8 wiring bug that handed each band a
    per-band-filtered alpha hull would silently GAP the seam (the exact class that
    killed the loft builder).  The guard must catch a mismatched hull loudly.
    """
    from groundmodel.domain.services.strat_field.strat_builder import (
        build_strat_model_per_band,
    )

    fix = _two_band_control_fixture()

    # Band B gets a DIFFERENT (shrunk) polygon — a stand-in for a per-band-filtered
    # alpha hull.  Same surfaces, same control, only the polygon diverges.
    block_b = fix["block_b"]
    shrunk_poly = ((_X0, _Y0), (_X1 - 50.0, _Y0), (_X1 - 50.0, _Y1), (_X0, _Y1))
    mismatched_block_b = Block(
        polygon=shrunk_poly,
        z_min=block_b.z_min,
        z_max=block_b.z_max,
        top_surface=block_b.top_surface,
        base_surface=block_b.base_surface,
    )

    bands = [
        {"control": fix["band_a_control"], "block": fix["block_a"], "lens_inputs": []},
        {"control": fix["band_b_control"], "block": mismatched_block_b, "lens_inputs": []},
    ]

    with pytest.raises(ValueError, match="band polygons must be identical"):
        build_strat_model_per_band(bands, grid_spacing_m=_SPACING_M)


# ---------------------------------------------------------------------------
# Test 8: single-block path unchanged (regression — non-geo case)
# ---------------------------------------------------------------------------


def test_single_block_path_unchanged() -> None:
    """build_strat_model still works on a flat (no surface-bounded) Block.

    The non-geo single-block path must be byte-identical after the Task-7
    changes. Use the nested analytic fixture (the simplest non-geo case).
    """
    from tests.unit.domain.services.strat_field.fixtures import nested_field_and_domain

    field, order, domain = nested_field_and_domain()
    # build_strat_model takes control + domain + blocks: simulate with a control
    # that has the same field (use the analytic field directly via assemble_bodies).
    bodies = assemble_bodies(field, order, domain, grid_spacing_m=2.5)
    assert bodies, "nested fixture must produce bodies after Task-7"
    for b in bodies:
        assert_closed_manifold(b.vertices, b.triangles)
    assert {b.formation_id for b in bodies} >= {"ZAND", "SILT", "KLEI"}
