"""A synthetic one-frame CPT graph sheet, scanned: the axes printed AROUND one frame.

Some reports draw a sounding in ONE frame with no grid panels: a depth axis on
the left (depth in m, plus a level axis with tick marks further left), the qc
axis printed in red above the frame, the Rf axis in blue just inside the top
right (running right to left), the fs axis in black below the frame. The
curves are red (qc), blue (Rf) and black dashed (fs). The page is drawn with
PyMuPDF, rendered, and wrapped as an image-only PDF: a scan without a text
layer. Its words (with their pixel boxes) feed a stand-in OCR engine, so the
calibration is tested without the real OCR model.
"""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np
import pymupdf

PAGE_W = 595.0
PAGE_H = 842.0
FRAME_X0 = 90.0
FRAME_X1 = 560.0
FRAME_Y0 = 150.0
FRAME_Y1 = 780.0
DEPTH_MAX_M = 14.0
PT_PER_M = (FRAME_Y1 - FRAME_Y0) / DEPTH_MAX_M  # 45 pt per metre
QC_MAX = 30.0
FS_MAX = 0.75
RF_MAX = 30.0  # Rf 0 on the right edge, 30 on the left
GROUND_LEVEL = 5.85
LEVEL_AXIS_X = 52.0

RED = (1.0, 0.0, 0.0)
BLUE = (0.0, 0.0, 1.0)
BLACK = (0.0, 0.0, 0.0)

STEP_M = 0.02
FIRST_M = 1.0
LAST_M = 13.5


def qc_truth(depth_m: float) -> float:
    """Return the true cone resistance (MPa) at a depth."""
    return 10.0 + 8.0 * math.sin(depth_m * 0.8)


def fs_truth(depth_m: float) -> float:
    """Return the true sleeve friction (MPa) at a depth."""
    return 0.3 + 0.15 * math.cos(depth_m * 0.6)


def rf_truth(depth_m: float) -> float:
    """Return the true friction ratio (%) at a depth."""
    return 2.0 + 1.5 * math.sin(depth_m * 0.5)


def x_qc(value: float) -> float:
    """Return the page x of a qc value."""
    return FRAME_X0 + value / QC_MAX * (FRAME_X1 - FRAME_X0)


def x_fs(value: float) -> float:
    """Return the page x of an fs value."""
    return FRAME_X0 + value / FS_MAX * (FRAME_X1 - FRAME_X0)


def x_rf(value: float) -> float:
    """Return the page x of an Rf value (the axis runs right to left)."""
    return FRAME_X1 - value / RF_MAX * (FRAME_X1 - FRAME_X0)


def y_depth(depth_m: float) -> float:
    """Return the page y of a depth."""
    return FRAME_Y0 + depth_m * PT_PER_M


def _centred(page: pymupdf.Page, x: float, y: float, text: str, colour: Any) -> None:
    width = pymupdf.get_text_length(text, fontsize=8)
    page.insert_text((x - width / 2.0, y), text, fontsize=8, color=colour)


def _depths() -> list[float]:
    n = round((LAST_M - FIRST_M) / STEP_M)
    return [round(FIRST_M + i * STEP_M, 4) for i in range(n + 1)]


