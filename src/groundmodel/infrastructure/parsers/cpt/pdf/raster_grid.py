"""RasterGrid: the straight lines and panels found on a page image."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.raster_panel import RasterPanel


@dataclass(frozen=True, eq=False)
class RasterGrid:
    """Every long line of a (deskewed) page image and the panels they form.

    Parameters
    ----------
    vertical_lines : numpy.ndarray
        ``(n, 3)`` ``x, y0, y1`` per vertical line (px).
    horizontal_lines : numpy.ndarray
        ``(m, 3)`` ``y, x0, x1`` per horizontal line (px).
    panels : tuple of RasterPanel
        Panels left to right.
    """

    vertical_lines: np.ndarray
    horizontal_lines: np.ndarray
    panels: tuple[RasterPanel, ...]
