"""RasterFrameCalibrator: calibrate a one-frame raster sheet from its OCR'd axis labels."""

from __future__ import annotations

import colorsys
from dataclasses import dataclass, replace

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
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
    FRAME_INNER_LABEL_SHARE,
    LABEL_INK_THRESHOLD,
    LINE_TOLERANCE_PT,
    MIN_TICKS_PER_RUN,
    OCR_SNAP_PITCH_SHARE,
    OCR_STRIP_SHARE,
    PHRASE_WORD_GAP_PT,
    STORED_COLUMN_BY_KIND,
    STROKE_HUE_TOLERANCE_DEG,
    TICK_COLUMN_TOLERANCE_PT,
    UNIT_PATTERN,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import is_chromatic, to_gray
from groundmodel.infrastructure.parsers.cpt.pdf.raster_panel import RasterPanel
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import parse_number
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import group_lines, phrases
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_TOP = "top"
_BOTTOM = "bottom"


@dataclass(frozen=True)
class _AxisRow:
    """One row of value-axis tick labels in one colour, above or below the frame."""

    band: str
    cy: float
    colour: tuple[float, float, float]
    scale: AxisScale


@dataclass(frozen=True)
class _AxisLabel:
    """An axis name ("qc, MPa") read near the frame, with its colour."""

    band: str
    cy: float
    kind: PanelKind
    unit: str | None
    colour: tuple[float, float, float]


