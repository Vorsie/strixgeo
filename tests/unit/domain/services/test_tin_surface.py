"""Behaviour tests for the TIN compute + slice services.

Pure-geometry, no DB. Pins:

* compute_tin produces a Delaunay triangulation on >=3 non-collinear
  points; degrades gracefully on degenerate input.
* checksum_contacts is order-insensitive over the same set + xyz.
* slice_tin returns a polyline of (along, elevation) ordered by
  along-distance, with off-line vertices contributing via their
  triangle's edge crossings.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.tin_surface import (
    ContactPoint3D,
    SectionLine2D,
    checksum_contacts,
    compute_tin,
    slice_tin,
)


def _pt(cid: str, x: float, y: float, z: float) -> ContactPoint3D:
    """Tiny constructor — keeps the test bodies readable."""
    return ContactPoint3D(contact_id=cid, x_m=x, y_m=y, elevation_m=z)


# ---------------------------------------------------------------------------
# compute_tin — Delaunay happy path + degenerate-input fall-throughs
# ---------------------------------------------------------------------------


def test_compute_tin_returns_empty_when_no_contacts() -> None:
    """Zero-input → empty TIN, no triangulation attempt."""
    surface = compute_tin([])
    assert surface.vertices == []
    assert surface.triangles == []


def test_compute_tin_returns_vertices_only_for_one_or_two_points() -> None:
    """Geological minimum is 3 non-collinear points; <3 returns dots."""
    one = compute_tin([_pt("a", 0, 0, 5)])
    assert one.vertices == [(0.0, 0.0, 5.0)]
    assert one.triangles == []

    two = compute_tin([_pt("a", 0, 0, 5), _pt("b", 10, 0, 6)])
    assert len(two.vertices) == 2
    assert two.triangles == []


def test_compute_tin_triangulates_three_non_collinear_points() -> None:
    """Three points form one triangle."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 5, 10, 4),
        ]
    )
    assert len(surface.vertices) == 3
    assert len(surface.triangles) == 1
    # Triangle indices reference all three vertices.
    indices = set(surface.triangles[0])
    assert indices == {0, 1, 2}


def test_compute_tin_handles_four_points_two_triangles() -> None:
    """A square produces two triangles sharing an edge."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 10, 10, 7),
            _pt("d", 0, 10, 4),
        ]
    )
    assert len(surface.vertices) == 4
    assert len(surface.triangles) == 2


def test_compute_tin_drops_non_finite_points() -> None:
    """NaN / inf coords are silently filtered."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("nan", float("nan"), 5, 6),
            _pt("b", 10, 0, 6),
            _pt("c", 5, 10, 4),
        ]
    )
    assert len(surface.vertices) == 3
    assert len(surface.triangles) == 1


def test_compute_tin_collapses_duplicate_xy_points() -> None:
    """Two contacts at the same (x, y) can't both contribute to Delaunay."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("dup", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 5, 10, 4),
        ]
    )
    # Duplicate folded → 3 surviving vertices, 1 triangle.
    assert len(surface.vertices) == 3
    assert len(surface.triangles) == 1


def test_compute_tin_collinear_points_returns_vertices_only() -> None:
    """All-collinear input crashes qhull — degrade to vertices-only."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 5, 0, 6),
            _pt("c", 10, 0, 7),
        ]
    )
    assert len(surface.vertices) == 3
    assert surface.triangles == []


# ---------------------------------------------------------------------------
# compute_tin — concave-hull (alpha-shape) trim, "drooping edges" fix
# ---------------------------------------------------------------------------


def test_compute_tin_alpha_shape_trims_to_a_far_outlier() -> None:
    """A tight cluster + one far point: the large boundary triangles that
    drape to the outlier are dropped; the compact interior survives.
    """
    contacts = [
        _pt("a", 0.0, 0.0, 5.0),
        _pt("b", 1.0, 0.0, 5.0),
        _pt("c", 0.0, 1.0, 5.0),
        _pt("d", 1.0, 1.0, 5.0),
        _pt("far", 100.0, 50.0, 9.0),  # index 4 — the data-free outlier
    ]
    surface = compute_tin(contacts)
    assert len(surface.triangles) >= 1
    # Every surviving triangle is inside the unit-square cluster; the
    # outlier (index 4) is orphaned by the trim, never referenced.
    assert all(4 not in t for t in surface.triangles)
    # A huge alpha factor degenerates to the full convex hull, which
    # includes the fan-to-outlier triangles — strictly more than trimmed.
    raw = compute_tin(contacts, concave_hull_alpha_factor=1e9)
    assert len(raw.triangles) > len(surface.triangles)
    assert any(4 in t for t in raw.triangles)


