"""Helpers for the graph sheet of a printed-table sounding (its "graph twin").

A printed-table report prints every sounding twice: the numeric table (the
default source of the stored series) and a graph sheet, one pasted picture of
the curves. The owner ruled the graph sheet is a CPT sheet like any other
(2026-10-12, report Z2255777: "i see the thumbnail, i should be able to set
the axes, that is a cpt"): its axes are set in the calibration overlay and
the picture reading may replace the table as the stored series. These
helpers give the overlay a frame to drag when no axis was read, and compare
the picture reading with the table.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import RASTER_DPI
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    GRAPH_COMPARISON_DECIMALS,
)
from groundmodel.infrastructure.parsers.cpt.pdf.stored_series_helpers import read_at


def picture_draft(
    page: pymupdf.Page, page_number: int, ground_level_m: float | None = None
) -> PageCalibration:
    """Return a qc draft whose frame is the page's largest picture (raster pixels).

    Used when the graph sheet's axes could not be read automatically: the
    user still gets a frame on the curves to drag onto the printed axes, and
    types two tick values per axis. The page itself when it holds no picture.

    Parameters
    ----------
    page : pymupdf.Page
        The graph sheet.
    page_number : int
        Its 1-based page number.
    ground_level_m : float or None
        The sounding's ground level (kept on the calibration).

    Returns
    -------
    PageCalibration
        One draft qc panel, in image pixels at ``RASTER_DPI``.
    """
    box = page.rect
    best = 0.0
    for info in page.get_image_info():
        rect = pymupdf.Rect(info["bbox"]) & page.rect
        if not rect.is_empty and rect.width * rect.height > best:
            best = rect.width * rect.height
            box = rect
    k = RASTER_DPI / 72.0
    frame = FrameRect(box.x0 * k, box.y0 * k, box.x1 * k, box.y1 * k)
    return PageCalibration.for_image(
        page_number=page_number,
        dpi=RASTER_DPI,
        panels=[PanelCalibration.draft(PanelKind.QC, frame, "MPa")],
        depth_reference=DepthReference.DEPTH_BELOW_GROUND,
        ground_level_m=ground_level_m,
    )


def qc_comparison(table: DigitisedSounding, graph: DigitisedSounding) -> dict[str, Any] | None:
    """Compare the qc read off the graph sheet with the printed table's qc.

    The picture's qc is read at every printed row's depth inside its own
    depth range (a straight line between its points, never across a gap);
    each difference is picture minus table.

    Parameters
    ----------
    table : DigitisedSounding
        The sounding read from its printed table.
    graph : DigitisedSounding
        The same sounding read off its graph sheet.

    Returns
    -------
    dict or None
        ``{"n", "median_abs_qc_mpa", "rms_qc_mpa"}`` (``n`` = rows compared),
        or None when either has no qc or no printed row lies on the picture's
        curve.
    """
    printed = table.curves.get(PanelKind.QC)
    read = graph.curves.get(PanelKind.QC)
    if printed is None or read is None or len(printed) == 0 or len(read) == 0:
        return None
    values, _ = read_at(read, printed.depth_m)
    diff = values - printed.value.astype(float)
    diff = diff[np.isfinite(diff)]
    if diff.size == 0:
        return None
    return {
        "n": int(diff.size),
        "median_abs_qc_mpa": round(float(np.median(np.abs(diff))), GRAPH_COMPARISON_DECIMALS),
        "rms_qc_mpa": round(float(np.sqrt(np.mean(diff**2))), GRAPH_COMPARISON_DECIMALS),
    }
