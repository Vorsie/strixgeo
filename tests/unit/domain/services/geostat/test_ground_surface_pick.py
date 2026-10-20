"""Owner ruling 2026-10-20: a top at 0 is the ground level, not a soil boundary.

"Skip formations with top at 0, we're pretty sure about the surface level."
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geostat.ground_surface_pick import is_ground_surface_pick


@pytest.mark.parametrize(
    ("depth_top_m", "at_surface"),
    [
        (0.0, True),  # top at 0: the pick measures the ground level
        (0.0005, True),  # within the 1 mm tolerance: still the surface
        (0.002, False),  # just below the tolerance: a real boundary
        (1.5, False),  # an ordinary pick
    ],
)
def test_a_top_at_zero_is_a_ground_surface_pick(depth_top_m: float, at_surface: bool) -> None:
    """Top at the ground surface (≤ 1 mm) → not a pick-check observation."""
    assert is_ground_surface_pick(depth_top_m) is at_surface
