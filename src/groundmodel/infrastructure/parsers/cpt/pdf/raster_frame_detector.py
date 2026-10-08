"""RasterFrameDetector: find ONE graph frame and its depth ticks on a page image."""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    FRAME_AXIS_COVERAGE,
    FRAME_EDGE_TOLERANCE_SHARE,
    FRAME_MIN_TICKS,
    FRAME_MIN_WIDTH_SHARE,
    GRID_PITCH_RELATIVE_TOLERANCE,
    LINE_INK_THRESHOLD,
    LINE_MERGE_PX,
    PANEL_CROSSING_SHARE,
    RASTER_GRAPH_MIN_HORIZONTAL_LINES,
    RASTER_GRAPH_MIN_PANEL_HEIGHT,
    TICK_FILL_SHARE,
    TICK_GAP_PX,
    TICK_MAX_HEIGHT_SHARE,
    TICK_PITCH_RELATIVE_TOLERANCE,
    TICK_REACH_SHARE,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid import RasterGrid
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import to_gray
from groundmodel.infrastructure.parsers.cpt.pdf.raster_panel import RasterPanel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RasterFrameDetector(GroundModelLogger):
    """Find a one-frame CPT graph: a rectangle plus regular ticks on its depth axis.

    Owner ruling 2026-10-08: a scanned report whose graph is ONE frame with
    no grid panels (the depth axis on the left with a tick per metre, the
    value axes printed around the frame) must be read too. The frame is the
    largest rectangle the long straight lines close; it is a graph when a
    vertical axis line at or left of its left edge carries at least
    ``FRAME_MIN_TICKS`` equally spaced tick marks. A faint grid inside the
    frame, when found, gives the depth lines instead of the ticks.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def detect(self, image: np.ndarray, grid: RasterGrid) -> RasterPanel | None:
        """Return the frame as a ``framed`` panel, or None when the page has none.

        Parameters
        ----------
        image : numpy.ndarray
            RGB or grey page image (deskewed).
        grid : RasterGrid
            Its long straight lines (``RasterGridDetector.detect``).

        Returns
        -------
        RasterPanel or None
            ``framed=True``; ``horizontal_lines`` the depth ticks (or the
            frame's own horizontal grid lines) plus the frame's top and
            bottom; ``vertical_lines`` the frame edges plus any full-height
            vertical lines inside.
        """
        h, w = image.shape[:2]
        frame = _frame(grid, w, h)
        if frame is None:
            self.debug("one-frame graph: no frame closed by the long lines")
            return None
        tol = max(2.0 * LINE_MERGE_PX, FRAME_EDGE_TOLERANCE_SHARE * w)
        inner = _inner_rows(grid, frame, tol)
        if not _spans(inner, frame):
            inner = []
        ink = to_gray(image) < LINE_INK_THRESHOLD
        ticks = _depth_ticks(ink, grid, frame, tol)
        from_grid = len(inner) >= FRAME_MIN_TICKS
        rows = inner if from_grid else ticks
        if len(rows) < FRAME_MIN_TICKS:
            self.debug(
                "one-frame graph: frame %s has %d tick(s) and %d grid row(s): not a graph",
                frame,
                len(ticks),
                len(inner),
            )
            return None
        verticals = sorted(
            {frame.x0, frame.x1}
            | {
                float(x)
                for x, a, b in grid.vertical_lines
                if frame.x0 + tol < x < frame.x1 - tol
                and min(b, frame.y1) - max(a, frame.y0) >= PANEL_CROSSING_SHARE * frame.height
            }
        )
        lines = _merged(sorted({frame.y0, frame.y1, *rows}))
        diffs = np.diff(verticals)
        panel = RasterPanel(
            frame=frame,
            vertical_lines=tuple(verticals),
            horizontal_lines=tuple(lines),
            pitch=float(np.median(diffs)) if len(diffs) else frame.width,
            framed=True,
        )
        self.info(
            "one-frame graph: frame %.0f,%.0f-%.0f,%.0f; %d depth line(s) from %s",
            frame.x0,
            frame.y0,
            frame.x1,
            frame.y1,
            len(lines),
            "its grid" if from_grid else "the axis ticks",
        )
        return panel


def framed_or_grid_panels(
    grid: RasterGrid, framed: RasterPanel | None, image_height: int
) -> tuple[RasterPanel, ...]:
    """Return the panels to calibrate: the grid's panels, or the one frame.

    The grid panels win unless they are pieces of the frame's own grid: a
    grid so light that only some of its lines survive the ink threshold
    splits into several "panels" with ONE pitch on ONE lattice that runs
    from the frame's left edge to its right edge. Side-by-side panels with
    their own grids (other pitches, gaps off the lattice) stay panels.

    Parameters
    ----------
    grid : RasterGrid
        The grid detection.
    framed : RasterPanel or None
        The one-frame detection.
    image_height : int
        Image height (px).

    Returns
    -------
    tuple of RasterPanel
        ``(framed,)`` or ``grid.panels``.
    """
    if framed is None:
        return grid.panels
    good = [
        p
        for p in grid.panels
        if p.frame.height >= RASTER_GRAPH_MIN_PANEL_HEIGHT * image_height
        and len(p.horizontal_lines) >= RASTER_GRAPH_MIN_HORIZONTAL_LINES
    ]
    if not good:
        return (framed,)
    f = framed.frame
    tol = max(2.0 * LINE_MERGE_PX, 0.25 * min(p.pitch for p in good))
    inside = all(
        p.frame.x0 >= f.x0 - tol
        and p.frame.x1 <= f.x1 + tol
        and p.frame.y0 >= f.y0 - tol
        and p.frame.y1 <= f.y1 + tol
        for p in good
    )
    if inside and _one_lattice(good, f):
        return (framed,)
    return grid.panels


def _one_lattice(panels: list[RasterPanel], frame: FrameRect) -> bool:
    """Return whether every panel's lines and both frame edges sit on one pitch lattice."""
    pitches = [p.pitch for p in panels]
    pitch = float(np.median(pitches))
    if pitch <= 0 or any(abs(p - pitch) > GRID_PITCH_RELATIVE_TOLERANCE * pitch for p in pitches):
        return False
    xs = [x for p in panels for x in p.vertical_lines] + [frame.x0, frame.x1]
    steps = (np.asarray(xs) - frame.x0) / pitch
    return bool(np.all(np.abs(steps - np.round(steps)) <= 0.15))


def _frame(grid: RasterGrid, w: int, h: int) -> FrameRect | None:
    """Return the largest rectangle two vertical and two horizontal long lines close."""
    tol = max(2.0 * LINE_MERGE_PX, FRAME_EDGE_TOLERANCE_SHARE * w)
    verticals = grid.vertical_lines
    horizontals = grid.horizontal_lines
    best: tuple[float, FrameRect] | None = None
    for i in range(len(verticals)):
        for j in range(i + 1, len(verticals)):
            x0, a0, b0 = verticals[i]
            x1, a1, b1 = verticals[j]
            if x1 - x0 < FRAME_MIN_WIDTH_SHARE * w:
                continue
            top, bottom = max(a0, a1), min(b0, b1)
            if bottom - top < RASTER_GRAPH_MIN_PANEL_HEIGHT * h:
                continue
            spanning = [float(y) for y, a, b in horizontals if a <= x0 + tol and b >= x1 - tol]
            tops = [y for y in spanning if abs(y - top) <= tol]
            bottoms = [y for y in spanning if abs(y - bottom) <= tol]
            if not tops or not bottoms:
                continue
            rect = FrameRect(float(x0), min(tops), float(x1), max(bottoms))
            area = rect.width * rect.height
            if best is None or area > best[0]:
                best = (area, rect)
    return best[1] if best else None


def _inner_rows(grid: RasterGrid, frame: FrameRect, tol: float) -> list[float]:
    """Return the frame's own horizontal grid lines when they are regular, else []."""
    rows = [
        float(y)
        for y, a, b in grid.horizontal_lines
        if frame.y0 + tol < y < frame.y1 - tol
        and min(b, frame.x1) - max(a, frame.x0) >= PANEL_CROSSING_SHARE * frame.width
    ]
    return _regular(sorted(rows))


def _depth_ticks(ink: np.ndarray, grid: RasterGrid, frame: FrameRect, tol: float) -> list[float]:
    """Return the regular tick marks of the best depth axis at or left of the frame.

    Every long vertical line at or left of the frame's left edge that runs
    along the frame is a candidate axis; on each side of it, a row is a tick
    where a short run beside the line is (nearly) all ink. The candidate
    with the most equally spaced ticks wins.
    """
    h, w = ink.shape
    reach = max(3, round(TICK_REACH_SHARE * w))
    gap = TICK_GAP_PX
    max_run = max(3, round(TICK_MAX_HEIGHT_SHARE * h))
    y0 = max(int(frame.y0 - tol), 0)
    y1 = min(int(frame.y1 + tol), h - 1)
    best: list[float] = []
    for x, a, b in grid.vertical_lines:
        if x > frame.x0 + tol or min(b, frame.y1) - max(a, frame.y0) < 0.9 * frame.height:
            continue
        for side in (-1, 1):
            c0 = int(round(x)) + side * gap
            c1 = c0 + side * reach
            lo, hi = sorted((c0, c1))
            if lo < 0 or hi >= w:
                continue
            # A tick is SHORT: the ink stops before three reaches out. A rule
            # that runs on (a table's row lines leaving its border) is not one.
            f0 = int(round(x)) + side * (gap + 3 * reach)
            flo, fhi = sorted((f0, f0 + side * reach))
            if flo < 0 or fhi >= w:
                continue
            near = ink[y0 : y1 + 1, lo : hi + 1].mean(axis=1) >= TICK_FILL_SHARE
            far = ink[y0 : y1 + 1, flo : fhi + 1].mean(axis=1) >= TICK_FILL_SHARE
            ticks = [y0 + c for c in _run_centres(near & ~far, max_run)]
            regular = _regular(ticks)
            if len(regular) > len(best) and _spans(regular, frame):
                best = regular
    return best


def _spans(lines: list[float], frame: FrameRect) -> bool:
    """Return whether equally spaced lines run the frame's full height (an axis, not a table).

    A depth axis puts a tick (or a grid line) at every step from the top of
    the frame to its bottom; a table's ruled rows are irregular and stop
    short. Every gap must be a whole number of steps, at least
    ``FRAME_AXIS_COVERAGE`` of the steps present, the first and last within a
    step and a half of the frame's top and bottom.
    """
    if len(lines) < FRAME_MIN_TICKS:
        return False
    pitch = _pitch(lines)
    if pitch <= 0:
        return False
    # Every gap is a whole number of steps (a lost tick leaves a double one);
    # a table's rows of uneven height are not.
    multiples = np.diff(lines) / pitch
    if np.any(np.abs(multiples - np.round(multiples)) > TICK_PITCH_RELATIVE_TOLERANCE):
        return False
    steps = frame.height / pitch
    return (
        lines[0] <= frame.y0 + 1.5 * pitch
        and lines[-1] >= frame.y1 - 1.5 * pitch
        and len(lines) >= FRAME_AXIS_COVERAGE * steps
    )


def _pitch(lines: list[float]) -> float:
    """Return the agreed spacing of regular lines: their smallest common step.

    ``_regular`` keeps the lines bounding the spacings that agree, so a
    missing line leaves a double step; the shortest quarter of the steps is
    the pitch itself.
    """
    diffs = np.sort(np.diff(lines))
    return float(np.median(diffs[: max(1, len(diffs) // 4)]))


def _run_centres(flags: np.ndarray, max_run: int) -> list[float]:
    """Return the centre row of every run of True no taller than ``max_run``."""
    centres: list[float] = []
    start: int | None = None
    for i, flag in enumerate([*flags.tolist(), False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            if i - start <= max_run:
                centres.append((start + i - 1) / 2.0)
            start = None
    return centres


def _regular(positions: list[float]) -> list[float]:
    """Return the positions on the most common spacing (a tick per step), else [].

    Each spacing between neighbours proposes a pitch; the pitch most
    spacings agree with (within ``TICK_PITCH_RELATIVE_TOLERANCE``) wins and
    the positions bounding those spacings are kept.
    """
    if len(positions) < 2:
        return []
    diffs = np.diff(positions)
    best: set[int] = set()
    for pitch in diffs:
        if pitch <= LINE_MERGE_PX:
            continue
        agree = np.flatnonzero(np.abs(diffs - pitch) <= TICK_PITCH_RELATIVE_TOLERANCE * pitch)
        kept = {int(i) for i in agree} | {int(i) + 1 for i in agree}
        if len(kept) > len(best):
            best = kept
    return [positions[i] for i in sorted(best)]


def _merged(values: list[float]) -> list[float]:
    """Merge positions closer than ``LINE_MERGE_PX`` (the frame edge and the first tick)."""
    out: list[float] = []
    for v in values:
        if out and v - out[-1] <= LINE_MERGE_PX:
            continue
        out.append(v)
    return out
