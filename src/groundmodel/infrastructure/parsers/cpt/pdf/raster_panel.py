"""RasterPanel: one graph panel found from the grid lines of a page image."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect


@dataclass(frozen=True, slots=True)
class RasterPanel:
    """A run of equally spaced vertical grid lines and the rows crossing it.

    Parameters
    ----------
    frame : FrameRect
        First to last vertical grid line, top to bottom of those lines (px).
    vertical_lines : tuple of float
        x of each vertical grid line, left to right.
    horizontal_lines : tuple of float
        y of each horizontal grid line that crosses the panel, top to bottom.
    pitch : float
        Median spacing of the vertical lines (px).
    """

    frame: FrameRect
    vertical_lines: tuple[float, ...]
    horizontal_lines: tuple[float, ...]
    pitch: float
