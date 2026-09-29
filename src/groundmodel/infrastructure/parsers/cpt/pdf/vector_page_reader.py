"""VectorPageReader: read words and stroked segments from a PyMuPDF page."""

from __future__ import annotations

from typing import Any

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_content import VectorPageContent
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class VectorPageReader(GroundModelLogger):
    """Flatten a page's drawing commands into line segments.

    Lines stay lines; a rectangle becomes its four edges; a Bezier curve is
    reduced to its chord (CPT sheets draw curves as polylines, so the chord
    loses nothing there); fill-only paths are skipped (hatching, logos).
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def read(self, page: pymupdf.Page, with_drawings: bool = True) -> VectorPageContent:
        """Return the page's words and stroked segments.

        Parameters
        ----------
        page : pymupdf.Page
            The page.
        with_drawings : bool
            False skips the drawing commands (text-only uses stay fast).

        Returns
        -------
        VectorPageContent
            Words and segments.
        """
        words = tuple(
            PageWord(float(w[0]), float(w[1]), float(w[2]), float(w[3]), str(w[4]))
            for w in page.get_text("words")
        )
        segs: list[tuple[float, float, float, float]] = []
        cols: list[tuple[float, float, float]] = []
        wids: list[float] = []
        pids: list[int] = []
        if with_drawings:
            for pid, path in enumerate(page.get_drawings()):
                colour = path.get("color")
                if colour is None or path.get("type") == "f":
                    continue
                rgb = _rgb(colour)
                width = float(path.get("width") or 0.0)
                for item in path["items"]:
                    for seg in _item_segments(item):
                        segs.append(seg)
                        cols.append(rgb)
                        wids.append(width)
                        pids.append(pid)
        content = VectorPageContent(
            words=words,
            segments=np.asarray(segs, dtype=float).reshape(-1, 4),
            colours=np.asarray(cols, dtype=float).reshape(-1, 3),
            widths=np.asarray(wids, dtype=float),
            path_ids=np.asarray(pids, dtype=int),
            width_pt=float(page.rect.width),
            height_pt=float(page.rect.height),
        )
        self.trace(
            "page %d: %d words, %d segments", page.number + 1, len(words), len(content.segments)
        )
        return content


def _rgb(colour: Any) -> tuple[float, float, float]:
    """Return an RGB triple from a PyMuPDF colour (grey, RGB or CMYK)."""
    c = tuple(float(v) for v in colour)
    if len(c) == 1:
        return (c[0], c[0], c[0])
    if len(c) == 4:  # CMYK -> RGB, the plain conversion PyMuPDF renders with
        k = c[3]
        return ((1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k))
    return (c[0], c[1], c[2])


def _item_segments(item: tuple[Any, ...]) -> list[tuple[float, float, float, float]]:
    """Return the straight segments one drawing item contributes."""
    kind = item[0]
    if kind == "l":
        p, q = item[1], item[2]
        return [(p.x, p.y, q.x, q.y)]
    if kind == "c":
        p, q = item[1], item[4]
        return [(p.x, p.y, q.x, q.y)]
    if kind == "re":
        r = item[1]
        return [
            (r.x0, r.y0, r.x1, r.y0),
            (r.x1, r.y0, r.x1, r.y1),
            (r.x1, r.y1, r.x0, r.y1),
            (r.x0, r.y1, r.x0, r.y0),
        ]
    if kind == "qu":
        quad = item[1]
        pts = [quad.ul, quad.ur, quad.lr, quad.ll, quad.ul]
        return [(a.x, a.y, b.x, b.y) for a, b in zip(pts, pts[1:], strict=False)]
    return []
