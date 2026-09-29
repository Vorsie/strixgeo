"""RasterGridDetector: find frames and grid lines on a page image."""

from __future__ import annotations

import cv2
import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    GRID_PITCH_RELATIVE_TOLERANCE,
    LINE_INK_THRESHOLD,
    LINE_MERGE_PX,
    LINE_PROBE_FRACTION,
    MIN_HORIZONTAL_LINE_FRACTION,
    MIN_PANEL_VERTICAL_LINES,
    MIN_VERTICAL_LINE_FRACTION,
    PANEL_CROSSING_SHARE,
    PANEL_EXTENT_FRACTION,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid import RasterGrid
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import to_gray
from groundmodel.infrastructure.parsers.cpt.pdf.raster_panel import RasterPanel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RasterGridDetector(GroundModelLogger):
    """Detect long straight lines, then group them into graph panels.

    Lines are found by morphological opening of the ink mask with a long thin
    probe (vertical and horizontal separately), then as connected components.
    A panel is a run of vertical lines that are equally spaced and share their
    top and bottom: the frame edges plus the grid lines in between.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def detect(self, image: np.ndarray) -> RasterGrid:
        """Return the lines and panels of a (deskewed) page image.

        Parameters
        ----------
        image : numpy.ndarray
            RGB or grey page image.

        Returns
        -------
        RasterGrid
            Lines and panels in image pixels.
        """
        ink = (to_gray(image) < LINE_INK_THRESHOLD).astype(np.uint8)
        h, w = ink.shape
        vertical = _lines(ink, vertical=True, min_len=MIN_VERTICAL_LINE_FRACTION * h)
        horizontal = _lines(ink, vertical=False, min_len=MIN_HORIZONTAL_LINE_FRACTION * w)
        panels = _panels(vertical, horizontal, h)
        self.info(
            "raster grid: %d vertical, %d horizontal lines, %d panels",
            len(vertical),
            len(horizontal),
            len(panels),
        )
        return RasterGrid(vertical_lines=vertical, horizontal_lines=horizontal, panels=panels)


def _lines(ink: np.ndarray, vertical: bool, min_len: float) -> np.ndarray:
    """Return ``(pos, start, end)`` of every long straight line in one direction."""
    h, w = ink.shape
    if vertical:
        probe = cv2.getStructuringElement(
            cv2.MORPH_RECT, (1, max(15, int(h * LINE_PROBE_FRACTION)))
        )
    else:
        probe = cv2.getStructuringElement(
            cv2.MORPH_RECT, (max(15, int(w * LINE_PROBE_FRACTION)), 1)
        )
    opened = cv2.morphologyEx(ink, cv2.MORPH_OPEN, probe)
    count, _, stats, centroids = cv2.connectedComponentsWithStats(opened, connectivity=8)
    found: list[tuple[float, float, float]] = []
    for i in range(1, count):
        x, y, bw, bh, _area = stats[i]
        if vertical and bh >= min_len:
            found.append((float(centroids[i][0]), float(y), float(y + bh - 1)))
        elif not vertical and bw >= min_len:
            found.append((float(centroids[i][1]), float(x), float(x + bw - 1)))
    return _merge(sorted(found))


def _merge(lines: list[tuple[float, float, float]]) -> np.ndarray:
    """Merge line pieces at the same position whose extents touch or overlap."""
    merged: list[list[float]] = []
    for pos, a, b in lines:
        for m in merged:
            if (
                abs(m[0] - pos) <= LINE_MERGE_PX
                and a <= m[2] + LINE_MERGE_PX * 4
                and b >= m[1] - LINE_MERGE_PX * 4
            ):
                m[0] = (m[0] + pos) / 2.0
                m[1] = min(m[1], a)
                m[2] = max(m[2], b)
                break
        else:
            merged.append([pos, a, b])
    merged.sort()
    return np.asarray(merged, dtype=float).reshape(-1, 3)


def _panels(vertical: np.ndarray, horizontal: np.ndarray, height: int) -> tuple[RasterPanel, ...]:
    """Group vertical lines into equally spaced runs with a shared extent."""
    panels: list[RasterPanel] = []
    extent_tol = PANEL_EXTENT_FRACTION * height
    n = len(vertical)
    i = 0
    while i < n - 1:
        pitch = vertical[i + 1, 0] - vertical[i, 0]

        def same_extent(a: int, b: int) -> bool:
            # Same top; the frame border may run on below the grid into the
            # title block, so the bottoms only need to overlap the shorter.
            top_ok = abs(vertical[a, 1] - vertical[b, 1]) <= extent_tol
            shorter = min(vertical[a, 2], vertical[b, 2]) - max(vertical[a, 1], vertical[b, 1])
            longest = min(vertical[a, 2] - vertical[a, 1], vertical[b, 2] - vertical[b, 1])
            return bool(top_ok and shorter >= longest - extent_tol)

        if pitch <= LINE_MERGE_PX or not same_extent(i, i + 1):
            i += 1
            continue
        j = i + 1
        while (
            j + 1 < n
            and abs((vertical[j + 1, 0] - vertical[j, 0]) - pitch)
            <= GRID_PITCH_RELATIVE_TOLERANCE * pitch
            and same_extent(i, j + 1)
        ):
            j += 1
        if j - i + 1 < MIN_PANEL_VERTICAL_LINES:
            i += 1
            continue
        run = vertical[i : j + 1]
        x0, x1 = float(run[0, 0]), float(run[-1, 0])
        # The grid's own extent: the most common bottom, not a border that
        # runs on into the title block.
        y0, y1 = float(np.median(run[:, 1])), float(np.median(run[:, 2]))
        crossing = [
            float(y)
            for y, a, b in horizontal
            if y0 - LINE_MERGE_PX <= y <= y1 + LINE_MERGE_PX
            and min(b, x1) - max(a, x0) >= PANEL_CROSSING_SHARE * (x1 - x0)
        ]
        panels.append(
            RasterPanel(
                frame=FrameRect(x0, y0, x1, y1),
                vertical_lines=tuple(float(x) for x in run[:, 0]),
                horizontal_lines=tuple(sorted(crossing)),
                pitch=float(np.median(np.diff(run[:, 0]))),
            )
        )
        i = j + 1
    return tuple(panels)
