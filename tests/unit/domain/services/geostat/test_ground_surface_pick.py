"""Owner rulings 2026-10-20: a top within 10 cm of 0 is the ground level, not a soil boundary.

"Skip formations with top at 0, we're pretty sure about the surface level."
"10 cm is surface."
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geostat.ground_surface_pick import is_ground_surface_pick


@pytest.mark.parametrize(
    ("depth_top_m", "at_surface"),
    [
        (0.0, True),  # top at 0: the pick measures the ground level
        (0.05, True),  # a manual click a few cm below 0: still the surface
        (0.10, True),  # 10 cm is surface: the boundary is inclusive
        (0.11, False),  # just deeper than 10 cm: a real soil boundary
        (1.5, False),  # an ordinary pick
    ],
)
def test_a_top_within_10_cm_of_the_surface_is_a_ground_surface_pick(
    depth_top_m: float, at_surface: bool
) -> None:
    """Top within 10 cm of the ground surface → not a pick-check observation."""
    assert is_ground_surface_pick(depth_top_m) is at_surface
