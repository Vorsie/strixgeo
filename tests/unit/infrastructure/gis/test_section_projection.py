"""Unit tests for the backend section-projection helper (debt v1.0 MVP §5).

These tests pin the same conventions the frontend's
``utils/sectionProjection.ts`` ships — without that, the desktop's
rendered cross-section and the server-side DXF export would disagree
about where each investigation lives.
"""

from __future__ import annotations

import math

import pytest

from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
    section_length,
)


def test_along_distance_for_point_on_the_line() -> None:
    """A point exactly on the line projects with zero offset."""
    section = SectionEndpoints(start_x=0, start_y=0, end_x=100, end_y=0)
    result = project_point_onto_line(section, 50.0, 0.0)
    assert result is not None
    assert result.along == pytest.approx(50.0)
    assert result.offset == pytest.approx(0.0)


def test_offset_magnitude_equals_perpendicular_distance() -> None:
    """The magnitude of ``offset`` is the perpendicular distance —
    that's all the buffer filter consults. Sign reflects the
    ``vx*uy - vy*ux`` formula, which means different things in
    screen-Y-down vs world-Y-up frames; the helper module's
    docstring documents this."""
    section = SectionEndpoints(start_x=0, start_y=0, end_x=100, end_y=0)
    result_above = project_point_onto_line(section, 50.0, 10.0)
    result_below = project_point_onto_line(section, 50.0, -10.0)
    assert result_above is not None and result_below is not None
    assert abs(result_above.offset) == pytest.approx(10.0)
    assert abs(result_below.offset) == pytest.approx(10.0)
    # And the two have opposite signs (the magnitude-equals-10 case
    # really comes from points on OPPOSITE sides of the line).
    assert result_above.offset == -result_below.offset


def test_offset_sign_matches_frontend_cross_product_formula() -> None:
    """Pins the formula so frontend + backend never disagree.

    Formula: ``offset = vx*uy - vy*ux``.
    For section (0,0)→(100,0): ux=1, uy=0 → offset = -vy.
    A point at (50, 10) → offset = -10, NOT +10. This sign is the
    SAME on the frontend; renaming "left" vs "right" depends on the
    consumer's Y-axis convention.
    """
    section = SectionEndpoints(start_x=0, start_y=0, end_x=100, end_y=0)
    result = project_point_onto_line(section, 50.0, 10.0)
    assert result is not None
    assert result.offset == pytest.approx(-10.0)


def test_zero_length_section_returns_none() -> None:
    """Defensive — API rejects zero-length sections, but the math
    helper must not throw on one."""
    section = SectionEndpoints(start_x=10, start_y=10, end_x=10, end_y=10)
    assert project_point_onto_line(section, 0, 0) is None


def test_diagonal_line_projection() -> None:
    """A 45° line: the (10, 0) point projects halfway between (0,0)
    and (10, 10) at distance 5√2 with |offset| 5√2."""
    section = SectionEndpoints(start_x=0, start_y=0, end_x=10, end_y=10)
    result = project_point_onto_line(section, 10.0, 0.0)
    assert result is not None
    assert result.along == pytest.approx(5 * math.sqrt(2))
    # Magnitude is 5√2; the sign comes from the cross-product
    # convention and matches the frontend exactly. For this case:
    # u = (1, 1)/√2 → uy = 1/√2; v = (10, 0) → vy = 0;
    # offset = 10 * (1/√2) - 0 * (1/√2) = 10/√2 = 5√2 (positive).
    assert result.offset == pytest.approx(5 * math.sqrt(2))


def test_section_length_euclidean() -> None:
    section = SectionEndpoints(start_x=0, start_y=0, end_x=3, end_y=4)
    assert section_length(section) == pytest.approx(5.0)


def test_section_length_zero_when_endpoints_coincide() -> None:
    section = SectionEndpoints(start_x=5, start_y=5, end_x=5, end_y=5)
    assert section_length(section) == pytest.approx(0.0)


def test_along_can_be_negative_for_points_before_start() -> None:
    """The helper doesn't clamp to ``[0, length]`` — callers filter."""
    section = SectionEndpoints(start_x=0, start_y=0, end_x=100, end_y=0)
    result = project_point_onto_line(section, -25.0, 0.0)
    assert result is not None
    assert result.along == pytest.approx(-25.0)


def test_along_can_exceed_length_for_points_past_end() -> None:
    section = SectionEndpoints(start_x=0, start_y=0, end_x=100, end_y=0)
    result = project_point_onto_line(section, 125.0, 0.0)
    assert result is not None
    assert result.along == pytest.approx(125.0)
