"""2D coordinate value object with EPSG CRS code."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Coordinate:
    """Immutable 2D coordinate (X, Y) with an EPSG CRS code."""

    x: float
    y: float
    epsg: int = 4326
