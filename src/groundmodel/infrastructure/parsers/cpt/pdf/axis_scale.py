"""AxisScale: a linear page-coordinate -> value mapping held as two anchors."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True, slots=True)
class AxisScale:
    """A linear axis defined by two anchor points.

    Two anchors rather than slope + intercept, because that is what a user
    drags in the calibration overlay: "this grid line is 0 MPa, that one is
    32 MPa". A reversed axis (elevation, a u2 axis printed 1400 .. -200) is a
    negative slope, nothing more.

    Parameters
    ----------
    coord_a, coord_b : float
        Page (pt) or image (px) coordinates of the two anchors along the axis.
    value_a, value_b : float
        The axis values at those coordinates.
    max_residual : float
        Largest misfit of the tick labels the scale was fitted to, in value
        units (0 for a user-set scale). Excluded from equality.
    """

    coord_a: float
    value_a: float
    coord_b: float
    value_b: float
    max_residual: float = field(default=0.0, compare=False)

    def __post_init__(self) -> None:
        """Refuse a degenerate axis (both anchors at one coordinate or value)."""
        if self.coord_a == self.coord_b or self.value_a == self.value_b:
            raise ValueError(
                f"axis anchors must differ in coordinate and value, got "
                f"({self.coord_a}, {self.value_a}) and ({self.coord_b}, {self.value_b})"
            )

    @property
    def slope(self) -> float:
        """Return value units per coordinate unit."""
        return (self.value_b - self.value_a) / (self.coord_b - self.coord_a)

    @property
    def is_decreasing(self) -> bool:
        """Return whether the value falls as the coordinate grows."""
        return self.slope < 0

    @property
    def value_min(self) -> float:
        """Return the smaller anchor value."""
        return min(self.value_a, self.value_b)

    @property
    def value_max(self) -> float:
        """Return the larger anchor value."""
        return max(self.value_a, self.value_b)

    def value_at(self, coord: float) -> float:
        """Return the axis value at a page coordinate.

        Parameters
        ----------
        coord : float
            Coordinate along the axis.

        Returns
        -------
        float
            The value.
        """
        return self.value_a + (coord - self.coord_a) * self.slope

    def values_at(self, coords: np.ndarray) -> np.ndarray:
        """Vectorised :meth:`value_at`.

        Parameters
        ----------
        coords : numpy.ndarray
            Coordinates along the axis.

        Returns
        -------
        numpy.ndarray
            The values.
        """
        return self.value_a + (np.asarray(coords, dtype=float) - self.coord_a) * self.slope

    def coord_of(self, value: float) -> float:
        """Return the page coordinate of an axis value.

        Parameters
        ----------
        value : float
            Axis value.

        Returns
        -------
        float
            The coordinate.
        """
        return self.coord_a + (value - self.value_a) / self.slope

    def coords_of(self, values: np.ndarray) -> np.ndarray:
        """Vectorised :meth:`coord_of`.

        Parameters
        ----------
        values : numpy.ndarray
            Axis values.

        Returns
        -------
        numpy.ndarray
            The coordinates.
        """
        return self.coord_a + (np.asarray(values, dtype=float) - self.value_a) / self.slope

    def scaled(self, factor: float) -> AxisScale:
        """Return the same axis in a coordinate space ``factor`` times larger.

        Parameters
        ----------
        factor : float
            E.g. ``dpi / 72`` from PDF points to image pixels.

        Returns
        -------
        AxisScale
            The scaled axis.
        """
        return AxisScale(
            self.coord_a * factor,
            self.value_a,
            self.coord_b * factor,
            self.value_b,
            self.max_residual,
        )

    @classmethod
    def fit(cls, coords: Sequence[float], values: Sequence[float]) -> AxisScale:
        """Least-squares fit through tick positions and their label values.

        The anchors are placed at the smallest and the largest tick value, so
        the overlay shows them on the outermost labelled grid lines.

        Parameters
        ----------
        coords : sequence of float
            Tick positions along the axis.
        values : sequence of float
            The labelled values at those positions.

        Returns
        -------
        AxisScale
            The fitted scale, with ``max_residual`` set.

        Raises
        ------
        ValueError
            When fewer than two distinct ticks are given.
        """
        c = np.asarray(coords, dtype=float)
        v = np.asarray(values, dtype=float)
        if len(c) != len(v) or len(np.unique(v)) < 2 or len(np.unique(c)) < 2:
            raise ValueError("an axis fit needs at least two distinct ticks")
        slope, intercept = np.polyfit(c, v, 1)
        residual = float(np.max(np.abs(slope * c + intercept - v)))
        lo, hi = float(v.min()), float(v.max())
        return cls(
            coord_a=float((lo - intercept) / slope),
            value_a=lo,
            coord_b=float((hi - intercept) / slope),
            value_b=hi,
            max_residual=residual,
        )

    @classmethod
    def fit_robust(
        cls, coords: Sequence[float], values: Sequence[float], min_inliers: int = 3
    ) -> AxisScale | None:
        """Fit through the largest consistent subset of (coordinate, value) pairs.

        OCR misreads a tick now and then ("2830" for "28 30", "¥14"); every
        pair of ticks proposes a line, the line with the most ticks within 2 %
        of the value range wins, and the scale is refitted on those ticks.

        Parameters
        ----------
        coords : sequence of float
            Tick positions (grid-line positions the labels snapped to).
        values : sequence of float
            The values read for them.
        min_inliers : int
            Fewest agreeing ticks accepted.

        Returns
        -------
        AxisScale or None
            The fit, or None when no line gathers ``min_inliers`` ticks.
        """
        c = np.asarray(coords, dtype=float)
        v = np.asarray(values, dtype=float)
        n = len(c)
        if n < 2:
            return None
        span = float(np.ptp(v)) or 1.0
        best: np.ndarray | None = None
        for i in range(n):
            for j in range(i + 1, n):
                if c[i] == c[j] or v[i] == v[j]:
                    continue
                slope = (v[j] - v[i]) / (c[j] - c[i])
                pred = v[i] + (c - c[i]) * slope
                inliers = np.abs(pred - v) <= 0.02 * span
                if best is None or inliers.sum() > best.sum():
                    best = inliers
        if best is None or best.sum() < min_inliers:
            return None
        return cls.fit(c[best].tolist(), v[best].tolist())

    def to_dict(self) -> dict[str, float]:
        """Return the scale as a plain dict (JSON-ready for the UI)."""
        return {
            "coord_a": self.coord_a,
            "value_a": self.value_a,
            "coord_b": self.coord_b,
            "value_b": self.value_b,
            "max_residual": self.max_residual,
        }

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> AxisScale:
        """Rebuild a scale from :meth:`to_dict` output.

        Parameters
        ----------
        data : dict
            Keys ``coord_a``, ``value_a``, ``coord_b``, ``value_b`` and
            optionally ``max_residual``.

        Returns
        -------
        AxisScale
            The scale.
        """
        return cls(
            float(data["coord_a"]),
            float(data["value_a"]),
            float(data["coord_b"]),
            float(data["value_b"]),
            float(data.get("max_residual", 0.0)),
        )
