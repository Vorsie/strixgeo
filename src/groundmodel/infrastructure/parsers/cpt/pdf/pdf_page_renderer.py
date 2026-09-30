"""PdfPageRenderer: page thumbnails and calibration overlays, with PyMuPDF only."""

from __future__ import annotations

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    OVERLAY_CURVE_RGB,
    OVERLAY_CURVE_WIDTH_PT,
    OVERLAY_FRAME_RGB,
    OVERLAY_FRAME_WIDTH_PT,
    PDF_POINTS,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class PdfPageRenderer(GroundModelLogger):
    """Render report pages for the import dialog.

    The overlay is the check the user calibrates against: every panel frame in
    cyan and the digitised curve drawn back through the SAME calibration it was
    read with, in orange (a colour no CPT sheet uses), on top of the page. It
    is drawn as vector strokes on a copy of the page and rendered by PyMuPDF,
    so it needs neither OpenCV nor OCR (owner 2026-09-30: OCR stays optional).
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def page_png(self, doc: pymupdf.Document, page_number: int, dpi: float) -> bytes:
        """Return one page as a PNG.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        page_number : int
            1-based page number.
        dpi : float
            Render resolution.

        Returns
        -------
        bytes
            The PNG.

        Raises
        ------
        ValueError
            When the report has no such page.
        """
        if not 1 <= page_number <= doc.page_count:
            raise ValueError(f"the report has no page {page_number} (it has {doc.page_count})")
        png: bytes = doc[page_number - 1].get_pixmap(dpi=round(dpi), alpha=False).tobytes("png")
        self.debug("page %d rendered at %g dpi: %d bytes", page_number, dpi, len(png))
        return png

    def overlay_png(
        self,
        doc: pymupdf.Document,
        calibration: PageCalibration,
        sounding: DigitisedSounding,
        dpi: float,
    ) -> bytes:
        """Return the page with its panel frames and the digitised curves drawn over it.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        calibration : PageCalibration
            The page's calibration (PDF points, or image pixels at its dpi).
        sounding : DigitisedSounding
            The curves to draw back; only the depths inside each frame are
            drawn, so a two-sheet sounding draws its own part on each sheet.
        dpi : float
            Render resolution.

        Returns
        -------
        bytes
            The PNG.
        """
        source = doc[calibration.page_number - 1]
        canvas_doc = pymupdf.open()
        canvas = canvas_doc.new_page(width=source.rect.width, height=source.rect.height)
        canvas.show_pdf_page(canvas.rect, doc, source.number)
        # Image-pixel calibrations (raster pages) are drawn back in points; the
        # small deskew rotation is not undone, so a raster overlay can sit a
        # pixel or two off on a skewed scan.
        factor = 1.0
        if calibration.coordinate_space != PDF_POINTS and calibration.dpi:
            factor = 72.0 / calibration.dpi
        shape = canvas.new_shape()
        drawn = 0
        for panel in calibration.panels:
            f = panel.frame
            shape.draw_rect(pymupdf.Rect(f.x0, f.y0, f.x1, f.y1) * factor)
            shape.finish(color=OVERLAY_FRAME_RGB, width=OVERLAY_FRAME_WIDTH_PT)
            curve = sounding.curves.get(panel.kind)
            if curve is None or panel.value_scale is None or panel.depth_scale is None:
                continue
            vertical = (
                curve.depth_m
                if calibration.depth_reference is DepthReference.DEPTH_BELOW_GROUND
                else (calibration.ground_level_m or 0.0) - curve.depth_m
            )
            ys = panel.depth_scale.coords_of(vertical)
            xs = panel.value_scale.coords_of(curve.value / (panel.to_storage_factor or 1.0))
            inside = (ys >= f.y0 - 1) & (ys <= f.y1 + 1) & np.isfinite(xs)
            points = [
                pymupdf.Point(x * factor, y * factor)
                for x, y in zip(xs[inside], ys[inside], strict=True)
            ]
            if len(points) >= 2:
                shape.draw_polyline(points)
                shape.finish(color=OVERLAY_CURVE_RGB, width=OVERLAY_CURVE_WIDTH_PT, closePath=False)
                drawn += 1
        shape.commit()
        png: bytes = canvas.get_pixmap(dpi=round(dpi), alpha=False).tobytes("png")
        self.debug(
            "overlay page %d: %d panel(s), %d curve(s) drawn at %g dpi",
            calibration.page_number,
            len(calibration.panels),
            drawn,
            dpi,
        )
        return png
