"""VectorCurveExtractor: read CPT curves exactly from a page's drawing commands."""

from __future__ import annotations

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.colour_helpers import matches_colour
from groundmodel.infrastructure.parsers.cpt.pdf.depth_conversion import to_depth_below_ground
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    ANNOTATION_EDGE_REACH_PT,
    CHAIN_GAP_PT,
    CLIP_EDGE_TOLERANCE,
    GRID_LINE_MIN_LENGTH_PT,
    MIN_CHAIN_VERTICES,
    MIN_CURVE_STROKE_WIDTH_PT,
    PDF_POINTS,
    STORED_COLUMN_BY_KIND,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import (
    drop_clip_crossings,
    monotonic_depth,
)
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import TickRunFinder, parse_number
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_content import VectorPageContent
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader import VectorPageReader
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class VectorCurveExtractor(GroundModelLogger):
    """Collect each curve's polyline vertices inside its panel frame.

    A CPT plotting program draws one vertex per scan, so the vertices of a
    vector curve are the measured values themselves (the "ball shifting" of
    the raster path is unnecessary here). A curve is recognised by its stroke
    colour (from the calibration / profile) and a minimum stroke width that
    excludes the thin grid and arrow strokes of the same colour.

    Parameters
    ----------
    min_curve_width : float
        Thinnest stroke (pt) accepted as a curve.
    """

    def __init__(self, min_curve_width: float = MIN_CURVE_STROKE_WIDTH_PT) -> None:
        super().__init__(__name__)
        self._min_width = min_curve_width
        self._reader = VectorPageReader()

    def extract(
        self,
        page: pymupdf.Page,
        calibration: PageCalibration,
        content: VectorPageContent | None = None,
    ) -> DigitisedSounding:
        """Return the digitised curves of one page.

        Parameters
        ----------
        page : pymupdf.Page
            The page the calibration belongs to.
        calibration : PageCalibration
            A PDF-point calibration.
        content : VectorPageContent or None
            Pre-read page content.

        Returns
        -------
        DigitisedSounding
            One curve per calibrated stored quantity (qc, fs, Rf, u2).

        Raises
        ------
        ValueError
            On an image-space calibration, or an elevation axis without a
            ground level.
        """
        if calibration.coordinate_space != PDF_POINTS:
            raise ValueError("vector extraction needs a PDF-point calibration")
        content = content or self._reader.read(page)
        curves: dict[PanelKind, DigitisedCurve] = {}
        for panel in calibration.panels:
            if panel.kind not in STORED_COLUMN_BY_KIND or not panel.is_complete:
                continue
            curve = self._curve(content, panel, calibration)
            if curve is None:
                self.warning(
                    "page %d: no %s curve (colour %s) inside the frame",
                    calibration.page_number,
                    panel.kind.value,
                    panel.curve_colour,
                )
                continue
            curves[panel.kind] = curve
            self.info(
                "page %d %s: %d vertices, %.2f..%.2f m, %d clipped",
                calibration.page_number,
                panel.kind.value,
                len(curve),
                curve.depth_m[0] if len(curve) else float("nan"),
                curve.depth_m[-1] if len(curve) else float("nan"),
                int(curve.clipped.sum()),
            )
        return DigitisedSounding(
            sounding_id=calibration.sounding_id,
            page_numbers=(calibration.page_number,),
            calibrations=(calibration,),
            curves=curves,
            annotations=_annotations(content, calibration),
        )

    def _curve(
        self, content: VectorPageContent, panel: PanelCalibration, calibration: PageCalibration
    ) -> DigitisedCurve | None:
        """Return one panel's curve, or None when no stroke matches."""
        assert panel.value_scale is not None and panel.depth_scale is not None
        frame = panel.frame
        seg = content.segments
        if len(seg) == 0 or panel.curve_colour is None:
            return None
        colour_ok = matches_colour(content.colours, panel.curve_colour)
        mid_x = (seg[:, 0] + seg[:, 2]) / 2
        mid_y = (seg[:, 1] + seg[:, 3]) / 2
        tol = CLIP_EDGE_TOLERANCE
        inside = (
            (mid_x >= frame.x0 - tol)
            & (mid_x <= frame.x1 + tol)
            & (mid_y >= frame.y0 - tol)
            & (mid_y <= frame.y1 + tol)
        )
        # A grid line in a colour close to the curve's (the DOV pink grid next
        # to its magenta Rf curve) is long and axis-aligned; a curve is not.
        vertical, horizontal = content.axis_aligned()
        length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
        grid_like = (vertical | horizontal) & (length >= GRID_LINE_MIN_LENGTH_PT)
        chosen = seg[colour_ok & inside & ~grid_like & (content.widths >= self._min_width)]
        if len(chosen) == 0:
            return None
        points = _chain(chosen)
        keep = (
            (points[:, 0] >= frame.x0 - tol)
            & (points[:, 0] <= frame.x1 + tol)
            & (points[:, 1] >= frame.y0 - tol)
            & (points[:, 1] <= frame.y1 + tol)
        )
        points = points[keep]
        vertical = panel.depth_scale.values_at(points[:, 1])
        depth = to_depth_below_ground(vertical, calibration)
        value = panel.value_scale.values_at(points[:, 0]) * panel.to_storage_factor
        edge = panel.max_value_edge
        clipped = np.abs(points[:, 0] - edge) <= tol
        d, v, c = drop_clip_crossings(*monotonic_depth(depth, value, clipped))
        return DigitisedCurve(
            kind=panel.kind,
            depth_m=d,
            value=v,
            clipped=c,
            source=GraphKind.VECTOR,
            colour=panel.curve_colour,
        )


