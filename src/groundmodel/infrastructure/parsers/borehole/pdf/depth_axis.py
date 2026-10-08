"""DepthAxis: the printed depth (or elevation) axis of one sheet, as a linear fit."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DepthAxis:
    """``y = intercept + slope * value`` fitted on the axis tick labels.

    Parameters
    ----------
    slope : float
        Points per axis unit; positive when values grow downward (a depth
        axis), negative when they shrink downward (an elevation axis).
    intercept : float
        Page y of the value 0.
    unit_m : float
        Metres per axis unit (0.01 for a cm axis).
    label_count : int
        How many tick labels the fit used.
    x : float
        The labels' right edge (for the overlay).
    residual_pt : float
        Largest distance between a label and the fit (pt).
    slope_from_page : int or None
        When the sheet prints a single axis label: the page of the same
        borehole whose fitted slope was used with it (every sheet of a
        borehole is drawn at one scale); None for a sheet's own fit.
    """

    slope: float
    intercept: float
    unit_m: float
    label_count: int
    x: float
    residual_pt: float
    slope_from_page: int | None = None

    @property
    def is_elevation(self) -> bool:
        """Return True when the axis prints elevations (values shrink downward)."""
        return self.slope < 0

    def value_m_at(self, y: float) -> float:
        """Return the axis value at a page y, in metres.

        Parameters
        ----------
        y : float
            Page y.

        Returns
        -------
        float
            Depth below ground (depth axis) or elevation (elevation axis), m.
        """
        return (y - self.intercept) / self.slope * self.unit_m

    def y_at(self, value_m: float) -> float:
        """Return the page y of an axis value given in metres.

        Parameters
        ----------
        value_m : float
            Depth or elevation in metres (the axis' own kind).

        Returns
        -------
        float
            Page y.
        """
        return self.intercept + self.slope * value_m / self.unit_m

    def to_dict(self) -> dict[str, Any]:
        """Return the fit as a JSON-ready dict (stored on the provenance)."""
        return {
            "slope_pt_per_unit": round(self.slope, 6),
            "intercept_pt": round(self.intercept, 3),
            "unit_m": self.unit_m,
            "kind": "elevation" if self.is_elevation else "depth",
            "label_count": self.label_count,
            "x": round(self.x, 2),
            "residual_pt": round(self.residual_pt, 3),
            "slope_from_page": self.slope_from_page,
        }
