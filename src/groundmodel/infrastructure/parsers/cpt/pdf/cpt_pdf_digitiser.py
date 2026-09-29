"""CptPdfDigitiser: digitise the CPT graph pages of a report, vector or raster."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    CONTINUATION_OVERLAP_M,
    GARBLED_TEXT_QUALITY,
    RASTER_DPI,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_axis_calibrator import (
    RasterAxisCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_curve_extractor import (
    RasterCurveExtractor,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_deskewer import RasterDeskewer
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid_detector import RasterGridDetector
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import render_page
from groundmodel.infrastructure.parsers.cpt.pdf.report_triage import ReportTriage
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import monotonic_depth
from groundmodel.infrastructure.parsers.cpt.pdf.vector_axis_calibrator import (
    VectorAxisCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.vector_curve_extractor import (
    VectorCurveExtractor,
)
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader import VectorPageReader
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import text_layer_quality
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CptPdfDigitiser(GroundModelLogger):
    """Headless pipeline: triage -> calibrate -> extract -> merge continuation sheets.

    Vector pages are read from their drawing commands (exact); raster pages
    (scans, pasted images) are rendered, deskewed, grid-detected, OCR-
    calibrated where possible and traced row by row. A sounding printed over
    two sheets (a page and its continuation) comes out as one sounding.

    Parameters
    ----------
    registry : LayoutProfileRegistry or None
        Layout profiles; built-in when None.
    ocr : OcrReader or None or bool
        OCR engine; True = use it when installed, False/None = never.
    """

    def __init__(
        self, registry: LayoutProfileRegistry | None = None, ocr: OcrReader | None | bool = True
    ) -> None:
        super().__init__(__name__)
        self._registry = registry or LayoutProfileRegistry.default()
        if ocr is True:
            self._ocr: OcrReader | None = OcrReader() if OcrReader.available() else None
        elif ocr is False:
            self._ocr = None
        else:
            self._ocr = ocr
        self._reader = VectorPageReader()

    def digitise_report(
        self,
        doc: pymupdf.Document,
        triage: ReportTriage | None = None,
        include_desk_study: bool = False,
    ) -> list[DigitisedSounding]:
        """Digitise every kept CPT graph page of a report.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        triage : ReportTriage or None
            A triage of ``doc``; computed when None.
        include_desk_study : bool
            Also digitise desk-study and unknown-origin pages.

        Returns
        -------
        list of DigitisedSounding
            One per sounding (continuation sheets merged), page order.
        """
        triage = triage or PageTriage(self._registry, self._ocr).classify(doc)
        pages = PageTriage.trim(triage, include_desk_study=include_desk_study)
        kinds = {p.page_number: p.graph_kind for p in triage.pages}
        self.info("digitise: %d pages", len(pages))
        soundings: list[DigitisedSounding] = []
        for i, number in enumerate(pages, start=1):
            try:
                sounding = self.digitise_page(doc, number, kinds.get(number))
            except ValueError as exc:
                self.error("[%d/%d] page %d not digitised: %s", i, len(pages), number, exc)
                continue
            self.info(
                "[%d/%d] page %d: sounding %s, curves %s",
                i,
                len(pages),
                number,
                sounding.sounding_id,
                ",".join(k.value for k in sounding.curves),
            )
            soundings.append(sounding)
        merged = _merge_continuations(soundings)
        self.success("digitise: %d pages -> %d soundings", len(soundings), len(merged))
        return merged

    def digitise_page(
        self, doc: pymupdf.Document, page_number: int, kind: GraphKind | None = None
    ) -> DigitisedSounding:
        """Digitise one page.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        page_number : int
            1-based page number.
        kind : GraphKind or None
            Vector or raster; vector when the page carries drawing curves.

        Returns
        -------
        DigitisedSounding
            The page's curves (raster drafts give a sounding without curves).
        """
        page = doc[page_number - 1]
        if kind is GraphKind.RASTER:
            return self.digitise_raster(page, page_number)
        content = self._reader.read(page)
        meta = None
        if text_layer_quality(content.words) < GARBLED_TEXT_QUALITY and self._ocr is not None:
            meta = self._ocr.read_title_strips(page)
        text = " ".join(w.text for w in (content.words if meta is None else meta))
        profile = self._registry.match(text)
        calibrator = VectorAxisCalibrator(profile)
        try:
            calibration = calibrator.calibrate(page, page_number, content, meta_words=meta)
        except ValueError as exc:
            if self._ocr is None:
                raise
            # Vector curves but no tick labels in the text layer (outlined
            # fonts): read the labels by OCR, keep the exact vector curves.
            self.warning("%s; reading the axis labels by OCR", exc)
            ocr_words = self._ocr.read_axis_strips(page)
            calibration = calibrator.calibrate(
                page, page_number, content, meta_words=meta, tick_words=ocr_words
            )
            calibration = replace(
                calibration,
                assumptions=(
                    *calibration.assumptions,
                    "tick labels read by OCR (not in text layer)",
                ),
            )
        return VectorCurveExtractor(profile.min_curve_width).extract(page, calibration, content)

    def digitise_raster(
        self,
        page: pymupdf.Page,
        page_number: int,
        image: np.ndarray | None = None,
        ground_level_m: float | None = None,
    ) -> DigitisedSounding:
        """Digitise a raster page (scan or pasted image).

        Parameters
        ----------
        page : pymupdf.Page
            The page (rendered at the raster dpi unless ``image`` is given).
        page_number : int
            1-based page number.
        image : numpy.ndarray or None
            A ready RGB image of the page at ``RASTER_DPI``.
        ground_level_m : float or None
            Ground level when known from elsewhere.

        Returns
        -------
        DigitisedSounding
            Curves of every panel whose axes were read; a sounding with the
            draft calibration and no curves when the user must calibrate.
        """
        image = render_page(page, RASTER_DPI) if image is None else image
        straight, skew = RasterDeskewer().deskew(image)
        grid = RasterGridDetector().detect(straight)
        text = page.get_text()
        profile = self._registry.match(text)
        calibration = RasterAxisCalibrator(profile, self._ocr).calibrate(
            straight, grid, RASTER_DPI, page_number, ground_level_m
        )
        if skew:
            calibration = replace(
                calibration,
                assumptions=(*calibration.assumptions, f"page deskewed by {skew:.2f} deg"),
            )
        complete = replace(
            calibration, panels=tuple(p for p in calibration.panels if p.is_complete)
        )
        if not complete.panels:
            self.warning("page %d: raster axes not read; user calibration needed", page_number)
            return DigitisedSounding(
                sounding_id=None,
                page_numbers=(page_number,),
                calibrations=(calibration,),
                curves={},
            )
        sounding = RasterCurveExtractor().extract(straight, complete)
        return replace(sounding, calibrations=(calibration,))


def _merge_continuations(soundings: list[DigitisedSounding]) -> list[DigitisedSounding]:
    """Merge consecutive pages that carry the same sounding id (a continuation sheet)."""
    merged: list[DigitisedSounding] = []
    for s in soundings:
        last = merged[-1] if merged else None
        if last is not None and _continues(last, s):
            merged[-1] = DigitisedSounding(
                sounding_id=s.sounding_id or last.sounding_id,
                page_numbers=last.page_numbers + s.page_numbers,
                calibrations=last.calibrations + s.calibrations,
                curves=_join_curves(last.curves, s.curves),
                annotations=last.annotations + s.annotations,
            )
        else:
            merged.append(s)
    return merged


def _continues(last: DigitisedSounding, page: DigitisedSounding) -> bool:
    """Return whether ``page`` is the continuation sheet of ``last``.

    Same printed id, or (when OCR could not read one of the ids) the same
    ground level and a depth range that starts where the previous one ended.
    """
    if page.sounding_id and last.sounding_id:
        return page.sounding_id == last.sounding_id
    ground_a = last.calibrations[-1].ground_level_m
    ground_b = page.calibrations[0].ground_level_m
    if ground_a is None or ground_b is None or abs(ground_a - ground_b) > 0.005:
        return False
    ends = [float(c.depth_m[-1]) for c in last.curves.values() if len(c)]
    starts = [float(c.depth_m[0]) for c in page.curves.values() if len(c)]
    if not ends or not starts:
        return False
    return min(starts) >= max(ends) - CONTINUATION_OVERLAP_M


def _join_curves(
    a: dict[PanelKind, DigitisedCurve], b: dict[PanelKind, DigitisedCurve]
) -> dict[PanelKind, DigitisedCurve]:
    """Concatenate two pages' curves per quantity, deeper page second."""
    out = dict(a)
    for kind, curve in b.items():
        first = out.get(kind)
        if first is None:
            out[kind] = curve
            continue
        d, v, c = monotonic_depth(
            np.concatenate([first.depth_m, curve.depth_m]),
            np.concatenate([first.value, curve.value]),
            np.concatenate([first.clipped, curve.clipped]),
        )
        out[kind] = replace(first, depth_m=d, value=v, clipped=c)
    return out