def framed_sheet(grid: bool = False) -> pymupdf.Document:
    """Return the vector original of the sheet (one page, with a text layer).

    Parameters
    ----------
    grid : bool
        Draw a faint grey grid inside the frame (the real sheets have one so
        light a scan loses it); False draws none at all.

    Returns
    -------
    pymupdf.Document
        The sheet.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    shape = page.new_shape()
    if grid:
        for m in range(1, int(DEPTH_MAX_M)):
            shape.draw_line((FRAME_X0, y_depth(m)), (FRAME_X1, y_depth(m)))
        for v in range(2, int(QC_MAX), 2):
            shape.draw_line((x_qc(v), FRAME_Y0), (x_qc(v), FRAME_Y1))
        shape.finish(color=(0.85, 0.85, 0.85), width=0.3)
    shape.draw_rect(pymupdf.Rect(FRAME_X0, FRAME_Y0, FRAME_X1, FRAME_Y1))
    shape.finish(color=BLACK, width=0.8)
    # The level axis: a vertical line with a tick mark at every metre.
    shape.draw_line((LEVEL_AXIS_X, FRAME_Y0), (LEVEL_AXIS_X, FRAME_Y1))
    for m in range(int(DEPTH_MAX_M) + 1):
        shape.draw_line((LEVEL_AXIS_X - 5, y_depth(m)), (LEVEL_AXIS_X, y_depth(m)))
    shape.finish(color=BLACK, width=0.8)
    depths = _depths()
    shape.draw_polyline([(x_qc(qc_truth(d)), y_depth(d)) for d in depths])
    shape.finish(color=RED, width=0.9, closePath=False)
    shape.draw_polyline([(x_rf(rf_truth(d)), y_depth(d)) for d in depths])
    shape.finish(color=BLUE, width=0.9, closePath=False)
    shape.draw_polyline([(x_fs(fs_truth(d)), y_depth(d)) for d in depths])
    shape.finish(color=BLACK, width=0.9, closePath=False, dashes="[3 2] 0")
    shape.commit()
    page.insert_text((FRAME_X0, 122), "qc, MPa", fontsize=8, color=RED)
    page.insert_text((FRAME_X1 - 30, 122), "Rf, %", fontsize=8, color=BLUE)
    for v in range(5, int(QC_MAX) + 1, 5):
        _centred(page, x_qc(v), 140, f"{v}", RED)
    for v in (10, 8, 6, 4, 2):
        _centred(page, x_rf(v), 160, f"{v}", BLUE)
    for i in range(1, 8):
        v = round(0.1 * i, 1)
        _centred(page, x_fs(v), 792, f"{v:.2f}".replace(".", ","), BLACK)
    page.insert_text((FRAME_X0, 806), "fs, MPa", fontsize=8, color=BLACK)
    for m in range(int(DEPTH_MAX_M) + 1):
        label = f"{m}"
        width = pymupdf.get_text_length(label, fontsize=8)
        page.insert_text((FRAME_X0 - 4 - width, y_depth(m) + 3), label, fontsize=8)
        level = f"{GROUND_LEVEL - m:.2f}".replace(".", ",")
        width = pymupdf.get_text_length(level, fontsize=7)
        page.insert_text((LEVEL_AXIS_X - 7 - width, y_depth(m) + 2.5), level, fontsize=7)
    return doc


def render(page: pymupdf.Page, dpi: int) -> np.ndarray:
    """Render a page to RGB."""
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3).copy()


def scanned(image: np.ndarray, dpi: int) -> pymupdf.Document:
    """Wrap an RGB render as an image-only PDF page (a scan, no text layer)."""
    h, w = image.shape[:2]
    ok, png = cv2.imencode(".png", cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    assert ok
    doc = pymupdf.open()
    page = doc.new_page(width=w * 72.0 / dpi, height=h * 72.0 / dpi)
    page.insert_image(page.rect, stream=png.tobytes())
    return doc


class PageWordsEngine:
    """A RapidOCR stand-in that "reads" the words the vector original printed.

    Each call gets a crop of the page image; the crop is located on the full
    render by template matching, and the original's words lying wholly in it
    are returned in RapidOCR's ``(box, text, score)`` shape, in crop pixels.

    Parameters
    ----------
    image : numpy.ndarray
        The full RGB render the crops are cut from.
    words : list of tuple
        ``(x0, y0, x1, y1, text)`` in pixels of ``image``.
    """

    def __init__(self, image: np.ndarray, words: list[tuple[float, float, float, float, str]]):
        self._image = image
        self._words = words
        self.calls = 0

    def __call__(self, bgr: np.ndarray) -> tuple[list[Any], None]:
        """Return the original's words inside the crop."""
        self.calls += 1
        crop = np.ascontiguousarray(bgr[:, :, ::-1])
        h, w = crop.shape[:2]
        if h > self._image.shape[0] or w > self._image.shape[1]:
            return [], None
        match = cv2.matchTemplate(self._image, crop, cv2.TM_SQDIFF)
        _, _, (ox, oy), _ = cv2.minMaxLoc(match)
        out = []
        for x0, y0, x1, y1, text in self._words:
            if x0 >= ox and y0 >= oy and x1 <= ox + w and y1 <= oy + h:
                box = [
                    [x0 - ox, y0 - oy],
                    [x1 - ox, y0 - oy],
                    [x1 - ox, y1 - oy],
                    [x0 - ox, y1 - oy],
                ]
                out.append((box, text, 0.99))
        return out, None


def words_px(page: pymupdf.Page, dpi: int) -> list[tuple[float, float, float, float, str]]:
    """Return the vector original's words in pixels of a render at ``dpi``."""
    k = dpi / 72.0
    return [(w[0] * k, w[1] * k, w[2] * k, w[3] * k, w[4]) for w in page.get_text("words")]
