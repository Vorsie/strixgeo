"""FrameRect: the plot frame of one graph panel, in page or image coordinates."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FrameRect:
    """An axis-aligned rectangle; the UI's draggable frame corners.

    Parameters
    ----------
    x0, y0 : float
        Top-left corner (y grows downward).
    x1, y1 : float
        Bottom-right corner.
    """

    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        """Return the frame width."""
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        """Return the frame height."""
        return self.y1 - self.y0

    def contains(self, x: float, y: float, margin: float = 0.0) -> bool:
        """Return whether a point lies inside the frame grown by ``margin``.

        Parameters
        ----------
        x, y : float
            The point.
        margin : float
            Tolerance added on every side.

        Returns
        -------
        bool
            True when the point is inside.
        """
        return (
            self.x0 - margin <= x <= self.x1 + margin and self.y0 - margin <= y <= self.y1 + margin
        )

    def scaled(self, factor: float) -> FrameRect:
        """Return the frame with every coordinate multiplied by ``factor``.

        Parameters
        ----------
        factor : float
            Scale factor, e.g. ``dpi / 72`` from PDF points to image pixels.

        Returns
        -------
        FrameRect
            The scaled frame.
        """
        return FrameRect(self.x0 * factor, self.y0 * factor, self.x1 * factor, self.y1 * factor)

    def to_dict(self) -> dict[str, float]:
        """Return the frame as a plain dict (JSON-ready for the UI)."""
        return {"x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1}

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> FrameRect:
        """Rebuild a frame from :meth:`to_dict` output.

        Parameters
        ----------
        data : dict
            Keys ``x0``, ``y0``, ``x1``, ``y1``.

        Returns
        -------
        FrameRect
            The frame.
        """
        return cls(float(data["x0"]), float(data["y0"]), float(data["x1"]), float(data["y1"]))
