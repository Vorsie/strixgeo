"""RasterCurveExtractor: trace CPT curves on a page image, one depth row at a time."""

from __future__ import annotations

import cv2
import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.depth_conversion import to_depth_below_ground
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    BLACK_CURVE_THRESHOLD,
    CLIP_EDGE_TOLERANCE,
    FULL_WIDTH_RULE_SHARE,
    IMAGE_PIXELS,
    LINE_INK_THRESHOLD,
    STORED_COLUMN_BY_KIND,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import (
    hue_mask,
    is_chromatic,
    pixel_runs,
    to_gray,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import monotonic_depth
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RasterCurveExtractor(GroundModelLogger):
    """The owner's "ball": per depth row, slide left/right onto the curve's pixels.

    1. A mask of the curve's pixels inside the frame: hue match for a
       coloured curve, dark pixels minus the straight grid lines for a black
       one.
    2. Per pixel row, the mask splits into runs. The ball takes the run
       nearest to where it was on the row above (continuity), so crossing
       curves and stray text do not capture it.
    3. A thin run gives its centre. A wide run is a near-horizontal stroke
       (a spike): when the curve turns back on the next row the ball takes
       the run's far end (the spike tip), else its centre.
    4. The row's y and the run's x go through the calibration to
       (depth, value).
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def extract(self, image: np.ndarray, calibration: PageCalibration) -> DigitisedSounding:
        """Return the curves traced on ``image``.

        Parameters
        ----------
        image : numpy.ndarray
            ``(h, w, 3)`` RGB page image, deskewed, in the calibration's pixel
            space.
        calibration : PageCalibration
            An image-space calibration; every stored panel must be complete.

        Returns
        -------
        DigitisedSounding
            One curve per stored panel.

        Raises
        ------
        ValueError
            On a PDF-point calibration or a panel without scales.
        """
        if calibration.coordinate_space != IMAGE_PIXELS:
            raise ValueError("raster extraction needs an image-pixel calibration")
        hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
        gray = to_gray(image)
        curves: dict[PanelKind, DigitisedCurve] = {}
        for panel in calibration.panels:
            if panel.kind not in STORED_COLUMN_BY_KIND:
                continue
            if not panel.is_complete:
                raise ValueError(
                    f"page {calibration.page_number}: {panel.kind.value} panel has no axis "
                    "scale; supply two ticks per axis (PanelCalibration.from_user_ticks)"
                )
            curve = self._trace(hsv, gray, panel, calibration)
            curves[panel.kind] = curve
            self.info(
                "page %d %s: traced %d rows, %d clipped",
                calibration.page_number,
                panel.kind.value,
                len(curve),
                int(curve.clipped.sum()),
            )
        return DigitisedSounding(
            sounding_id=calibration.sounding_id,
            page_numbers=(calibration.page_number,),
            calibrations=(calibration,),
            curves=curves,
        )

    def _trace(
        self,
        hsv: np.ndarray,
        gray: np.ndarray,
        panel: PanelCalibration,
        calibration: PageCalibration,
    ) -> DigitisedCurve:
        """Trace one panel's curve."""
        assert panel.value_scale is not None and panel.depth_scale is not None
        f = panel.frame
        pad = 3
        x0 = max(int(np.floor(f.x0)) - pad, 0)
        x1 = min(int(np.ceil(f.x1)) + pad, gray.shape[1] - 1)
        y0 = max(int(np.ceil(f.y0)), 0)
        y1 = min(int(np.floor(f.y1)), gray.shape[0] - 1)
        mask = _curve_mask(hsv[y0 : y1 + 1, x0 : x1 + 1], gray[y0 : y1 + 1, x0 : x1 + 1], panel)
        rows = [pixel_runs(np.nonzero(mask[r])[0]) for r in range(mask.shape[0])]
        widths = [b - a + 1 for runs in rows if len(runs) == 1 for a, b in runs]
        stroke = float(np.median(widths)) if widths else 3.0
        # Where the curve starts: at the surface a CPT reads near the axis
        # minimum, so the ball is first put down on the run nearest that edge.
        min_edge = panel.frame.x0 if panel.max_value_edge == panel.frame.x1 else panel.frame.x1
        rule_width = FULL_WIDTH_RULE_SHARE * (x1 - x0)
        rows = [[ab for ab in runs if ab[1] - ab[0] < rule_width] for runs in rows]
        xs = _ball(rows, stroke, start_x=min_edge - x0)
        ys = np.arange(y0, y1 + 1, dtype=float)
        ok = np.isfinite(xs)
        px = xs[ok] + x0
        py = ys[ok]
        vertical = panel.depth_scale.values_at(py)
        depth = to_depth_below_ground(vertical, calibration)
        value = panel.value_scale.values_at(px) * panel.to_storage_factor
        edge = panel.max_value_edge
        dpi = calibration.dpi or 72.0
        clip_tol = max(CLIP_EDGE_TOLERANCE * dpi / 72.0, stroke)
        clipped = np.abs(px - edge) <= clip_tol
        d, v, c = monotonic_depth(depth, value, clipped)
        return DigitisedCurve(
            kind=panel.kind,
            depth_m=d,
            value=v,
            clipped=c,
            source=GraphKind.RASTER,
            colour=panel.curve_colour,
        )


def _curve_mask(hsv: np.ndarray, gray: np.ndarray, panel: PanelCalibration) -> np.ndarray:
    """Return the boolean mask of the panel curve's pixels."""
    colour = panel.curve_colour
    if colour is not None and is_chromatic(colour):
        return hue_mask(hsv, colour)
    # Black curve: dark pixels minus the straight grid lines under them.
    dark = gray < BLACK_CURVE_THRESHOLD
    ink = (gray < LINE_INK_THRESHOLD).astype(np.uint8)
    h, w = ink.shape
    vert = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(15, h // 8), 1), np.uint8))
    horz = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(15, w // 3)), np.uint8))
    both = np.maximum(np.asarray(vert), np.asarray(horz))
    lines = np.asarray(cv2.dilate(both, np.ones((3, 3), np.uint8))).astype(bool)
    return np.asarray(dark & ~lines)


def _ball(rows: list[list[tuple[int, int]]], stroke: float, start_x: float) -> np.ndarray:
    """Return the ball's x per row (NaN where the row shows no curve).

    Parameters
    ----------
    rows : list of list of tuple
        Pixel runs per row, in crop coordinates.
    stroke : float
        Typical stroke width (px).
    start_x : float
        Where the ball is first put down (the axis-minimum edge).

    Returns
    -------
    numpy.ndarray
        x per row, NaN on empty rows.
    """
    xs = np.full(len(rows), np.nan)
    prev: float | None = None
    wide = max(3.0 * stroke, stroke + 4.0)
    for r, runs in enumerate(rows):
        if not runs:
            continue
        p = start_x if prev is None else prev
        run = min(
            runs,
            key=lambda ab: 0.0 if ab[0] <= p <= ab[1] else min(abs(ab[0] - p), abs(ab[1] - p)),
        )
        a, b = run
        x = (a + b) / 2.0
        if b - a + 1 > wide and prev is not None:
            nxt = _next_centre(rows, r, x)
            far = b if abs(b - prev) > abs(a - prev) else a
            # The curve turns back when the next row lies on the prev side.
            if nxt is not None and abs(nxt - far) > abs(nxt - x):
                x = float(far)
        xs[r] = x
        prev = x
    return xs


def _next_centre(rows: list[list[tuple[int, int]]], r: int, x: float) -> float | None:
    """Return the centre of the next row's run nearest to ``x``, if any."""
    for nr in range(r + 1, min(r + 3, len(rows))):
        if rows[nr]:
            a, b = min(rows[nr], key=lambda ab: abs((ab[0] + ab[1]) / 2.0 - x))
            return (a + b) / 2.0
    return None
