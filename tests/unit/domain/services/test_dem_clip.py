"""Unit tests for the DEM clip domain service.

Tests:
* ``clip_tin_to_dem`` — happy path (vertex below DEM), clamped vertex,
  contact_above_dem issue, dem_cell_low_confidence issue, 5 cm threshold.
* ``build_ground_surface_tin`` — happy path, all-NoData fallback, empty hull.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.dem_clip import (
    KIND_CONTACT_ABOVE_DEM,
    KIND_DEM_CELL_LOW_CONFIDENCE,
    GroundPoint,
    assess_ground_coverage,
    build_ground_surface_tin,
    clip_tin_to_dem,
)
from groundmodel.domain.services.tin_surface import TinSurface

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _constant_dem(z: float | None):
    """Return a DEM sampler that always returns ``z``."""

    def sample(x: float, y: float) -> float | None:
        return z

    return sample


def _flat_surface_at(*zs: float) -> TinSurface:
    """Build a TinSurface with one vertex per z value at fixed (x, y) positions."""
    vertices = [(float(i) * 10.0, 0.0, z) for i, z in enumerate(zs)]
    # Provide triangles only when there are at least 3 vertices.
    triangles = [(0, 1, 2)] if len(vertices) >= 3 else []
    return TinSurface(vertices=vertices, triangles=triangles)


# ---------------------------------------------------------------------------
# clip_tin_to_dem — happy path
# ---------------------------------------------------------------------------


def test_clip_no_change_when_vertex_below_dem() -> None:
    """A vertex that is already below the DEM is returned unchanged."""
    surface = _flat_surface_at(5.0)
    result = clip_tin_to_dem(surface, _constant_dem(10.0))
    assert result.clamp_count == 0
    assert result.issues == []
    assert result.surface.vertices == [(0.0, 0.0, 5.0)]


def test_clip_clamps_vertex_above_dem() -> None:
    """A vertex above the DEM is lowered to the DEM elevation."""
    surface = _flat_surface_at(15.0)
    result = clip_tin_to_dem(surface, _constant_dem(10.0))
    assert result.clamp_count == 1
    assert result.surface.vertices == [(0.0, 0.0, 10.0)]


def test_clip_returns_contact_above_dem_issue_when_overshoot_exceeds_5cm() -> None:
    """An overshoot > 5 cm emits a contact_above_dem issue."""
    surface = _flat_surface_at(10.10)  # 10 cm above DEM
    result = clip_tin_to_dem(surface, _constant_dem(10.0), formation_name="Boom Klei")
    assert len(result.issues) == 1
    assert result.issues[0].kind == KIND_CONTACT_ABOVE_DEM
    assert "Boom Klei" in result.issues[0].detail
    assert result.clamp_count == 1


def test_clip_no_issue_when_overshoot_within_5cm_threshold() -> None:
    """An overshoot ≤ 5 cm is clamped but does NOT emit an issue."""
    surface = _flat_surface_at(10.04)  # 4 cm above DEM — within threshold
    result = clip_tin_to_dem(surface, _constant_dem(10.0))
    assert result.clamp_count == 1
    assert result.issues == []


def test_clip_emits_dem_cell_low_confidence_for_nodata() -> None:
    """A NoData DEM cell emits a dem_cell_low_confidence issue and leaves z unchanged."""
    surface = _flat_surface_at(5.0)
    result = clip_tin_to_dem(surface, _constant_dem(None))
    assert result.clamp_count == 0
    assert len(result.issues) == 1
    assert result.issues[0].kind == KIND_DEM_CELL_LOW_CONFIDENCE
    # z is left unchanged when DEM has no data for the cell.
    assert result.surface.vertices[0][2] == pytest.approx(5.0)


def test_clip_preserves_triangle_indices() -> None:
    """Triangles are not mutated — only z values change."""
    surface = _flat_surface_at(10.0, 5.0, 8.0)
    result = clip_tin_to_dem(surface, _constant_dem(7.0))
    assert result.surface.triangles == surface.triangles


def test_clip_empty_surface_returns_unchanged() -> None:
    """An empty TIN (no vertices) passes through without error."""
    empty = TinSurface(vertices=[], triangles=[])
    result = clip_tin_to_dem(empty, _constant_dem(10.0))
    assert result.clamp_count == 0
    assert result.issues == []
    assert result.surface.vertices == []


def test_clip_multiple_vertices_mixed_outcome() -> None:
    """Each vertex is evaluated independently — mixed outcomes are correct."""
    # Three vertices: below DEM, above DEM (big), NoData
    dem_values = {0.0: 10.0, 10.0: 10.0, 20.0: None}

    def mixed_dem(x: float, y: float) -> float | None:
        return dem_values.get(x)

    surface = TinSurface(
        vertices=[(0.0, 0.0, 8.0), (10.0, 0.0, 12.0), (20.0, 0.0, 6.0)],
        triangles=[(0, 1, 2)],
    )
    result = clip_tin_to_dem(surface, mixed_dem)

    # Vertex 0 unchanged (below DEM).
    assert result.surface.vertices[0][2] == pytest.approx(8.0)
    # Vertex 1 clamped to 10.0.
    assert result.surface.vertices[1][2] == pytest.approx(10.0)
    # Vertex 2 unchanged (NoData).
    assert result.surface.vertices[2][2] == pytest.approx(6.0)

    assert result.clamp_count == 1
    kinds = [i.kind for i in result.issues]
    assert KIND_CONTACT_ABOVE_DEM in kinds
    assert KIND_DEM_CELL_LOW_CONFIDENCE in kinds


# ---------------------------------------------------------------------------
# build_ground_surface_tin
# ---------------------------------------------------------------------------


def test_build_ground_surface_tin_empty_hull_returns_empty() -> None:
    """An empty hull list returns an empty TIN without error."""
    tin = build_ground_surface_tin(_constant_dem(10.0), [], grid_spacing_m=10.0)
    assert tin.vertices == []
    assert tin.triangles == []


def test_build_ground_surface_tin_all_nodata_returns_empty_tin() -> None:
    """When the DEM returns None for every sample, no triangles are produced."""
    # Hull spans a 30 m × 30 m area; DEM is all NoData.
    hull = [(0.0, 0.0), (30.0, 0.0), (0.0, 30.0), (30.0, 30.0)]
    tin = build_ground_surface_tin(_constant_dem(None), hull, grid_spacing_m=15.0)
    # No valid DEM samples → no vertices → no triangles.
    assert tin.vertices == []
    assert tin.triangles == []


def test_build_ground_surface_tin_happy_path_produces_triangles() -> None:
    """A flat DEM over a 30 m hull at 10 m spacing produces a non-empty TIN."""
    hull = [(0.0, 0.0), (30.0, 0.0), (0.0, 30.0), (30.0, 30.0)]
    tin = build_ground_surface_tin(_constant_dem(5.0), hull, grid_spacing_m=10.0)
    # Grid spans [-10, 40] × [-10, 40] at 10 m spacing → 6 × 6 = 36 samples.
    assert len(tin.vertices) > 0
    assert len(tin.triangles) > 0
    # All vertices should carry the constant DEM elevation.
    for _x, _y, z in tin.vertices:
        assert z == pytest.approx(5.0)


def test_build_ground_surface_tin_vertex_positions_cover_hull(  # noqa: N802
) -> None:
    """Grid nodes extend beyond the hull by one grid step in each direction."""
    hull = [(10.0, 10.0), (20.0, 10.0), (10.0, 20.0), (20.0, 20.0)]
    tin = build_ground_surface_tin(_constant_dem(0.0), hull, grid_spacing_m=5.0)
    xs = [v[0] for v in tin.vertices]
    ys = [v[1] for v in tin.vertices]
    # The padding adds one grid step (5 m) on each side.
    assert min(xs) <= 10.0 - 5.0 + 1e-6
    assert max(xs) >= 20.0 + 5.0 - 1e-6
    assert min(ys) <= 10.0 - 5.0 + 1e-6
    assert max(ys) >= 20.0 + 5.0 - 1e-6


# ---------------------------------------------------------------------------
# G7 — the ground surface is a REFERENCE the user reads a distance against.
#
# Two behavioural rules, in the owner's terms:
#   * The ground must keep going past the outermost test, so it reads as
#     ground rather than as a slab that stops at the last borehole.
#   * The ground drawn directly above a test must be the DEM at THAT test,
#     because that is where the user reads the daylight between the terrain
#     and the interpreted model top.
# ---------------------------------------------------------------------------


def test_ground_extends_past_the_outermost_test_by_the_requested_margin() -> None:
    """The terrain keeps going past the last investigation, by the margin asked for."""
    hull = [(100.0, 100.0), (140.0, 100.0), (100.0, 140.0), (140.0, 140.0)]
    tin = build_ground_surface_tin(
        _constant_dem(3.0),
        hull,
        grid_spacing_m=10.0,
        margin_m=50.0,
    )
    xs = [v[0] for v in tin.vertices]
    ys = [v[1] for v in tin.vertices]
    # 50 m of ground beyond the outermost test on every side.
    assert min(xs) <= 100.0 - 50.0 + 1e-6
    assert max(xs) >= 140.0 + 50.0 - 1e-6
    assert min(ys) <= 100.0 - 50.0 + 1e-6
    assert max(ys) >= 140.0 + 50.0 - 1e-6


def test_the_ground_above_a_test_is_the_dem_at_that_test_not_a_grid_neighbour() -> None:
    """A test standing in a dip gets the dip's elevation, not the surrounding flat.

    The sample grid is coarse (10 m) and the test sits off-node at
    (105, 103), so no grid node lands in the 1.5 m dip. Without an anchor
    vertex at the test itself the rendered ground above the column is the
    surrounding 12.0 m plane and the daylight the user reads is wrong by
    the depth of the dip.
    """

    def dem_with_a_dip(x: float, y: float) -> float | None:
        in_dip = abs(x - 105.0) <= 1.5 and abs(y - 103.0) <= 1.5
        return 11.0 if in_dip else 12.0

    hull = [(105.0, 103.0), (140.0, 100.0), (100.0, 140.0)]
    tin = build_ground_surface_tin(
        dem_with_a_dip,
        hull,
        grid_spacing_m=10.0,
        margin_m=10.0,
    )

    at_the_test = [v for v in tin.vertices if v[0] == 105.0 and v[1] == 103.0]
    assert at_the_test, "the ground surface carries no vertex above the test"
    assert at_the_test[0][2] == pytest.approx(11.0)


def test_a_test_on_a_nodata_cell_contributes_no_ground_vertex() -> None:
    """An anchor the DEM cannot answer for is dropped, not invented."""

    def dem_hole_at_the_test(x: float, y: float) -> float | None:
        return None if (x == 105.0 and y == 103.0) else 12.0

    hull = [(105.0, 103.0), (140.0, 100.0), (100.0, 140.0)]
    tin = build_ground_surface_tin(
        dem_hole_at_the_test,
        hull,
        grid_spacing_m=10.0,
        margin_m=10.0,
    )
    assert not [v for v in tin.vertices if v[0] == 105.0 and v[1] == 103.0]


# ---------------------------------------------------------------------------
# Owner ruling 2026-08-28: "I trust surface elevation of a test more than a DEM
# we pulled off the web." Where an investigation carries its own surveyed
# collar, that value WINS over the DEM at the test's own location; the DEM
# stays the fallback for the ground BETWEEN tests.
# ---------------------------------------------------------------------------


def test_a_surveyed_collar_beats_the_dem_at_the_test() -> None:
    """The ground above a surveyed test is the test's collar, not the web DEM.

    The DEM reads 3.0 m everywhere, but the test at (105, 103) was surveyed
    at 5.8 m TAW. The owner trusts the surveyed collar over the DEM, so the
    ground vertex above the test must read 5.8, not the 3.0 the DEM sampled.
    """
    hull = [(105.0, 103.0), (140.0, 100.0), (100.0, 140.0)]
    tin = build_ground_surface_tin(
        _constant_dem(3.0),
        hull,
        grid_spacing_m=10.0,
        margin_m=10.0,
        surface_elevations={(105.0, 103.0): 5.8},
    )

    at_the_test = [v for v in tin.vertices if v[0] == 105.0 and v[1] == 103.0]
    assert at_the_test, "the ground surface carries no vertex above the surveyed test"
    assert at_the_test[0][2] == pytest.approx(5.8)


def test_a_test_at_zero_m_taw_is_not_missing_data() -> None:
    """A collar surveyed at exactly 0 m TAW is a real value, not "no data".

    Owner ruling 2026-08-28: "if something has ground level 0 (often happens
    in belgium) then this is a different case than no data." The DEM reads
    3.0 m, but the test's own surveyed collar is 0 m TAW (ordinary on the
    coast). The ground vertex above the test must anchor at 0.0 — the
    surveyed collar — and must NOT be dropped or replaced by the DEM.
    """
    hull = [(105.0, 103.0), (140.0, 100.0), (100.0, 140.0)]
    tin = build_ground_surface_tin(
        _constant_dem(3.0),
        hull,
        grid_spacing_m=10.0,
        margin_m=10.0,
        surface_elevations={(105.0, 103.0): 0.0},
    )

    at_the_test = [v for v in tin.vertices if v[0] == 105.0 and v[1] == 103.0]
    assert at_the_test, "a test surveyed at 0 m TAW was dropped as if it had no elevation"
    assert at_the_test[0][2] == pytest.approx(0.0)


def test_a_surveyed_collar_wins_even_where_the_dem_has_no_ground() -> None:
    """A surveyed collar over a DEM hole still anchors the ground at the test.

    The DEM returns None at the test (a water body returning nothing, say),
    but the test carries its own surveyed collar. The collar is trusted, so
    the ground gets a real vertex there instead of being dropped.
    """
    hull = [(105.0, 103.0), (140.0, 100.0), (100.0, 140.0)]

    def dem_hole_at_the_test(x: float, y: float) -> float | None:
        return None if (x == 105.0 and y == 103.0) else 12.0

    tin = build_ground_surface_tin(
        dem_hole_at_the_test,
        hull,
        grid_spacing_m=10.0,
        margin_m=10.0,
        surface_elevations={(105.0, 103.0): 4.0},
    )

    at_the_test = [v for v in tin.vertices if v[0] == 105.0 and v[1] == 103.0]
    assert at_the_test, "a surveyed collar over a DEM hole produced no ground vertex"
    assert at_the_test[0][2] == pytest.approx(4.0)


# ---------------------------------------------------------------------------
# assess_ground_coverage — say which tests the DEM could not answer for
# ---------------------------------------------------------------------------


def test_coverage_is_clean_when_the_dem_answers_for_every_test() -> None:
    """Full coverage reports nothing — an empty list means "no findings"."""
    points = [GroundPoint("B1", 0.0, 0.0), GroundPoint("B2", 10.0, 10.0)]
    assert assess_ground_coverage(_constant_dem(4.0), points) == []


def test_coverage_names_the_test_the_dem_has_no_ground_for() -> None:
    """A NoData cell under a test is reported, and the issue names the test.

    This is the water-body / outside-coverage case (debt #27): the TIN will
    interpolate straight across the hole, so the surface LOOKS complete. The
    issue is the only thing that says it is not.
    """

    def dem_hole_under_b2(x: float, y: float) -> float | None:
        return None if x == 10.0 else 4.0

    points = [GroundPoint("B1", 0.0, 0.0), GroundPoint("B2", 10.0, 10.0)]
    issues = assess_ground_coverage(dem_hole_under_b2, points)

    assert len(issues) == 1
    assert issues[0].kind == KIND_DEM_CELL_LOW_CONFIDENCE
    assert "B2" in issues[0].detail


def test_coverage_of_no_tests_is_clean() -> None:
    """No investigations to check is not a finding."""
    assert assess_ground_coverage(_constant_dem(None), []) == []