def _chain(segments: np.ndarray) -> np.ndarray:
    """Turn segments in drawing order into one vertex list without repeats.

    Segments join into chains where one starts at the previous one's end. A
    short chain standing alone (a legend arrow, a tick mark in the curve's
    colour) is dropped: a data curve is one long chain, or a few long ones.
    """
    chains: list[list[tuple[float, float]]] = []
    for x0, y0, x1, y1 in segments:
        last = chains[-1][-1] if chains else None
        if last is None or abs(last[0] - x0) > CHAIN_GAP_PT or abs(last[1] - y0) > CHAIN_GAP_PT:
            chains.append([(x0, y0)])
        elif abs(last[0] - x0) > 1e-6 or abs(last[1] - y0) > 1e-6:
            chains[-1].append((x0, y0))
        chains[-1].append((x1, y1))
    kept = [pt for chain in chains if len(chain) > MIN_CHAIN_VERTICES for pt in chain]
    return np.asarray(kept, dtype=float).reshape(-1, 2)


def _annotations(
    content: VectorPageContent, calibration: PageCalibration
) -> tuple[tuple[float, str], ...]:
    """Return numbers printed inside a frame that are not tick labels.

    The Van der Straaten sheet prints the true value of a clipped qc next to
    an arrow on the frame edge ("32.53"); those values are kept as notes.
    Only words near the maximum-value edge count, so a page number or a big
    sheet label drawn inside a frame is not taken for a value.
    """
    tick_words = {id(w) for run in TickRunFinder().find(content.words) for w in run.words}
    notes: list[tuple[float, str]] = []
    for panel in calibration.panels:
        if panel.kind not in STORED_COLUMN_BY_KIND or panel.depth_scale is None:
            continue
        for word in content.words:
            if id(word) in tick_words or parse_number(word.text) is None:
                continue
            edge = panel.max_value_edge if panel.value_scale else panel.frame.x1
            near_edge = abs(word.cx - edge) <= ANNOTATION_EDGE_REACH_PT
            if panel.frame.contains(word.cx, word.cy) and near_edge:
                vertical = panel.depth_scale.value_at(word.cy)
                try:
                    depth = float(to_depth_below_ground(np.array([vertical]), calibration)[0])
                except ValueError:
                    depth = vertical
                notes.append((round(depth, 3), f"{panel.kind.value}={word.text}"))
    return tuple(sorted(set(notes)))
