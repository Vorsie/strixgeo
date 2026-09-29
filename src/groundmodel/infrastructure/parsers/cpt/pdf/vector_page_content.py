"""VectorPageContent: the words and stroked segments of one PDF page."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord


@dataclass(frozen=True, eq=False)
class VectorPageContent:
    """A page's text-layer words and every stroked line segment.

    Segments are held as parallel numpy arrays so a page with a hundred
    thousand drawing items (a site plan) stays cheap to filter.

    Parameters
    ----------
    words : tuple of PageWord
        Text-layer words in PDF points.
    segments : numpy.ndarray
        ``(n, 4)`` float array ``x0, y0, x1, y1`` per stroked segment, in
        drawing order.
    colours : numpy.ndarray
        ``(n, 3)`` stroke RGB (0..1) per segment.
    widths : numpy.ndarray
        ``(n,)`` stroke width (pt) per segment.
    path_ids : numpy.ndarray
        ``(n,)`` index of the drawing path each segment came from.
    width_pt, height_pt : float
        Page size.
    """

    words: tuple[PageWord, ...]
    segments: np.ndarray
    colours: np.ndarray
    widths: np.ndarray
    path_ids: np.ndarray
    width_pt: float
    height_pt: float

    @property
    def text(self) -> str:
        """Return the words joined by spaces (for keyword and id searches)."""
        return " ".join(w.text for w in self.words)

    def axis_aligned(self, tolerance: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
        """Return masks of the vertical and the horizontal segments.

        Parameters
        ----------
        tolerance : float
            Largest coordinate difference (pt) still counted as aligned.

        Returns
        -------
        tuple of numpy.ndarray
            ``(vertical, horizontal)`` boolean masks over ``segments``.
        """
        s = self.segments
        if len(s) == 0:
            empty = np.zeros(0, dtype=bool)
            return empty, empty
        vertical = np.abs(s[:, 0] - s[:, 2]) <= tolerance
        horizontal = np.abs(s[:, 1] - s[:, 3]) <= tolerance
        return vertical & ~horizontal, horizontal & ~vertical
