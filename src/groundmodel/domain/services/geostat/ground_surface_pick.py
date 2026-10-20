"""Whether a pick sits at the ground surface (owner ruling 2026-10-20)."""

from __future__ import annotations

from groundmodel.domain.services.geostat.geostat_constants import (
    GROUND_SURFACE_DEPTH_TOLERANCE_M,
)


def is_ground_surface_pick(depth_top_m: float) -> bool:
    """Return whether a pick's top is at the ground surface.

    Such a pick measures the ground level, not a soil boundary, so the pick
    consistency check does not use it as an observation.

    Parameters
    ----------
    depth_top_m : float
        Depth of the formation top below the test's ground level (m).

    Returns
    -------
    bool
        ``True`` when ``depth_top_m`` ≤ ``GROUND_SURFACE_DEPTH_TOLERANCE_M``.
    """
    return depth_top_m <= GROUND_SURFACE_DEPTH_TOLERANCE_M
