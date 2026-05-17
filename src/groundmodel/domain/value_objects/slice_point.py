"""Value object: :class:`SlicePoint`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SlicePoint:
    """One point on a section-slice polyline."""

    along_m: float
    elevation_m: float
