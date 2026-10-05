"""Synthetic CPT sheets whose text layer is unreadable, and a counting fake OCR engine.

The owner's 2.3 report (2026-10-05) prints its sheets in a font without a
Unicode map: the words extract as symbol soup, so every sheet's title strips
go through OCR. These helpers build such sheets and stand in for RapidOCR.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pymupdf

from . import _synthetic_cpt_pdf as synth

# Symbol soup as a font without a Unicode map extracts it.
SOUP = ";<=>&?"


def add_garbled_cpt_page(doc: pymupdf.Document) -> None:
    """Append a CPT sheet whose text layer is mostly symbol soup (letter share ~0.3)."""
    page = synth.draw_cpt_page(doc)
    for i in range(40):
        page.insert_text((60 + (i % 8) * 60, 20 + (i // 8) * 8), SOUP, fontsize=5)


def garbled_report(pages: int) -> pymupdf.Document:
    """Return a report of ``pages`` garbled CPT sheets."""
    doc = pymupdf.open()
    for _ in range(pages):
        add_garbled_cpt_page(doc)
    return doc


class CountingEngine:
    """A RapidOCR stand-in: counts its calls, reads one word per image.

    Parameters
    ----------
    on_call : callable or None
        Called after every call (a test flips its stop flag from here).
    """

    def __init__(self, on_call: Any = None) -> None:
        self.calls = 0
        self._on_call = on_call

    def __call__(self, image: np.ndarray) -> tuple[list[Any], None]:
        """Return one text line ("TEST") in RapidOCR's ``(box, text, score)`` shape."""
        self.calls += 1
        if self._on_call is not None:
            self._on_call(self.calls)
        h, w = image.shape[:2]
        box = [[1.0, 1.0], [w / 2.0, 1.0], [w / 2.0, h / 2.0], [1.0, h / 2.0]]
        return [(box, "TEST", 0.99)], None
