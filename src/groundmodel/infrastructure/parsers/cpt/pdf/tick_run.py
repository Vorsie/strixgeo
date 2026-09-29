"""TickRun: the evenly stepped tick labels of one axis."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.tick_orientation import TickOrientation


@dataclass(frozen=True, slots=True)
class TickRun:
    """One axis found in the tick labels.

    Parameters
    ----------
    orientation : TickOrientation
        Horizontal (labels on a row) or vertical (labels in a column).
    coords : tuple of float
        Label centre along the axis (x for horizontal, y for vertical), in
        label order.
    values : tuple of float
        The labelled values, same order.
    words : tuple of PageWord
        The label words themselves (for overlays and label matching).
    """

    orientation: TickOrientation
    coords: tuple[float, ...]
    values: tuple[float, ...]
    words: tuple[PageWord, ...]

    @property
    def start(self) -> float:
        """Return the smallest coordinate of the run."""
        return min(self.coords)

    @property
    def end(self) -> float:
        """Return the largest coordinate of the run."""
        return max(self.coords)

    @property
    def cross(self) -> float:
        """Return the run's position across the axis (row y or column x)."""
        if self.orientation is TickOrientation.HORIZONTAL:
            return sum(w.cy for w in self.words) / len(self.words)
        return sum(w.x1 for w in self.words) / len(self.words)

    @property
    def top(self) -> float:
        """Return the top edge of the run's labels."""
        return min(w.y0 for w in self.words)

    @property
    def bottom(self) -> float:
        """Return the bottom edge of the run's labels."""
        return max(w.y1 for w in self.words)
