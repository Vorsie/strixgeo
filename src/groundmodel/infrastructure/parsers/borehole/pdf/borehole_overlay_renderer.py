"""BoreholeOverlayRenderer: draw what was read back over a borehole-log sheet."""

from __future__ import annotations

import pymupdf

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers import depth_below
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    OVERLAY_FONT_SIZE,
    OVERLAY_LABEL_RGB,
    OVERLAY_ROW_RGB,
    OVERLAY_RULE_RGB,
    OVERLAY_SAMPLE_RGB,
    OVERLAY_WIDTH_PT,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BoreholeOverlayRenderer(GroundModelLogger):
    """Render a sheet with its detected columns and rows boxed.

    The check the owner judges a parse by: the description rules in cyan,
    each level label boxed in magenta, each row's text boxed in orange with
    the depth range it was given written beside it, each sample bar in green
    with its id and depth range, and the fitted depth axis as a cyan tick
    every metre. Drawn as vector strokes on a copy of the page (PyMuPDF only,
    no OpenCV), like the CPT overlay.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def overlay_png(
        self,
        doc: pymupdf.Document,
        sheet: BoreholeSheet,
        dpi: float = 110.0,
        ground_m: float | None = None,
    ) -> bytes:
        """Return the sheet's page with what was read drawn over it.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        sheet : BoreholeSheet
            The sheet read from one of its pages.
        dpi : float
            Render resolution.
        ground_m : float or None
            The borehole's ground level, to write each row's depth range;
            the levels alone are written when None.

        Returns
        -------
        bytes
            The PNG.
        """
        source = doc[sheet.page_number - 1]
        canvas_doc = pymupdf.open()
        canvas = canvas_doc.new_page(width=source.rect.width, height=source.rect.height)
        canvas.show_pdf_page(canvas.rect, doc, source.number)
        shape = canvas.new_shape()
        x0 = sheet.columns.get("rule_x0", 0.0)
        x1 = sheet.columns.get("rule_x1", source.rect.width)
        for y in sheet.rule_ys:
            shape.draw_line((x0, y), (x1, y))
        shape.finish(color=OVERLAY_RULE_RGB, width=OVERLAY_WIDTH_PT)
        for label in sheet.labels:
            b = label.box
            shape.draw_rect(pymupdf.Rect(b.x0 - 0.5, b.y0 - 0.5, b.x1 + 0.5, b.y1 + 0.5))
        shape.finish(color=OVERLAY_LABEL_RGB, width=OVERLAY_WIDTH_PT)
        notes: list[tuple[float, float, str, tuple[float, float, float]]] = []
        for i, row in enumerate(sheet.rows):
            if row.box is not None:
                shape.draw_rect(pymupdf.Rect(*row.box) + (-1.0, -1.0, 1.0, 1.0))
            top = row.top.level_m if row.top else None
            base = row.base.level_m if row.base else None
            span = (
                f"{_fmt(depth_below(ground_m, top))}-{_fmt(depth_below(ground_m, base))} m"
                if ground_m is not None
                else f"{_fmt(top)}/{_fmt(base)}"
            )
            notes.append(
                (
                    x1 + 3.0,
                    row.rule_y + OVERLAY_FONT_SIZE + 1.0,
                    f"#{i + 1} {span}",
                    OVERLAY_ROW_RGB,
                )
            )
        shape.finish(color=OVERLAY_ROW_RGB, width=OVERLAY_WIDTH_PT)
        for mark in sheet.samples:
            shape.draw_rect(pymupdf.Rect(mark.x0 - 1.0, mark.y0, mark.x1 + 1.0, mark.y1))
            if sheet.axis is not None:
                v0, v1 = sheet.axis.value_m_at(mark.y0), sheet.axis.value_m_at(mark.y1)
                notes.append(
                    (mark.x0 - 40.0, mark.y0 - 1.0, f"{v0:.2f}-{v1:.2f}", OVERLAY_SAMPLE_RGB)
                )
        shape.finish(color=OVERLAY_SAMPLE_RGB, width=OVERLAY_WIDTH_PT)
        if sheet.axis is not None and sheet.rule_ys:
            axis = sheet.axis
            top_v = axis.value_m_at(sheet.columns.get("top_y", sheet.rule_ys[0]))
            bottom_v = axis.value_m_at(sheet.rule_ys[-1])
            lo, hi = sorted((top_v, bottom_v))
            for metre in range(int(lo) - 1, int(hi) + 2):
                y = axis.y_at(float(metre))
                if sheet.rule_ys[0] - 20 <= y <= sheet.rule_ys[-1] + 20:
                    shape.draw_line((axis.x + 2.0, y), (axis.x + 12.0, y))
            shape.finish(color=OVERLAY_RULE_RGB, width=OVERLAY_WIDTH_PT * 1.5)
        shape.commit()
        for x, y, text, colour in notes:
            canvas.insert_text((x, y), text, fontsize=OVERLAY_FONT_SIZE, color=colour)
        png: bytes = canvas.get_pixmap(dpi=round(dpi), alpha=False).tobytes("png")
        self.debug(
            "overlay page %d: %d rule(s), %d row(s), %d sample(s) at %g dpi",
            sheet.page_number,
            len(sheet.rule_ys),
            len(sheet.rows),
            len(sheet.samples),
            dpi,
        )
        return png


def _fmt(value: float | None) -> str:
    """Return a depth or level for the overlay text ("?" when unknown)."""
    return "?" if value is None else f"{value:.2f}"
