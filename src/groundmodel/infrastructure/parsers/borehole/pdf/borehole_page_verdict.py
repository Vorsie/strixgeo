"""BoreholePageVerdict: what the triage decided about one page."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class import (
    BoreholePageClass,
)


@dataclass(frozen=True)
class BoreholePageVerdict:
    """One page's class and the evidence behind it.

    Parameters
    ----------
    page_number : int
        1-based.
    page_class : BoreholePageClass
        The class.
    text_source : str
        ``"text"`` (read from the text layer), ``"ocr"`` (read by OCR),
        ``"needs-ocr"`` (no usable text layer, OCR not run) or ``"none"``
        (nothing to read).
    profile : str or None
        The layout profile that matched (log and continuation sheets).
    borehole_name : str or None
        The borehole name the page prints (log and continuation sheets).
    chars : int
        Characters in the text layer.
    image_coverage : float
        Share of the page covered by images (0..1).
    drawings : int
        Number of drawing commands.
    """

    page_number: int
    page_class: BoreholePageClass
    text_source: str
    profile: str | None = None
    borehole_name: str | None = None
    chars: int = 0
    image_coverage: float = 0.0
    drawings: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Return the verdict as a JSON-ready dict."""
        return {
            "page": self.page_number,
            "class": self.page_class.value,
            "text_source": self.text_source,
            "profile": self.profile,
            "borehole_name": self.borehole_name,
            "chars": self.chars,
            "image_coverage": round(self.image_coverage, 3),
            "drawings": self.drawings,
        }
