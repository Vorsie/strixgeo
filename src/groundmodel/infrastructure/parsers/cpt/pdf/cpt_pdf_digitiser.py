"""CptPdfDigitiser: digitise the CPT graph pages of a report, vector or raster."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile import LayoutProfile
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    CONTINUATION_OVERLAP_M,
    GARBLED_TEXT_QUALITY,
    PDF_POINTS,
    RASTER_DPI,
    REPEAT_START_TOLERANCE_M,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_axis_calibrator import (
    RasterAxisCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_curve_extractor import (
    RasterCurveExtractor,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_deskewer import RasterDeskewer
from groundmodel.infrastructure.parsers.cpt.pdf.raster_frame_calibrator import (
    RasterFrameCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_frame_detector import (
    RasterFrameDetector,
    framed_or_grid_panels,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid_detector import RasterGridDetector
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import render_page
from groundmodel.infrastructure.parsers.cpt.pdf.report_triage import ReportTriage
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import monotonic_keep
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_join_helpers import (
    axis_pair,
    in_sheet_gaps,
    is_axis_gap,
    join_gap,
    overlaps,
    sheets_axis_range,
)
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
        merged = merge_continuations(soundings, self)
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
        return self.digitise_raster_image(image, page.get_text(), page_number, ground_level_m)

    def digitise_raster_image(
        self,
        image: np.ndarray,
        text: str,
        page_number: int,
        ground_level_m: float | None = None,
    ) -> DigitisedSounding:
        """Digitise a rendered raster page without touching the PDF document.

        The PyMuPDF part of a raster read (render + text layer) is short; the
        rest (deskew, grid, OCR, curve tracing) is numpy and can take seconds
        per sheet. Split out so a caller can hold the PyMuPDF lock for the
        render only (the background graph-sheet read, owner 2026-10-14).

        Parameters
        ----------
        image : numpy.ndarray
            RGB image of the page at ``RASTER_DPI``.
        text : str
            The page's text layer (picks the layout profile).
        page_number : int
            1-based page number.
        ground_level_m : float or None
            Ground level when known from elsewhere.

        Returns
        -------
        DigitisedSounding
            As :meth:`digitise_raster`.
        """
        straight, skew = RasterDeskewer().deskew(image)
        grid = RasterGridDetector().detect(straight)
        profile = self._registry.match(text)
        panels = framed_or_grid_panels(
            grid, RasterFrameDetector().detect(straight, grid), straight.shape[0]
        )
        if panels and panels[0].framed:
            # ONE frame, the axes printed around it (owner ruling 2026-10-08).
            calibration = RasterFrameCalibrator(profile, self._ocr).calibrate(
                straight, panels[0], RASTER_DPI, page_number, ground_level_m
            )
        else:
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

    def digitise_with_calibration(
        self, doc: pymupdf.Document, calibration: PageCalibration
    ) -> DigitisedSounding:
        """Re-read one page through a given (user-edited) calibration.

        The calibration overlay's "Re-extract": the user dragged a frame
        corner, typed a tick value or picked the curve colour, and the curve is
        read again through exactly that calibration -- no automatic axis
        reading is redone, so what the user set is what is used.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        calibration : PageCalibration
            The page's calibration, in PDF points (vector) or image pixels
            at ``calibration.dpi`` of the deskewed render (raster).

        Returns
        -------
        DigitisedSounding
            The page's curves, carrying ``calibration``.

        Raises
        ------
        ValueError
            When a raster calibration has no complete panel yet, or the raster
            engine (the ``pdf-ocr`` extra) is not installed.
        """
        page = doc[calibration.page_number - 1]
        if calibration.coordinate_space == PDF_POINTS:
            profile = self._profile_named(calibration.profile_name)
            sounding = VectorCurveExtractor(profile.min_curve_width).extract(page, calibration)
        else:
            complete = replace(
                calibration, panels=tuple(p for p in calibration.panels if p.is_complete)
            )
            if not complete.panels:
                raise ValueError(
                    f"page {calibration.page_number}: no panel has two tick values per axis yet"
                )
            image = render_page(page, round(calibration.dpi or RASTER_DPI))
            straight, _ = RasterDeskewer().deskew(image)
            sounding = replace(
                RasterCurveExtractor().extract(straight, complete), calibrations=(calibration,)
            )
        self.info(
            "page %d re-read through the given calibration: curves %s",
            calibration.page_number,
            ",".join(k.value for k in sounding.curves) or "-",
        )
        return sounding

    def _profile_named(self, name: str) -> LayoutProfile:
        """Return the registry profile called ``name`` (generic when unknown)."""
        for profile in self._registry.profiles:
            if profile.name == name:
                return profile
        return self._registry.match("")


def join_sheets(sheets: list[DigitisedSounding]) -> DigitisedSounding:
    """Fold the sheets of ONE sounding into one sounding, shallowest sheet first.

    Unlike :func:`merge_continuations` this does not decide whether sheets
    belong together: the caller knows (the sheets of a listed sounding).

    Parameters
    ----------
    sheets : list of DigitisedSounding
        The sheets, one per page, in any order.

    Returns
    -------
    DigitisedSounding
        One sounding; pages, calibrations and annotations in depth order.

    Raises
    ------
    ValueError
        When ``sheets`` is empty.
    """
    if not sheets:
        raise ValueError("no sheets to join")
    ordered = sorted(sheets, key=lambda s: (_depth_range(s) or (float("inf"), 0.0))[0])
    joined = ordered[0]
    for sheet in ordered[1:]:
        joined = _join_sheet(joined, sheet, joined.sounding_id or sheet.sounding_id)
    return joined


def merge_continuations(
    soundings: list[DigitisedSounding],
    logger: GroundModelLogger | None = None,
    repeats: list[tuple[DigitisedSounding, DigitisedSounding]] | None = None,
) -> list[DigitisedSounding]:
    """Merge continuation sheets into their sounding; drop repeated sheets.

    A continuation usually follows its first sheet, but a report can print
    another sheet in between (CAMZ-001: 68 on p. 214, a repeat of 66's first
    sheet on p. 215, 68's continuation on p. 216). So a sheet with a known id
    joins the earlier sounding of that id whose depth it continues, and a
    sheet that starts where that sounding started, or that lies wholly inside
    the depth that sounding already covers, is a repeat and is dropped
    (owner 2026-09-30: "a sheet printed twice is dropped with a notice"). The
    second test catches a whole two-sheet sounding printed twice (CAMZ-001
    2.3: sounding 150 on pp. 265-266 and again on pp. 267-268): the repeat of
    its second sheet does not start at 0 m, but brings no depth of its own.

    Parameters
    ----------
    soundings : list of DigitisedSounding
        One per page, in page order.
    logger : GroundModelLogger or None
        Receives a warning per dropped repeat.
    repeats : list or None
        When given, receives ``(dropped_sheet, kept_sounding)`` per dropped
        repeat, so the caller can name it in its notice.

    Returns
    -------
    list of DigitisedSounding
        One per sounding, in order of first appearance.
    """
    merged: list[DigitisedSounding] = []
    for s in soundings:
        last = merged[-1] if merged else None
        target: int | None = None
        if last is not None and _continues(last, s):
            target = len(merged) - 1
        elif s.sounding_id:
            for i in range(len(merged) - 1, -1, -1):
                earlier = merged[i]
                if earlier.sounding_id != s.sounding_id:
                    continue
                if _repeats(earlier, s):
                    if logger is not None:
                        logger.warning(
                            "page %s repeats sounding %s (pages %s): dropped",
                            s.page_numbers,
                            s.sounding_id,
                            earlier.page_numbers,
                        )
                    if repeats is not None:
                        repeats.append((s, earlier))
                    target = -1
                elif _depth_continues(earlier, s):
                    target = i
                break
        if target is None:
            merged.append(s)
        elif target >= 0:
            m = merged[target]
            merged[target] = _join_sheet(m, s, s.sounding_id or m.sounding_id, logger)
    return merged


def _join_sheet(
    upper: DigitisedSounding,
    sheet: DigitisedSounding,
    sounding_id: str | None,
    logger: GroundModelLogger | None = None,
) -> DigitisedSounding:
    """Append continuation ``sheet`` below ``upper`` and read the seam from the printed axes.

    Owner direction (2026-10-07): "you can just look at start-depth on page 1
    and end depth on page 2 based on the axes". The join is recorded as the
    axis pair ``(D1, D2)`` in ``sheet_joins_m``: D1 is where the upper
    sheet's printed depth axis ends, D2 where the continuation's starts.

    * D2 <= D1 (the sheets overlap on [D2, D1]): the gap the two drawings
      leave between them, inside that overlap or across the sheet boundary,
      is a plotting artefact of the join and goes to ``seam_gaps_m``, never
      drilled.
    * D2 > D1: no axis covers [D1, D2]. It is unknown, not drilled: it goes to
      ``sheet_axis_gaps_m`` (and the join gap to ``seam_gaps_m``).
    * A pen lift INSIDE one sheet's own axis range stays overboring, exactly
      as on one sheet: the upper curve stops while its axis runs on (sounding
      80: 31.2 m against an axis to ~33 m), the continuation starts below its
      own axis top, or lifts its own pen across the join (76b).

    When a sheet's axis was not read, no join is recorded and the gap stays
    drilled: nothing says it is the join. The joined values are not changed.

    Parameters
    ----------
    upper : DigitisedSounding
        The sheet(s) joined so far.
    sheet : DigitisedSounding
        The continuation sheet, deeper.
    sounding_id : str or None
        The id the joined sounding carries.
    logger : GroundModelLogger or None
        Receives one DEBUG line per join read.

    Returns
    -------
    DigitisedSounding
        One sounding over both.
    """
    curves = _join_curves(upper.curves, sheet.curves)
    join: tuple[tuple[float, float], ...] = ()
    axis_gap: tuple[tuple[float, float], ...] = ()
    seam: tuple[tuple[float, float], ...] = ()
    above = sheets_axis_range(upper.calibrations)
    below = sheets_axis_range(sheet.calibrations)
    if above is not None and below is not None:
        d1, d2 = axis_pair(above[1], below[0])
        join = ((d1, d2),)
        if is_axis_gap(d1, d2):
            axis_gap = ((d1, d2),)
        seam = _seam_gap(upper.curves.get(PanelKind.QC), sheet.curves.get(PanelKind.QC), d1, d2)
        if logger is not None:
            logger.debug(
                "sounding %s: sheet join axis %.3f -> %.3f m, axis gap %s, join gap %s",
                sounding_id,
                d1,
                d2,
                bool(axis_gap),
                seam[0] if seam else "none or drilled",
            )
    elif logger is not None:
        logger.debug(
            "sounding %s: sheet join on pages %s has no read depth axis: gap kept as is",
            sounding_id,
            sheet.page_numbers,
        )
    return DigitisedSounding(
        sounding_id=sounding_id,
        page_numbers=upper.page_numbers + sheet.page_numbers,
        calibrations=upper.calibrations + sheet.calibrations,
        curves=curves,
        annotations=upper.annotations + sheet.annotations,
        sheet_joins_m=upper.sheet_joins_m + join + sheet.sheet_joins_m,
        seam_gaps_m=upper.seam_gaps_m + seam + sheet.seam_gaps_m,
        sheet_axis_gaps_m=upper.sheet_axis_gaps_m + axis_gap + sheet.sheet_axis_gaps_m,
    )


def _seam_gap(
    upper: DigitisedCurve | None, sheet: DigitisedCurve | None, d1: float, d2: float
) -> tuple[tuple[float, float], ...]:
    """Return the qc join gap when it is the join's own artefact, read from the axes.

    The gap between the last upper vertex and the next kept continuation
    vertex is the join's artefact unless a sheet leaves part of it undrawn
    inside its own printed axis (an in-sheet pen lift: drilled).

    Parameters
    ----------
    upper : DigitisedCurve or None
        The qc curve above the join.
    sheet : DigitisedCurve or None
        The qc curve of the continuation sheet.
    d1 : float
        The upper sheet's axis end (m).
    d2 : float
        The continuation sheet's axis start (m).

    Returns
    -------
    tuple of tuple of float
        ``((top_m, base_m),)`` to the millimetre, or empty.
    """
    if upper is None or sheet is None or upper.no_bridge() is None:
        return ()
    gap = join_gap(upper, sheet)
    if gap is None or overlaps(gap, in_sheet_gaps(upper, sheet, d1, d2)):
        return ()
    return (axis_pair(*gap),)


def _depth_range(s: DigitisedSounding) -> tuple[float, float] | None:
    """Return the shallowest start and deepest end over a sounding's curves."""
    curves = [c for c in s.curves.values() if len(c)]
    if not curves:
        return None
    return min(float(c.depth_m[0]) for c in curves), max(float(c.depth_m[-1]) for c in curves)


def _depth_continues(earlier: DigitisedSounding, page: DigitisedSounding) -> bool:
    """Return whether ``page`` starts where ``earlier`` ends (a continuation)."""
    a, b = _depth_range(earlier), _depth_range(page)
    return a is not None and b is not None and b[0] >= a[1] - CONTINUATION_OVERLAP_M


def _starts_like(earlier: DigitisedSounding, page: DigitisedSounding) -> bool:
    """Return whether ``page`` starts at the depth ``earlier`` starts (a repeat)."""
    a, b = _depth_range(earlier), _depth_range(page)
    return a is not None and b is not None and abs(a[0] - b[0]) <= REPEAT_START_TOLERANCE_M


def _covered(earlier: DigitisedSounding, page: DigitisedSounding) -> bool:
    """Return whether ``page`` lies wholly inside the depth ``earlier`` covers."""
    a, b = _depth_range(earlier), _depth_range(page)
    return (
        a is not None
        and b is not None
        and b[0] >= a[0] - REPEAT_START_TOLERANCE_M
        and b[1] <= a[1] + REPEAT_START_TOLERANCE_M
    )


def _repeats(earlier: DigitisedSounding, page: DigitisedSounding) -> bool:
    """Return whether ``page`` (same id) is a reprint of a sheet ``earlier`` holds.

    A repeated first sheet starts where the sounding started; a repeated
    later sheet lies inside the depth the sounding already covers. Either way
    it adds nothing, while a continuation runs deeper.
    """
    return _starts_like(earlier, page) or _covered(earlier, page)


def _continues(last: DigitisedSounding, page: DigitisedSounding) -> bool:
    """Return whether ``page`` is the continuation sheet of ``last``.

    Same printed id, or (when OCR could not read one of the ids) the same
    ground level and a depth range that starts where the previous one ended.
    """
    if page.sounding_id and last.sounding_id:
        return page.sounding_id == last.sounding_id and _depth_continues(last, page)
    ground_a = last.calibrations[-1].ground_level_m
    ground_b = page.calibrations[0].ground_level_m
    if ground_a is None or ground_b is None or abs(ground_a - ground_b) > 0.005:
        return False
    ends = [float(c.depth_m[-1]) for c in last.curves.values() if len(c)]
    starts = [float(c.depth_m[0]) for c in page.curves.values() if len(c)]
    if not ends or not starts:
        return False
    return min(starts) >= max(ends) - CONTINUATION_OVERLAP_M


def _joined_chain(
    first: DigitisedCurve, second: DigitisedCurve, keep: np.ndarray
) -> np.ndarray | None:
    """Return the stroke ids of two joined sheets: the deeper sheet's strokes are new ones.

    A sheet change is a stroke change too, but the continuation repeats the
    last metre of the sheet before, so no depth jump (no drilled stretch)
    appears there unless the sounding really was drilled across it.
    """
    known = [c.chain is not None and len(c.chain) == len(c) for c in (first, second)]
    if not all(known):
        # A curve whose strokes are not known (raster, or rebuilt without
        # them) joins as one stroke: no pen lift can be claimed.
        return None
    assert first.chain is not None and second.chain is not None
    offset = int(first.chain.max()) + 1 if len(first.chain) else 0
    joined: np.ndarray = np.concatenate([first.chain, second.chain + offset])[keep]
    return joined


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
        depth = np.concatenate([first.depth_m, curve.depth_m])
        value = np.concatenate([first.value, curve.value])
        keep = monotonic_keep(depth, value)
        out[kind] = replace(
            first,
            depth_m=depth[keep],
            value=value[keep],
            clipped=np.concatenate([first.clipped, curve.clipped])[keep],
            chain=_joined_chain(first, curve, keep),
        )
    return out
