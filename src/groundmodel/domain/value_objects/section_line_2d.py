"""Value object: :class:`SectionLine2D`."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SectionLine2D:
    """Section endpoints in the project's horizontal CRS.

    Slice queries project the TIN onto this line and return a
    polyline of (along_distance_m, elevation_m) — one point per
    triangle edge crossing.
    """

    start_x: float
    start_y: float
    end_x: float
    end_y: float

    @property
    def length_m(self) -> float:
        """Horizontal length in metres."""
        return float(np.hypot(self.end_x - self.start_x, self.end_y - self.start_y))
