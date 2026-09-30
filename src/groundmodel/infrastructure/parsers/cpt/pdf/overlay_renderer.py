"""OverlayRenderer: draw the calibration and the digitised curves over the page."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import require_cv2
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    OVERLAY_CURVE_BGR,
    OVERLAY_FRAME_BGR,
    PDF_POINTS,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class OverlayRenderer(GroundModelLogger):
    """Render a check image: the page, each panel frame, and the read curve on top.

    The curve is drawn back through the SAME calibration it was read with, in
    a colour the sheets do not use, so any offset between the printed curve
    and the digitised one is visible at a glance.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def render(
        self,
        image: np.ndarray,
        calibration: PageCalibration,
        sounding: DigitisedSounding,
        path: Path,
        render_dpi: float | None = None,
    ) -> Path:
        """Write the overlay PNG.

        Parameters
        ----------
        image : numpy.ndarray
            RGB render of the page at ``calibration.dpi`` (image space) or at
            any dpi for a PDF-point calibration (scaled accordingly).
        calibration : PageCalibration
            The page's calibration.
        sounding : DigitisedSounding
            The curves to draw (only the depths on this page are drawn).
        path : pathlib.Path
            Output PNG.
        render_dpi : float or None
            Resolution of ``image``; required for a PDF-point calibration.

        Returns
        -------
        pathlib.Path
            The written file.
        """
        cv2 = require_cv2()
        canvas = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        factor = 1.0
        if calibration.coordinate_space == PDF_POINTS:
            if render_dpi is None:
                raise ValueError("a PDF-point calibration needs the render dpi of the image")
            factor = render_dpi / 72.0
        for panel in calibration.panels:
            f = panel.frame.scaled(factor)
            cv2.rectangle(
                canvas, (round(f.x0), round(f.y0)), (round(f.x1), round(f.y1)), OVERLAY_FRAME_BGR, 1
            )
            curve = sounding.curves.get(panel.kind)
            if curve is None or panel.value_scale is None or panel.depth_scale is None:
                continue
            vertical = (
                curve.depth_m
                if calibration.depth_reference is DepthReference.DEPTH_BELOW_GROUND
                else (calibration.ground_level_m or 0.0) - curve.depth_m
            )
            ys = panel.depth_scale.coords_of(vertical) * factor
            values = curve.value / (panel.to_storage_factor or 1.0)
            xs = panel.value_scale.coords_of(values) * factor
            on_page = (ys >= f.y0 - 1) & (ys <= f.y1 + 1)
            pts = np.column_stack([xs[on_page], ys[on_page]]).round().astype(np.int32)
            if len(pts) >= 2:
                cv2.polylines(
                    canvas, [pts.reshape(-1, 1, 2)], False, OVERLAY_CURVE_BGR, 1, cv2.LINE_AA
                )
        cv2.imwrite(str(path), canvas)
        self.debug("overlay written: %s", path)
        return path
