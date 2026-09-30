"""PageTriage: classify every page of a report and keep the CPT graphs."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import raster_available
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_evidence import PageEvidence
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    BOREHOLE_LOG_PATTERN,
    CPT_CAPTION_PATTERN,
    CPT_KEYWORD_WEIGHTS,
    DEFAULT_CAMPAIGN_CODE_PATTERN,
    DISSIPATION_PATTERN,
    DOV_ID_PATTERN,
    GARBLED_TEXT_QUALITY,
    IMAGE_DOMINANT_COVERAGE,
    MIN_CPT_KEYWORD_SCORE,
    MIN_CURVE_SEGMENTS,
    MIN_CURVE_SEGMENTS_KNOWN_LAYOUT,
    MIN_MAP_PATHS,
    MIN_PROSE_WORDS,
    MIN_TABLE_NUMERIC_WORDS,
    MIN_TABLE_RULES,
    MIN_TEXT_LAYER_CHARS,
    RASTER_GRAPH_MIN_HORIZONTAL_LINES,
    RASTER_GRAPH_MIN_PANEL_HEIGHT,
    RASTER_TRIAGE_DPI,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_deskewer import RasterDeskewer
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid_detector import RasterGridDetector
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import render_page
from groundmodel.infrastructure.parsers.cpt.pdf.report_fingerprint import ReportFingerprint
from groundmodel.infrastructure.parsers.cpt.pdf.report_triage import ReportTriage
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import (
    horizontal_epsg,
    last_number,
    vertical_epsg,
)
from groundmodel.infrastructure.parsers.cpt.pdf.sounding_block_reader import SoundingBlockReader
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import TickRunFinder, parse_number
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_content import VectorPageContent
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader import VectorPageReader
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import text_layer_quality
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class PageTriage(GroundModelLogger):
    """Classify the pages of a test report ("trim the reports").

    Every page is measured (text layer, images, drawing commands, axis tick
    runs, CPT keywords) and classified. CPT graph pages are then split into
    the campaign's own soundings and reprinted desk-study soundings using the
    report's campaign fingerprint and the sheet's sounding block.

    Parameters
    ----------
    registry : LayoutProfileRegistry or None
        Profiles; the built-in registry when None.
    ocr : OcrReader or None
        OCR for pages whose text layer is unreadable; None disables it (the
        page then keeps whatever its garbled text layer yields). When
        omitted, OCR is used if the engine is installed.
    """

    def __init__(
        self,
        registry: LayoutProfileRegistry | None = None,
        ocr: OcrReader | None | bool = True,
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
        self._runs = TickRunFinder()
        self._block = SoundingBlockReader()
        self._deskewer = RasterDeskewer()
        self._grid = RasterGridDetector()
        # Image pages skipped because OpenCV is absent (see _raster_panels).
        self.raster_pages_unread = 0

    def classify(
        self,
        doc: pymupdf.Document,
        campaign_codes: tuple[str, ...] | None = None,
        progress: Callable[[int, int], None] | None = None,
    ) -> ReportTriage:
        """Return the verdict for every page of ``doc``.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        campaign_codes : tuple of str or None
            The campaign codes the report is about; found from the report's
            own text when None.
        progress : callable or None
            Called as ``progress(done, total)`` after every page (a long
            report takes tens of seconds; the import dialog shows the count).

        Returns
        -------
        ReportTriage
            Per-page evidence and the fingerprint used.
        """
        total = doc.page_count
        self.info("triage: %d pages", total)
        measured: list[PageEvidence] = []
        texts: list[str] = []
        for index in range(doc.page_count):
            page = doc[index]
            content = self._reader.read(page)
            texts.append(content.text)
            evidence = self._measure(page, content)
            measured.append(evidence)
            if progress is not None:
                progress(index + 1, total)
            self.debug(
                "[%d/%d] %s %s",
                evidence.page_number,
                total,
                evidence.page_class.value,
                "; ".join(evidence.reasons),
            )
        codes = campaign_codes or _campaign_codes(texts)
        fingerprint = ReportFingerprint(campaign_codes=codes)
        projects = tuple(
            sorted(
                {
                    p.project
                    for p in measured
                    if p.page_class is PageClass.CPT_GRAPH
                    and p.project
                    and fingerprint.names(p.location, p.sounding_id)
                }
            )
        )
        fingerprint = ReportFingerprint(campaign_codes=codes, project_numbers=projects)
        pages = tuple(_with_origin(p, fingerprint) for p in measured)
        result = ReportTriage(pages=pages, fingerprint=fingerprint)
        counts = {k.value: v for k, v in result.class_counts().items()}
        origins = {k.value: v for k, v in result.origin_counts().items()}
        self.success(
            "triage: %d pages, campaign %s, classes %s, CPT origins %s",
            total,
            ",".join(codes) or "-",
            counts,
            origins,
        )
        return result

    @staticmethod
    def trim(report: ReportTriage, include_desk_study: bool = False) -> list[int]:
        """Return the page numbers worth digitising.

        Parameters
        ----------
        report : ReportTriage
            A classified report.
        include_desk_study : bool
            False (default) keeps the campaign's own soundings only; True
            keeps every CPT graph page (desk study and unknown too).

        Returns
        -------
        list of int
            1-based page numbers, ascending.
        """
        keep = []
        for page in report.pages:
            if page.page_class is not PageClass.CPT_GRAPH:
                continue
            if include_desk_study or page.origin is CptOrigin.CAMPAIGN:
                keep.append(page.page_number)
        return keep

    @staticmethod
    def write_trimmed(doc: pymupdf.Document, pages: list[int], path: Path) -> Path:
        """Write a PDF holding only ``pages`` of ``doc``.

        Parameters
        ----------
        doc : pymupdf.Document
            The source report.
        pages : list of int
            1-based page numbers to keep.
        path : pathlib.Path
            Target file.

        Returns
        -------
        pathlib.Path
            The written file.
        """
        out = pymupdf.open()
        for number in pages:
            out.insert_pdf(doc, from_page=number - 1, to_page=number - 1)
        out.save(path, garbage=3, deflate=True)
        return path

    def _measure(self, page: pymupdf.Page, content: VectorPageContent) -> PageEvidence:
        """Measure one page and give its provisional class (origin comes later)."""
        number = page.number + 1
        text = content.text
        words = content.words
        numeric = sum(1 for w in words if parse_number(w.text) is not None)
        area = float(page.rect.width * page.rect.height) or 1.0
        infos = page.get_image_info()
        coverage = 0.0
        max_dpi = 0.0
        for info in infos:
            bbox = pymupdf.Rect(info["bbox"]) & page.rect
            if bbox.is_empty:
                continue
            coverage += bbox.width * bbox.height / area
            if bbox.width > 0:
                max_dpi = max(max_dpi, float(info["width"]) / (bbox.width / 72.0))
        coverage = min(coverage, 1.0)
        vertical, horizontal = content.axis_aligned()
        rules = int(vertical.sum() + horizontal.sum())
        curve_segments = _curve_segments(content, vertical | horizontal)
        runs = self._runs.find(words) if words else []
        notes: list[str] = []
        quality = text_layer_quality(words)
        meta_words = list(words)
        if (
            quality < GARBLED_TEXT_QUALITY
            and self._ocr is not None
            and len(runs) >= 2
            and curve_segments >= MIN_CURVE_SEGMENTS
        ):
            # Axis numbers survive a font without a Unicode map; the words do
            # not. OCR the title block + header to read what the layer hides.
            # The layer's own words are symbol soup: fields and names come
            # from the OCR words alone.
            meta_words = self._ocr.read_title_strips(page)
            text = " ".join(w.text for w in meta_words)
            notes.append(f"text layer unreadable (letter share {quality:.2f}): title strips OCR'd")
        score = sum(weight for pattern, weight in CPT_KEYWORD_WEIGHTS if pattern.search(text))
        profile = self._registry.match(text)
        fields = self._block.read(meta_words, profile.field_labels) if meta_words else {}
        dov = DOV_ID_PATTERN.search(text)
        base = {
            "page_number": number,
            "text_chars": len(text.strip()),
            "word_count": len(words),
            "numeric_words": numeric,
            "image_count": len(infos),
            "image_coverage": round(coverage, 3),
            "max_image_dpi": round(max_dpi),
            "segment_count": len(content.segments),
            "curve_segments": curve_segments,
            "tick_runs": len(runs),
            "cpt_score": score,
            "profile_name": profile.name,
            "sounding_id": fields.get("sounding_id"),
            "project": fields.get("project"),
            "location": fields.get("location"),
            "dov_id": dov.group(0) if dov else None,
            **_header_fields(fields, text),
        }
        prefix = tuple(notes)
        has_text = len(text.strip()) >= MIN_TEXT_LAYER_CHARS

        if not has_text:
            if not infos and len(content.segments) == 0:
                return PageEvidence(
                    page_class=PageClass.BLANK, reasons=prefix + ("empty page",), **base
                )
            if coverage >= IMAGE_DOMINANT_COVERAGE:
                panels = self._raster_panels(page)
                base["raster_panels"] = panels
                if panels:
                    return PageEvidence(
                        page_class=PageClass.CPT_GRAPH,
                        graph_kind=GraphKind.RASTER,
                        reasons=prefix
                        + (
                            f"no text layer; image covers {coverage:.0%}; "
                            f"raster grid shows {panels} graph panel(s)",
                        ),
                        **base,
                    )
                return PageEvidence(
                    page_class=PageClass.SCANNED,
                    reasons=prefix
                    + (f"no text layer; image covers {coverage:.0%}; no graph grid",),
                    **base,
                )
        if DISSIPATION_PATTERN.search(text):
            return PageEvidence(
                page_class=PageClass.DISSIPATION,
                reasons=prefix + ("dissipation test wording (DISS. TEST)",),
                **base,
            )
        known_layout = profile.fingerprint is not None
        # A continuation sheet carrying only a metre or two of curve is short;
        # a recognised layout with its axes in place needs less curve.
        min_curve = (
            MIN_CURVE_SEGMENTS_KNOWN_LAYOUT
            if known_layout and len(runs) >= 3
            else MIN_CURVE_SEGMENTS
        )
        if score >= MIN_CPT_KEYWORD_SCORE and curve_segments >= min_curve and len(runs) >= 2:
            return PageEvidence(
                page_class=PageClass.CPT_GRAPH,
                graph_kind=GraphKind.VECTOR,
                reasons=prefix
                + (
                    f"CPT keywords {score:g}; data curve of {curve_segments} segments; "
                    f"{len(runs)} axis tick runs",
                ),
                **base,
            )
        if score >= MIN_CPT_KEYWORD_SCORE and curve_segments >= MIN_CURVE_SEGMENTS and known_layout:
            # The curves are vector but the tick labels are not text (fonts
            # converted to outlines): the axes must be read by OCR.
            return PageEvidence(
                page_class=PageClass.CPT_GRAPH,
                graph_kind=GraphKind.VECTOR,
                reasons=prefix
                + (
                    f"CPT keywords {score:g}; data curve of {curve_segments} segments; "
                    f"only {len(runs)} tick runs in the text layer: axis labels need OCR",
                ),
                **base,
            )
        if coverage >= IMAGE_DOMINANT_COVERAGE and (dov or CPT_CAPTION_PATTERN.search(text)):
            panels = self._raster_panels(page)
            base["raster_panels"] = panels
            if panels:
                return PageEvidence(
                    page_class=PageClass.CPT_GRAPH,
                    graph_kind=GraphKind.RASTER,
                    reasons=prefix
                    + (
                        f"pasted image covers {coverage:.0%} under a CPT caption; "
                        f"raster grid shows {panels} graph panel(s)",
                    ),
                    **base,
                )
        if BOREHOLE_LOG_PATTERN.search(text) and len(runs) >= 1:
            return PageEvidence(
                page_class=PageClass.BOREHOLE_LOG,
                reasons=prefix + ("borehole-log wording",),
                **base,
            )
        if coverage >= IMAGE_DOMINANT_COVERAGE and len(words) < MIN_PROSE_WORDS:
            return PageEvidence(
                page_class=PageClass.PHOTO,
                reasons=prefix + (f"image covers {coverage:.0%} with {len(words)} words",),
                **base,
            )
        if numeric >= MIN_TABLE_NUMERIC_WORDS and rules >= MIN_TABLE_RULES:
            return PageEvidence(
                page_class=PageClass.TABLE,
                reasons=prefix + (f"{numeric} numbers between {rules} ruled lines",),
                **base,
            )
        if len(content.segments) >= MIN_MAP_PATHS:
            return PageEvidence(
                page_class=PageClass.MAP,
                reasons=prefix + (f"{len(content.segments)} strokes without a CPT graph",),
                **base,
            )
        if len(words) >= MIN_PROSE_WORDS:
            if rules >= MIN_TABLE_RULES:
                return PageEvidence(
                    page_class=PageClass.TABLE,
                    reasons=prefix + (f"{len(words)} words between {rules} ruled lines",),
                    **base,
                )
            return PageEvidence(
                page_class=PageClass.TEXT,
                reasons=prefix + (f"{len(words)} words of prose",),
                **base,
            )
        if number == 1:
            return PageEvidence(
                page_class=PageClass.COVER, reasons=prefix + ("first page",), **base
            )
        if len(words) < MIN_PROSE_WORDS // 2 and coverage < IMAGE_DOMINANT_COVERAGE:
            return PageEvidence(
                page_class=PageClass.DIVIDER,
                reasons=prefix + (f"only {len(words)} words (annex title / running header)",),
                **base,
            )
        return PageEvidence(page_class=PageClass.OTHER, reasons=prefix + ("no class fits",), **base)

    def _raster_panels(self, page: pymupdf.Page) -> int:
        """Return how many graph panels the raster grid detector finds.

        Zero when OpenCV (the optional ``pdf-ocr`` extra) is not installed: an
        image page cannot be looked at then, and is counted in
        ``raster_pages_unread`` so the caller can say so.
        """
        if not raster_available():
            self.raster_pages_unread += 1
            self.warning(
                "page %d: image page not read (raster reading needs the pdf-ocr extra)",
                page.number + 1,
            )
            return 0
        image = render_page(page, RASTER_TRIAGE_DPI)
        straight, _ = self._deskewer.deskew(image)
        grid = self._grid.detect(straight)
        height = straight.shape[0]
        good = [
            p
            for p in grid.panels
            if p.frame.height >= RASTER_GRAPH_MIN_PANEL_HEIGHT * height
            and len(p.horizontal_lines) >= RASTER_GRAPH_MIN_HORIZONTAL_LINES
        ]
        return len(good)


def _curve_segments(content: VectorPageContent, aligned: np.ndarray) -> int:
    """Return the largest count of non-axis-aligned segments of one stroke style."""
    if len(content.segments) == 0:
        return 0
    free = ~aligned
    if not free.any():
        return 0
    styles = np.column_stack(
        [np.round(content.colours[free], 2), np.round(content.widths[free], 2)]
    )
    _, counts = np.unique(styles, axis=0, return_counts=True)
    return int(counts.max())


def _campaign_codes(texts: list[str]) -> tuple[str, ...]:
    """Return the report's campaign code(s): the most frequent code token.

    Counted once per page, so a code repeated in a table does not outvote the
    running header that names the campaign on every page.
    """
    per_page: Counter[str] = Counter()
    for text in texts:
        per_page.update(set(DEFAULT_CAMPAIGN_CODE_PATTERN.findall(text)))
    if not per_page:
        return ()
    top = per_page.most_common(1)[0][1]
    return tuple(sorted(c for c, n in per_page.items() if n >= 0.5 * top))


def _header_fields(fields: dict[str, str], text: str) -> dict[str, object]:
    """Return the sheet-header evidence: ground level + datum, position + system, date.

    A position is kept only when both X and Y were read AND the page names the
    coordinate system; otherwise all three stay None (never guessed).
    """
    ground = SoundingBlockReader.number(fields.get("ground_level"))
    x = last_number(fields.get("x"))
    y = last_number(fields.get("y"))
    epsg = horizontal_epsg(text) if x is not None and y is not None else None
    if epsg is None:
        x = y = None
    return {
        "ground_level_m": ground,
        "z_epsg": vertical_epsg(text) if ground is not None else None,
        "x": x,
        "y": y,
        "epsg": epsg,
        "test_date": fields.get("date"),
    }


def _with_origin(page: PageEvidence, fingerprint: ReportFingerprint) -> PageEvidence:
    """Return the page with its campaign / desk-study verdict (CPT graphs only)."""
    if page.page_class is not PageClass.CPT_GRAPH:
        return page
    reasons = list(page.reasons)
    if page.profile_name == "dov" or page.dov_id:
        origin = CptOrigin.DESK_STUDY
        what = f"DOV sounding {page.dov_id}" if page.dov_id else "DOV sheet"
        reasons.append(f"desk study: {what} -> already on DOV, import from DOV instead")
    elif fingerprint.names(page.location, page.project, page.sounding_id):
        origin = CptOrigin.CAMPAIGN
        reasons.append(
            f"campaign: sounding block (location {page.location}, project {page.project}) "
            f"names {', '.join(fingerprint.campaign_codes + fingerprint.project_numbers)}"
        )
    elif page.location or page.project:
        origin = CptOrigin.DESK_STUDY
        reasons.append(
            f"desk study: sounding block names location {page.location} / project "
            f"{page.project}, not the report's campaign "
            f"{', '.join(fingerprint.campaign_codes) or '(none found)'}"
        )
    else:
        origin = CptOrigin.UNKNOWN
        reasons.append("origin unknown: no sounding block and no DOV mark")
    return PageEvidence(
        **{**page.__dict__, "origin": origin, "reasons": tuple(reasons)},
    )