class RasterFrameCalibrator(GroundModelLogger):
    """Calibrate the axes printed around ONE frame (owner ruling 2026-10-08).

    The sheet draws every quantity in one frame: qc on an axis printed above
    it, Rf on a second axis (in the real sheets just inside the top edge,
    right to left), fs on an axis below it, depth on the left. OCR reads
    the tick labels around the frame. Each value-axis row is fitted from its
    labels' centres; it is named by the axis label (``qc, MPa``) printed in
    the SAME colour as its numbers, and that colour is its curve's colour.
    The depth axis is the column of numbers nearest the frame's left edge
    that grows downward; a column that falls (the level axis, m TAW) gives
    the ground level at depth 0.

    Parameters
    ----------
    profile : LayoutProfile
        Label patterns and default units.
    ocr : OcrReader or None
        The OCR engine; None leaves a qc draft for the user's tick values.
    """

    def __init__(self, profile: LayoutProfile, ocr: OcrReader | None) -> None:
        super().__init__(__name__)
        self._profile = profile
        self._ocr = ocr

    def calibrate(
        self,
        image: np.ndarray,
        panel: RasterPanel,
        dpi: float,
        page_number: int,
        ground_level_m: float | None = None,
    ) -> PageCalibration:
        """Return the calibration of a deskewed one-frame page image.

        Parameters
        ----------
        image : numpy.ndarray
            RGB page image (deskewed).
        panel : RasterPanel
            The ``framed`` panel (``RasterFrameDetector.detect``).
        dpi : float
            Image resolution.
        page_number : int
            1-based page number.
        ground_level_m : float or None
            Ground level when the caller knows it; else read from the level
            axis when the sheet prints one.

        Returns
        -------
        PageCalibration
            One complete panel per named axis, or a qc draft when the axes
            were not read.
        """
        frame = panel.frame
        if self._ocr is None:
            self.warning("page %d: one-frame sheet without OCR: qc draft only", page_number)
            return self._draft(frame, dpi, page_number, ground_level_m)
        k = dpi / 72.0
        words = self._words(image, frame)
        depth_scale, depth_ref, level_ground = self._depth_axis(words["left"], panel, k)
        ground = ground_level_m if ground_level_m is not None else level_ground
        rows = self._rows(image, words, frame, k)
        labels = self._labels(image, words, k)
        calibrated: list[PanelCalibration] = []
        taken: set[PanelKind] = set()
        for row in sorted(rows, key=lambda r: abs(r.cy - _edge(frame, r.band))):
            label = _label_for(row, labels)
            if label is None or label.kind in taken:
                self.debug(
                    "page %d: %s axis row at y %.0f not named by a same-colour label",
                    page_number,
                    row.band,
                    row.cy,
                )
                continue
            taken.add(label.kind)
            unit = label.unit or self._profile.default_units.get(label.kind, "")
            assumptions = [
                f"ticks read by OCR ({row.band} of the frame); residual "
                f"{row.scale.max_residual:.3g}",
                "one frame: the axes are printed around it",
            ]
            calibrated.append(
                PanelCalibration(
                    kind=label.kind,
                    frame=frame,
                    value_scale=row.scale,
                    depth_scale=depth_scale,
                    unit=unit,
                    to_storage_factor=UNIT_TO_STORAGE_FACTOR.get(unit, 1.0),
                    curve_colour=row.colour if is_chromatic(row.colour) else (0.0, 0.0, 0.0),
                    source="ocr" if depth_scale is not None else "draft",
                    assumptions=tuple(assumptions),
                )
            )
        if not calibrated:
            self.warning("page %d: no value axis named on the one-frame sheet", page_number)
            return self._draft(frame, dpi, page_number, ground)
        calibration = PageCalibration.for_image(
            page_number=page_number,
            dpi=dpi,
            panels=calibrated,
            depth_reference=depth_ref,
            ground_level_m=ground,
        )
        if level_ground is not None and ground_level_m is None:
            calibration = replace(
                calibration,
                assumptions=(
                    f"ground level {level_ground:.2f} read from the level axis at depth 0",
                ),
            )
        self.info(
            "page %d one-frame calibration: %s; depth axis %s; ground %s",
            page_number,
            ", ".join(p.kind.value for p in calibrated),
            "ocr" if depth_scale is not None else "missing",
            ground,
        )
        return calibration

    def _draft(
        self, frame: FrameRect, dpi: float, page_number: int, ground: float | None
    ) -> PageCalibration:
        """Return a qc draft on the frame: the user types two ticks per axis."""
        unit = self._profile.default_units.get(PanelKind.QC, "MPa")
        draft = PanelCalibration.draft(PanelKind.QC, frame, unit)
        return PageCalibration.for_image(
            page_number=page_number,
            dpi=dpi,
            panels=[draft],
            depth_reference=DepthReference.DEPTH_BELOW_GROUND,
            ground_level_m=ground,
        )

    def _words(self, image: np.ndarray, frame: FrameRect) -> dict[str, list[PageWord]]:
        """OCR the bands above, below and left of the frame (image pixels)."""
        assert self._ocr is not None
        h, w = image.shape[:2]
        strip = int(OCR_STRIP_SHARE * h)
        inner = int(FRAME_INNER_LABEL_SHARE * h)
        regions = {
            _TOP: (0, max(0, int(frame.y0) - strip), w, min(h, int(frame.y0) + inner)),
            _BOTTOM: (0, max(0, int(frame.y1) - inner), w, min(h, int(frame.y1) + strip)),
            "left": (0, max(0, int(frame.y0) - strip // 3), int(frame.x0) + 2, int(frame.y1) + 10),
        }
        out: dict[str, list[PageWord]] = {}
        for name, (x0, y0, x1, y1) in regions.items():
            crop = image[y0:y1, x0:x1]
            words: list[PageWord] = []
            if crop.size:
                for word in self._ocr.read_image(np.ascontiguousarray(crop)):
                    words.append(
                        PageWord(word.x0 + x0, word.y0 + y0, word.x1 + x0, word.y1 + y0, word.text)
                    )
            out[name] = words
        return out

    def _rows(
        self, image: np.ndarray, words: dict[str, list[PageWord]], frame: FrameRect, k: float
    ) -> list[_AxisRow]:
        """Return the value-axis tick rows above and below the frame, one per colour."""
        rows: list[_AxisRow] = []
        pad = 0.05 * frame.width
        for band in (_TOP, _BOTTOM):
            numbers = [
                w
                for w in words[band]
                if parse_number(w.text) is not None and frame.x0 - pad <= w.cx <= frame.x1 + pad
            ]
            for line in group_lines(numbers, LINE_TOLERANCE_PT * k):
                by_colour: list[tuple[tuple[float, float, float], list[PageWord]]] = []
                for word in line:
                    colour = _ink_colour(image, word)
                    for known, group in by_colour:
                        if _same_colour(known, colour):
                            group.append(word)
                            break
                    else:
                        by_colour.append((colour, [word]))
                for colour, group in by_colour:
                    if len(group) < MIN_TICKS_PER_RUN:
                        continue
                    values = [parse_number(w.text) or 0.0 for w in group]
                    scale = AxisScale.fit_robust([w.cx for w in group], values)
                    if scale is None:
                        continue
                    cy = float(np.mean([w.cy for w in group]))
                    rows.append(_AxisRow(band=band, cy=cy, colour=colour, scale=scale))
        return rows

    def _labels(
        self, image: np.ndarray, words: dict[str, list[PageWord]], k: float
    ) -> list[_AxisLabel]:
        """Return the axis names read above and below the frame, with their colours."""
        labels: list[_AxisLabel] = []
        for band in (_TOP, _BOTTOM):
            for phrase in phrases(words[band], gap=PHRASE_WORD_GAP_PT * k):
                kind = self._profile.kind_of_label(phrase.text)
                if kind is None or kind not in STORED_COLUMN_BY_KIND:
                    continue
                unit = UNIT_PATTERN.search(phrase.text)
                labels.append(
                    _AxisLabel(
                        band=band,
                        cy=phrase.cy,
                        kind=kind,
                        unit=unit.group(0) if unit else None,
                        colour=_ink_colour(image, phrase),
                    )
                )
        return labels

    def _depth_axis(
        self, words: list[PageWord], panel: RasterPanel, k: float
    ) -> tuple[AxisScale | None, DepthReference, float | None]:
        """Fit the depth axis (and the level axis) from the number columns left of the frame."""
        numbers = [(w, v) for w in words if (v := parse_number(w.text)) is not None]
        columns: list[list[tuple[PageWord, float]]] = []
        for word, value in sorted(numbers, key=lambda wv: wv[0].x1):
            if columns and abs(word.x1 - columns[-1][-1][0].x1) <= 2 * TICK_COLUMN_TOLERANCE_PT * k:
                columns[-1].append((word, value))
            else:
                columns.append([(word, value)])
        lines = np.asarray(panel.horizontal_lines, dtype=float)
        pitch = float(np.median(np.diff(lines))) if len(lines) > 1 else 0.0
        fits: list[tuple[float, AxisScale]] = []
        for column in columns:
            if len(column) < MIN_TICKS_PER_RUN:
                continue
            coords, values = [], []
            for word, value in column:
                cy = word.cy
                if pitch:
                    nearest = float(lines[int(np.argmin(np.abs(lines - cy)))])
                    if abs(nearest - cy) <= OCR_SNAP_PITCH_SHARE * pitch:
                        cy = nearest
                coords.append(cy)
                values.append(value)
            scale = AxisScale.fit_robust(coords, values)
            if scale is not None:
                fits.append((max(w.x1 for w, _ in column), scale))
        rising = [f for f in fits if not f[1].is_decreasing]
        falling = [f for f in fits if f[1].is_decreasing]
        depth = max(rising, key=lambda f: f[0])[1] if rising else None
        level = max(falling, key=lambda f: f[0])[1] if falling else None
        if depth is not None:
            ground = round(level.value_at(depth.coord_of(0.0)), 2) if level is not None else None
            return depth, DepthReference.DEPTH_BELOW_GROUND, ground
        if level is not None:
            return level, DepthReference.ELEVATION, None
        return None, DepthReference.DEPTH_BELOW_GROUND, None


def _edge(frame: FrameRect, band: str) -> float:
    """Return the frame edge a band's labels belong to."""
    return frame.y0 if band == _TOP else frame.y1


def _label_for(row: _AxisRow, labels: list[_AxisLabel]) -> _AxisLabel | None:
    """Return the same-colour axis label of a tick row, nearest first (same band)."""
    same = [lb for lb in labels if lb.band == row.band and _same_colour(lb.colour, row.colour)]
    return min(same, key=lambda lb: abs(lb.cy - row.cy)) if same else None


def _ink_colour(image: np.ndarray, word: PageWord) -> tuple[float, float, float]:
    """Return the median colour (RGB 0..1) of the ink inside a word's box."""
    h, w = image.shape[:2]
    x0, x1 = max(int(word.x0), 0), min(int(np.ceil(word.x1)), w)
    y0, y1 = max(int(word.y0), 0), min(int(np.ceil(word.y1)), h)
    crop = image[y0:y1, x0:x1].reshape(-1, image.shape[2] if image.ndim == 3 else 1)
    if crop.size == 0:
        return (0.0, 0.0, 0.0)
    gray = to_gray(image[y0:y1, x0:x1]).reshape(-1)
    ink = crop[gray < LABEL_INK_THRESHOLD]
    if len(ink) == 0:
        return (0.0, 0.0, 0.0)
    rgb = np.median(ink, axis=0) / 255.0
    if rgb.size == 1:
        return (float(rgb[0]),) * 3
    return (float(rgb[0]), float(rgb[1]), float(rgb[2]))


def _same_colour(a: tuple[float, float, float], b: tuple[float, float, float]) -> bool:
    """Return whether two ink colours are one: both grey/black, or hues close."""
    if is_chromatic(a) != is_chromatic(b):
        return False
    if not is_chromatic(a):
        return True
    ha = colorsys.rgb_to_hsv(*a)[0] * 360.0
    hb = colorsys.rgb_to_hsv(*b)[0] * 360.0
    diff = abs(ha - hb)
    return min(diff, 360.0 - diff) <= STROKE_HUE_TOLERANCE_DEG
