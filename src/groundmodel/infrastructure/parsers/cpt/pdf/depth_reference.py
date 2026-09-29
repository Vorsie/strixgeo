"""DepthReference enum."""

from __future__ import annotations

from enum import StrEnum


class DepthReference(StrEnum):
    """What the vertical axis of a CPT graph measures.

    Members
    -------
    DEPTH_BELOW_GROUND
        Depth below ground level (m), increasing downward.
    ELEVATION
        Elevation against a datum (m TAW), decreasing downward.
    """

    DEPTH_BELOW_GROUND = "depth"
    ELEVATION = "elevation"