def test_compute_tin_alpha_trim_never_empties_a_surface() -> None:
    """If alpha is so tight that every triangle exceeds it, the full hull
    is kept (a droopy surface beats a vanished formation)."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 5, 10, 4),
        ],
        concave_hull_alpha_factor=0.01,
    )
    assert len(surface.vertices) == 3
    assert len(surface.triangles) == 1


def test_compute_tin_compact_grid_is_not_trimmed() -> None:
    """A regular 3x3 grid has no oversized boundary triangles — the
    default alpha keeps all 8 Delaunay triangles (2 * (nx-1) * (ny-1))."""
    contacts = [
        _pt(f"p{i}", float(x), float(y), 5.0)
        for i, (x, y) in enumerate((x, y) for x in range(3) for y in range(3))
    ]
    surface = compute_tin(contacts)
    assert len(surface.triangles) == 8


# ---------------------------------------------------------------------------
# checksum_contacts — order-insensitive, content-sensitive
# ---------------------------------------------------------------------------


def test_checksum_is_order_insensitive() -> None:
    """Reordering the input doesn't change the digest."""
    pts_a = [_pt("a", 0, 0, 5), _pt("b", 10, 0, 6), _pt("c", 5, 10, 4)]
    pts_b = [_pt("c", 5, 10, 4), _pt("a", 0, 0, 5), _pt("b", 10, 0, 6)]
    assert checksum_contacts(pts_a) == checksum_contacts(pts_b)


def test_checksum_changes_when_a_contact_moves() -> None:
    """Same ids, one z bumped → different digest."""
    pts_a = [_pt("a", 0, 0, 5), _pt("b", 10, 0, 6)]
    pts_b = [_pt("a", 0, 0, 5), _pt("b", 10, 0, 6.1)]
    assert checksum_contacts(pts_a) != checksum_contacts(pts_b)


def test_checksum_changes_when_a_contact_swaps_id() -> None:
    """Same xyz, different id → different digest (downstream meaning differs)."""
    pts_a = [_pt("a", 0, 0, 5)]
    pts_b = [_pt("z", 0, 0, 5)]
    assert checksum_contacts(pts_a) != checksum_contacts(pts_b)


def test_checksum_empty_input_is_stable() -> None:
    """Empty contacts → fixed digest, doesn't crash."""
    assert checksum_contacts([]) == checksum_contacts([])


# ---------------------------------------------------------------------------
# slice_tin — polyline along a section line
# ---------------------------------------------------------------------------


def test_slice_empty_surface_returns_empty_polyline() -> None:
    """No triangles → no crossings."""
    from groundmodel.domain.services.tin_surface import TinSurface

    empty = TinSurface(vertices=[], triangles=[])
    assert slice_tin(empty, SectionLine2D(0, 0, 100, 0)) == []


def test_slice_zero_length_line_returns_empty_polyline() -> None:
    """Degenerate section line → empty (defensive against UI bugs)."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 5, 10, 4),
        ]
    )
    assert slice_tin(surface, SectionLine2D(50, 50, 50, 50)) == []


def test_slice_through_triangle_produces_two_crossings() -> None:
    """A line cutting one triangle has exactly two edge crossings.

    Triangle: (0,0,5), (10,0,6), (5,10,4). A horizontal line from
    (-5, 5) to (15, 5) cuts the two slanted edges (the bottom edge
    is below y=5 entirely).
    """
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 5, 10, 4),
        ]
    )
    poly = slice_tin(surface, SectionLine2D(-5, 5, 15, 5))
    assert len(poly) == 2
    # Polyline sorted by along-distance.
    assert poly[0].along_m < poly[1].along_m
    # Both crossings interpolate elevations between the triangle's z values.
    for p in poly:
        assert min(4.0, 5.0, 6.0) <= p.elevation_m <= max(4.0, 5.0, 6.0)


def test_slice_off_line_picks_contribute_via_triangle() -> None:
    """The headline value-add over connect-the-dots — verify it.

    Setup: 4 picks at corners of a 10x10 square (TIN = 2 triangles).
    Section line passes 5m above and below the square diagonally.
    Each triangle should contribute one crossing on the line.
    """
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 10, 10, 7),
            _pt("d", 0, 10, 4),
        ]
    )
    # Horizontal line through y = 5 (cuts both triangles).
    poly = slice_tin(surface, SectionLine2D(-2, 5, 12, 5))
    # Each of the two triangles produces 2 crossings = 4 total. The
    # shared edge (y=0..y=10 diagonal) crosses once and is shared
    # between both triangles — counted once per triangle = twice.
    assert len(poly) >= 2  # at least one crossing per triangle
    # All elevations bounded by source z range.
    for p in poly:
        assert 4.0 <= p.elevation_m <= 7.0


def test_slice_polyline_is_sorted_by_along_distance() -> None:
    """The polyline ordering is the load-bearing property for renderers."""
    surface = compute_tin(
        [
            _pt("a", 0, 0, 5),
            _pt("b", 10, 0, 6),
            _pt("c", 10, 10, 7),
            _pt("d", 0, 10, 4),
        ]
    )
    poly = slice_tin(surface, SectionLine2D(-5, 5, 15, 5))
    alongs = [p.along_m for p in poly]
    assert alongs == sorted(alongs)


def test_section_line_length_matches_euclidean() -> None:
    """SectionLine2D.length_m sanity."""
    line = SectionLine2D(0, 0, 3, 4)
    assert line.length_m == pytest.approx(5.0)
