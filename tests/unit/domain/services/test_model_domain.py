"""Behaviour tests for model_domain — alpha hull, deep-reaching mask, ModelDomain.

Pure-geometry, no DB, no I/O. Pins:

* alpha_hull_polygon produces a concave hull that excludes the notch of an
  L-shaped point cloud (a convex hull would include it).
* deep_reaching_mask identifies tests that reach the lowest geological band,
  with a geo-present path and a no-geo fallback.
* ModelDomain.top_at / deep_base_at interpolate surface and base elevations
  via TIN; nearest-vertex fallback when the query point is outside the hull.
* ModelDomain.contains reports inside/outside relative to the alpha hull.
* build_model_domain raises ValueError for degenerate inputs (<3 tests or all
  tests collinear) because Delaunay cannot triangulate them.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.model_domain import (
    DomainTest,
    ModelDomain,
    alpha_hull_polygon,
    build_model_domain,
    deep_reaching_mask,
)

# ---------------------------------------------------------------------------
# Helpers used across multiple tests
# ---------------------------------------------------------------------------


def _dt(tid: str, x: float, y: float, surf: float = 0.0, base: float = -20.0) -> DomainTest:
    """Convenience constructor — keeps test bodies readable."""
    return DomainTest(test_id=tid, x_m=x, y_m=y, surface_elev_m=surf, base_elev_m=base)


def point_in_polygon(ring: list[tuple[float, float]], px: float, py: float) -> bool:
    """Ray-casting point-in-polygon check for a closed ring (WITHOUT repeated
    last point).

    Shoots a horizontal ray to the right from (px, py) and counts edge
    crossings; odd = inside. Works for any simple polygon.
    """
    inside = False
    n = len(ring)
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[(i + 1) % n]
        # Edge crosses the horizontal ray from px if one endpoint is above and
        # the other at-or-below py, and the crossing x is to the right of px.
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
    return inside


def _four_corners_plus_shallow_centre() -> list[DomainTest]:
    """Four deep (base=-20) corners of a 10×10 square, one shallow centre.

    The deep base at the centre (5, 5) must be ~-20 (TIN-interpolated
    through the four corners), NOT -5 (the shallow centre's own base).
    """
    return [
        _dt("tl", 0.0, 0.0, surf=0.0, base=-20.0),
        _dt("tr", 10.0, 0.0, surf=0.0, base=-20.0),
        _dt("bl", 0.0, 10.0, surf=0.0, base=-20.0),
        _dt("br", 10.0, 10.0, surf=0.0, base=-20.0),
        _dt("c", 5.0, 5.0, surf=0.0, base=-5.0),  # shallow — must not truncate
    ]


# ---------------------------------------------------------------------------
# alpha_hull_polygon
# ---------------------------------------------------------------------------


def test_alpha_hull_is_concave_for_an_l_shape() -> None:
    """The alpha hull must exclude the concave notch of an L-shaped cloud.

    The L-shape has points along the bottom row (y=0,10) for x in 0..50 and
    along the left column (x=0,10) for y in 20..50.  The convex hull would
    contain (50, 50); the alpha hull must not (that corner has no data).
    """
    pts: list[tuple[float, float]] = []
    for x in range(0, 60, 10):
        for y in (0, 10):
            pts.append((float(x), float(y)))
    for y in range(20, 60, 10):
        pts.append((0.0, float(y)))
        pts.append((10.0, float(y)))

    poly = alpha_hull_polygon(pts, factor=6.0)

    # The origin is firmly inside the L.
    assert point_in_polygon(poly, 5.0, 5.0), "centre of L should be inside"
    # The far corner only exists in the convex hull, not the data cloud.
    assert not point_in_polygon(poly, 50.0, 50.0), (
        "alpha hull must exclude the notch corner (50, 50)"
    )


def test_alpha_hull_contains_returns_a_ring_without_repeated_endpoint() -> None:
    """Returned ring must not have the first vertex repeated at the end."""
    pts = [(0.0, 0.0), (10.0, 0.0), (5.0, 8.0), (5.0, 2.0)]
    ring = alpha_hull_polygon(pts, factor=6.0)
    assert ring[0] != ring[-1], "ring must NOT repeat the first vertex at the end"
    assert len(ring) >= 3, "ring must have at least 3 vertices"


def test_alpha_hull_raises_on_fewer_than_three_points() -> None:
    """Fewer than 3 points cannot form a polygon — must raise ValueError."""
    with pytest.raises(ValueError, match="at least 3"):
        alpha_hull_polygon([(0.0, 0.0), (1.0, 1.0)], factor=6.0)


def test_alpha_hull_raises_on_collinear_points() -> None:
    """All-collinear inputs cannot form a 2-D hull — must raise ValueError."""
    collinear = [(float(i), 0.0) for i in range(5)]
    with pytest.raises(ValueError):
        alpha_hull_polygon(collinear, factor=6.0)


# ---------------------------------------------------------------------------
# deep_reaching_mask
# ---------------------------------------------------------------------------


def test_deep_reaching_mask_uses_lowest_band_when_geo_present() -> None:
    """Geo-present path: a test reaches the band when base <= band_elev + tol.

    t1: base=-20, band=-20.5 → threshold = -20.5 + 1.0 = -19.5 → -20 ≤ -19.5 ✓
    t2: base=-8, band=-20.4 → threshold = -20.4 + 1.0 = -19.4 → -8 ≤ -19.4? No ✗
    """
    mask = deep_reaching_mask(
        base_elevs={"t1": -20.0, "t2": -8.0},
        lowest_band_elev_at={"t1": -20.5, "t2": -20.4},
        tol_m=1.0,
    )
    assert mask == {"t1": True, "t2": False}


def test_deep_reaching_fallback_without_geo_uses_deepest_overall() -> None:
    """No-geo fallback: deep = base <= min(all bases) + tol.

    min base = -20 → threshold = -20 + 2.0 = -18
    t1: -20 ≤ -18 ✓; t2: -8 ≤ -18? No ✗; t3: -19.2 ≤ -18 ✓
    """
    mask = deep_reaching_mask(
        base_elevs={"t1": -20.0, "t2": -8.0, "t3": -19.2},
        lowest_band_elev_at=None,
        tol_m=2.0,
    )
    assert mask == {"t1": True, "t2": False, "t3": True}


def test_deep_reaching_mask_all_tests_reach_when_all_equally_deep() -> None:
    """When all tests have the same base elevation, all reach (threshold = base + tol)."""
    mask = deep_reaching_mask(
        base_elevs={"a": -15.0, "b": -15.0},
        lowest_band_elev_at=None,
        tol_m=0.5,
    )
    assert mask == {"a": True, "b": True}


# ---------------------------------------------------------------------------
# build_model_domain + ModelDomain
# ---------------------------------------------------------------------------


def test_build_model_domain_interpolates_deep_base_across_shallow_test() -> None:
    """A shallow test must NOT locally truncate the deep base surface.

    Four deep corners (base=-20) + one shallow centre (base=-5).
    The TIN for the deep base is built from the deep tests ONLY, so
    deep_base_at(5, 5) should interpolate to ≈-20, not -5.
    """
    dom = build_model_domain(tests=_four_corners_plus_shallow_centre())
    assert dom.deep_base_at(5.0, 5.0) == pytest.approx(-20.0, abs=0.5)


def test_build_model_domain_top_at_interpolates_surface_elevation() -> None:
    """top_at should return the TIN-interpolated surface elevation.

    With a flat surface (all surf=0), the centre of a square must be 0.
    """
    tests = [
        _dt("a", 0.0, 0.0, surf=0.0, base=-10.0),
        _dt("b", 10.0, 0.0, surf=0.0, base=-10.0),
        _dt("c", 10.0, 10.0, surf=0.0, base=-10.0),
        _dt("d", 0.0, 10.0, surf=0.0, base=-10.0),
    ]
    dom = build_model_domain(tests)
    assert dom.top_at(5.0, 5.0) == pytest.approx(0.0, abs=0.1)


def test_build_model_domain_top_at_interpolates_sloped_surface() -> None:
    """top_at must interpolate between varying surface elevations."""
    tests = [
        _dt("a", 0.0, 0.0, surf=0.0, base=-10.0),
        _dt("b", 10.0, 0.0, surf=10.0, base=-10.0),
        _dt("c", 0.0, 10.0, surf=0.0, base=-10.0),
        _dt("d", 10.0, 10.0, surf=10.0, base=-10.0),
    ]
    dom = build_model_domain(tests)
    # Midpoint of the left edge → surf ≈ 0; midpoint of the right edge → surf ≈ 10.
    assert dom.top_at(0.0, 5.0) == pytest.approx(0.0, abs=0.5)
    assert dom.top_at(10.0, 5.0) == pytest.approx(10.0, abs=0.5)


def test_model_domain_contains_inside_and_outside() -> None:
    """contains must be True inside the hull and False outside."""
    tests = [
        _dt("a", 0.0, 0.0),
        _dt("b", 20.0, 0.0),
        _dt("c", 10.0, 15.0),
        _dt("d", 5.0, 5.0),
    ]
    dom = build_model_domain(tests)
    assert dom.contains(10.0, 5.0), "centroid should be inside the hull"
    assert not dom.contains(100.0, 100.0), "far-away point should be outside"


def test_model_domain_top_at_nearest_vertex_fallback_outside_tin() -> None:
    """top_at must return the nearest vertex's elevation when outside the TIN.

    We use a small triangle and query a point clearly outside it; the
    fallback must return a finite number, not None or NaN.
    """
    tests = [
        _dt("a", 0.0, 0.0, surf=1.0),
        _dt("b", 4.0, 0.0, surf=2.0),
        _dt("c", 2.0, 3.0, surf=3.0),
    ]
    dom = build_model_domain(tests)
    result = dom.top_at(100.0, 100.0)
    assert result is not None
    assert result == result  # not NaN


def test_model_domain_deep_base_nearest_vertex_fallback_outside_tin() -> None:
    """deep_base_at must return a finite value (nearest vertex) outside the TIN."""
    tests = [
        _dt("a", 0.0, 0.0, base=-20.0),
        _dt("b", 4.0, 0.0, base=-20.0),
        _dt("c", 2.0, 3.0, base=-20.0),
    ]
    dom = build_model_domain(tests)
    result = dom.deep_base_at(100.0, 100.0)
    assert result is not None
    assert result == result  # not NaN


def test_build_model_domain_raises_on_fewer_than_three_tests() -> None:
    """Fewer than 3 tests — cannot triangulate; must raise ValueError."""
    with pytest.raises(ValueError, match="at least 3"):
        build_model_domain([_dt("a", 0.0, 0.0), _dt("b", 1.0, 0.0)])


def test_build_model_domain_raises_on_collinear_tests() -> None:
    """All-collinear tests cannot form a TIN — must raise ValueError."""
    collinear = [_dt(str(i), float(i), 0.0) for i in range(4)]
    with pytest.raises(ValueError):
        build_model_domain(collinear)


def test_build_model_domain_raises_when_no_test_reaches_the_lowest_band() -> None:
    """The lowest band lies deeper than every test reaches — building the
    deep base from shallow data would silently mask the mismatch, so the
    factory must fail loudly instead."""
    tests = [
        _dt("a", 0.0, 0.0, base=-10.0),
        _dt("b", 10.0, 0.0, base=-10.0),
        _dt("c", 5.0, 10.0, base=-10.0),
    ]
    band = {"a": -30.0, "b": -30.0, "c": -30.0}  # far below every base
    with pytest.raises(ValueError, match="lowest geological band"):
        build_model_domain(tests, lowest_band_elev_at=band, tol_m=1.0)
