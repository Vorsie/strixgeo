"""PageWord: one word of a page's text layer (or of an OCR pass) with its box."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PageWord:
    """A word and its bounding box in page coordinates.

    PDF text-layer words are in points with y growing downward (PyMuPDF's
    convention); OCR words on a rendered image are in pixels, same orientation.

    Parameters
    ----------
    x0, y0, x1, y1 : float
        Bounding box, top-left and bottom-right corner.
    text : str
        The word as extracted.
    """

    x0: float
    y0: float
    x1: float
    y1: float
    text: str

    @property
    def cx(self) -> float:
        """Return the horizontal centre of the box."""
        return (self.x0 + self.x1) / 2.0

    @property
    def cy(self) -> float:
        """Return the vertical centre of the box."""
        return (self.y0 + self.y1) / 2.0
