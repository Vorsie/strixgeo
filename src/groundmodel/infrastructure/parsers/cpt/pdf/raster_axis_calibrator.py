"""RasterAxisCalibrator: calibrate a page image from its grid and OCR'd tick labels."""

from __future__ import annotations

import cv2
import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile import LayoutProfile
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_constants import (
    UNIT_TO_STORAGE_FACTOR,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    OCR_SNAP_PITCH_SHARE,
    OCR_STRIP_SHARE,
    RASTER_FALLBACK_PANEL_ORDER,
    STORED_COLUMN_BY_KIND,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid import RasterGrid
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import hue_mask, is_chromatic
from groundmodel.infrastructure.parsers.cpt.pdf.raster_panel import RasterPanel
from groundmodel.infrastructure.parsers.cpt.pdf.sounding_block_reader import SoundingBlockReader
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import parse_number
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import group_lines, phrases
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RasterAxisCalibrator(GroundModelLogger):
    """Turn a detected grid into a :class:`PageCalibration` in image pixels.

    Tick values come from OCR of the strip above each panel (value axes) and
    left of the first panel (depth axis): each number snaps to the grid line
    under it and a robust line fit discards misreads. When OCR is missing or
    unsure, the panel stays a draft whose frame and grid lines the UI shows;
    the user types two tick values per axis (see
    :meth:`PanelCalibration.from_user_ticks`).

    Parameters
    ----------
    profile : LayoutProfile
        Layout profile (curve colours, label patterns, units).
    ocr : OcrReader or None
        The OCR engine; None skips OCR (drafts only).
    """

    def __init__(self, profile: LayoutProfile, ocr: OcrReader | None) -> None:
        super().__init__(__name__)
        self._profile = profile
        self._ocr = ocr

    def calibrate(
        self,
        image: np.ndarray,
        grid: RasterGrid,
        dpi: float,
        page_number: int,
        ground_level_m: float | None = None,
    ) -> PageCalibration:
        """Return the calibration of a deskewed page image.

        Parameters
        ----------
        image : numpy.ndarray
            RGB page image (deskewed).
        grid : RasterGrid
            Its detected grid.
        dpi : float
            Image resolution.
        page_number : int
            1-based page number.
        ground_level_m : float or None
            Ground level (m TAW) when the caller knows it; else read from the
            OCR'd title block when possible.

        Returns
        -------
        PageCalibration
            Complete panels where OCR read the axes, drafts elsewhere.
        """
        panels = list(grid.panels)
        if not panels:
            raise ValueError(f"page {page_number}: no graph panel in the raster grid")
        words: list[PageWord] = []
        if self._ocr is not None:
            words = self._ocr_words(image, panels)
        depth_scale, depth_ref = self._depth_axis(words, panels[0])
        taken: set[PanelKind] = set()
        calibrated: list[PanelCalibration] = []
        for index, panel in enumerate(panels):
            kind = self._kind(panel, words, image, taken, index)
            if kind is None:
                continue
            taken.add(kind)
            value_scale = self._value_axis(words, panel)
            unit = self._profile.default_units.get(kind, "")
            colour = self._profile.curve_colours.get(kind)
            if value_scale is None or depth_scale is None:
                calibrated.append(PanelCalibration.draft(kind, panel.frame, unit, colour))
                continue
            calibrated.append(
                PanelCalibration(
                    kind=kind,
                    frame=panel.frame,
                    value_scale=value_scale,
                    depth_scale=depth_scale,
                    unit=unit,
                    to_storage_factor=UNIT_TO_STORAGE_FACTOR.get(unit, 1.0),
                    curve_colour=colour,
                    source="ocr",
                    assumptions=(f"ticks read by OCR; residual {value_scale.max_residual:.3g}",),
                )
            )
        ground = ground_level_m
        if ground is None and words:
            fields = SoundingBlockReader().read(words, self._profile.field_labels)
            ground = SoundingBlockReader.number(fields.get("ground_level"))
        calibration = PageCalibration.for_image(
            page_number=page_number,
            dpi=dpi,
            panels=calibrated,
            depth_reference=depth_ref,
            ground_level_m=ground,
        )
        self.info(
            "page %d raster calibration: %s; depth axis %s",
            page_number,
            ", ".join(f"{p.kind.value}:{p.source}" for p in calibrated),
            "ocr" if depth_scale else "missing",
        )
        return calibration

    def _ocr_words(self, image: np.ndarray, panels: list[RasterPanel]) -> list[PageWord]:
        """OCR the strip above the panels, left of them, and the title block."""
        assert self._ocr is not None
        h, w = image.shape[:2]
        top = int(min(p.frame.y0 for p in panels))
        bottom = int(max(p.frame.y1 for p in panels))
        left = int(min(p.frame.x0 for p in panels))
        strip = int(OCR_STRIP_SHARE * h)
        regions = [
            (0, max(0, top - strip), w, top + 5),  # value-axis ticks and labels
            (0, top - 5, left + 5, bottom + 5),  # depth-axis ticks
            (0, bottom, w, h),  # title block (ground level, id)
        ]
        words: list[PageWord] = []
        for x0, y0, x1, y1 in regions:
            crop = image[y0:y1, x0:x1]
            if crop.size == 0:
                continue
            for word in self._ocr.read_image(np.ascontiguousarray(crop)):
                words.append(
                    PageWord(word.x0 + x0, word.y0 + y0, word.x1 + x0, word.y1 + y0, word.text)
                )
        return words

    def _value_axis(self, words: list[PageWord], panel: RasterPanel) -> AxisScale | None:
        """Fit the value axis from the tick row nearest above the panel."""
        f = panel.frame
        above = [
            (w, v)
            for w in words
            if (v := parse_number(w.text)) is not None
            and w.cy < f.y0
            and f.x0 - panel.pitch / 2 <= w.cx <= f.x1 + panel.pitch / 2
        ]
        rows = group_lines([w for w, _ in above])
        rows = [r for r in rows if len(r) >= 3]
        if not rows:
            return None
        row = max(rows, key=lambda r: r[0].cy)  # the row closest to the frame
        value_of = {id(w): v for w, v in above}
        return _snap_fit([(w.cx, value_of[id(w)]) for w in row], panel.vertical_lines, panel.pitch)

    def _depth_axis(
        self, words: list[PageWord], panel: RasterPanel
    ) -> tuple[AxisScale | None, DepthReference]:
        """Fit the depth axis from the numbers left of the first panel."""
        f = panel.frame
        lefts = [
            (w.cy, v)
            for w in words
            if (v := parse_number(w.text)) is not None
            and w.x1 <= f.x0 + 2
            and f.y0 - 10 <= w.cy <= f.y1 + 10
        ]
        pitch = (
            float(np.median(np.diff(panel.horizontal_lines)))
            if len(panel.horizontal_lines) > 1
            else 0.0
        )
        scale = _snap_fit(lefts, panel.horizontal_lines, pitch) if pitch else None
        if scale is None:
            return None, DepthReference.DEPTH_BELOW_GROUND
        ref = DepthReference.ELEVATION if scale.is_decreasing else DepthReference.DEPTH_BELOW_GROUND
        return scale, ref

    def _kind(
        self,
        panel: RasterPanel,
        words: list[PageWord],
        image: np.ndarray,
        taken: set[PanelKind],
        index: int,
    ) -> PanelKind | None:
        """Name a panel: OCR'd label above it, else curve colour, else position."""
        f = panel.frame
        best: tuple[float, PanelKind] | None = None
        for phrase in phrases(words, gap=panel.pitch / 3):
            kind = self._profile.kind_of_label(phrase.text)
            if kind is None or kind in taken or kind not in STORED_COLUMN_BY_KIND:
                continue
            if phrase.cy >= f.y0 or not f.x0 - panel.pitch <= phrase.x0 <= f.x1:
                continue
            dist = abs(phrase.x0 - f.x0) + abs(f.y0 - phrase.cy)
            if best is None or dist < best[0]:
                best = (dist, kind)
        if best is not None:
            return best[1]
        by_colour = self._dominant_colour(panel, image, taken)
        if by_colour is not None:
            return by_colour
        remaining = [k for k in RASTER_FALLBACK_PANEL_ORDER if k not in taken]
        return remaining[0] if remaining and index < len(RASTER_FALLBACK_PANEL_ORDER) else None

    def _dominant_colour(
        self, panel: RasterPanel, image: np.ndarray, taken: set[PanelKind]
    ) -> PanelKind | None:
        """Return the profile curve colour with the most pixels in the panel."""
        f = panel.frame
        crop = image[int(f.y0) : int(f.y1), int(f.x0) : int(f.x1)]
        if crop.size == 0:
            return None
        hsv = cv2.cvtColor(np.ascontiguousarray(crop), cv2.COLOR_RGB2HSV)
        counts: list[tuple[int, PanelKind]] = []
        for kind, colour in self._profile.curve_colours.items():
            if kind in taken or not is_chromatic(colour):
                continue
            mask = hue_mask(hsv, colour)
            counts.append((int(mask.sum()), kind))
        if not counts:
            return None
        count, kind = max(counts)
        return kind if count >= f.height * 0.2 else None


def _snap_fit(
    ticks: list[tuple[float, float]], lines: tuple[float, ...], pitch: float
) -> AxisScale | None:
    """Snap OCR'd tick centres to grid lines and fit robustly."""
    coords: list[float] = []
    values: list[float] = []
    grid = np.asarray(lines, dtype=float)
    if len(grid) == 0:
        return None
    for centre, value in ticks:
        k = int(np.argmin(np.abs(grid - centre)))
        if abs(grid[k] - centre) <= OCR_SNAP_PITCH_SHARE * pitch:
            coords.append(float(grid[k]))
            values.append(value)
    return AxisScale.fit_robust(coords, values)
