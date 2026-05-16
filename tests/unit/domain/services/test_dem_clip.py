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
