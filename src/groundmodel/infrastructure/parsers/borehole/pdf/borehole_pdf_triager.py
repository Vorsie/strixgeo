"""BoreholePdfTriager: classify every page of a borehole-log report and list its boreholes."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import replace

import pymupdf

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers import (
    depth_below,
    ground_level_of,
    header_value,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_helpers import coordinates
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile import (
    BoreholeLayoutProfile,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile_constants import (
    BOREHOLE_LAYOUT_PROFILES,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class import (
    BoreholePageClass,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_verdict import (
    BoreholePageVerdict,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    LEGEND_PATTERN,
    MIN_DRAWINGS_FOR_CONTENT,
    MIN_TEXT_LAYER_CHARS,
    OCR_PAGE_DPI,
    PHOTO_IMAGE_COVERAGE,
    PHOTO_MAX_CHARS,
    TITLE_TOP_SHARE,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_report_digest import (
    BoreholeReportDigest,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_reader import (
    BoreholeSheetReader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_triage_result import (
    BoreholeTriageResult,
)
from groundmodel.infrastructure.parsers.borehole.pdf.page_word_helpers import text_layer_words
from groundmodel.infrastructure.parsers.borehole.pdf.report_borehole import ReportBorehole
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache import OcrWordCache
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import GARBLED_TEXT_QUALITY
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import sheet_date_iso
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import text_layer_quality
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

#: ``progress(done, total)`` after every page.
TriageProgress = Callable[[int, int], None]


class BoreholePdfTriager(GroundModelLogger):
    """Classify the pages of a borehole-log report and group its sheets.

    Per page: the text layer is measured (characters, readability), images
    and drawings are counted, and the first layout profile whose required
    words the page carries reads it. A page whose profile finds a borehole
    name (and, for a profile that reads rows, a level column) is a log sheet,
    or the continuation sheet of the borehole on the page before when it
    prints the same name. A page without a usable text layer is OCR'd when an
    OCR reader is given, otherwise it is "needs OCR": nothing about it is
    guessed.

    Parameters
    ----------
    ocr : OcrReader or None
        OCR for pages without a usable text layer; None leaves them
        "needs OCR".
    profiles : tuple of BoreholeLayoutProfile or None
        Profiles tried in order; the built-in ones when None.
    """

    def __init__(
        self,
        ocr: OcrReader | None = None,
        profiles: tuple[BoreholeLayoutProfile, ...] | None = None,
    ) -> None:
        super().__init__(__name__)
        self._ocr = ocr
        self._profiles = profiles or BOREHOLE_LAYOUT_PROFILES
        self._reader = BoreholeSheetReader()

    def triage(
        self,
        doc: pymupdf.Document,
        file_name: str,
        file_sha: str = "",
        max_pages: int | None = None,
        ocr_cache: OcrWordCache | None = None,
        progress: TriageProgress | None = None,
    ) -> BoreholeTriageResult:
        """Return the page verdicts, the boreholes and the sheets read.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        file_name : str
            Its file name (for the digest).
        file_sha : str
            SHA-256 of its bytes, when known.
        max_pages : int or None
            Triage only the first pages (a 665-page report); None = all.
        ocr_cache : OcrWordCache or None
            Where OCR'd page words are looked up first and remembered.
        progress : callable or None
            ``progress(done, total)`` after every page.

        Returns
        -------
        BoreholeTriageResult
            The digest and the sheets by page number.
        """
        total = doc.page_count if max_pages is None else min(max_pages, doc.page_count)
        self.info(
            "triage of %s: %d page(s) of %d, OCR %s",
            file_name,
            total,
            doc.page_count,
            "on" if self._ocr is not None else "off",
        )
        verdicts: list[BoreholePageVerdict] = []
        sheets: dict[int, BoreholeSheet] = {}
        ocr_pages: list[int] = []
        previous: BoreholeSheet | None = None
        session = self._ocr.session(cache=ocr_cache) if self._ocr is not None else nullcontext()
        try:
            with session:
                for index in range(total):
                    page = doc[index]
                    verdict, sheet = self._classify(page, previous)
                    if verdict.text_source == "ocr":
                        ocr_pages.append(verdict.page_number)
                    if sheet is not None:
                        sheets[verdict.page_number] = sheet
                    previous = sheet
                    verdicts.append(verdict)
                    self.debug(
                        "[%d/%d] page %d: %s%s",
                        index + 1,
                        total,
                        verdict.page_number,
                        verdict.page_class.value,
                        f" ({verdict.borehole_name})" if verdict.borehole_name else "",
                    )
                    if progress is not None:
                        progress(index + 1, total)
        finally:
            if ocr_cache is not None:
                ocr_cache.save()
        boreholes = self._group(verdicts, sheets)
        digest = BoreholeReportDigest(
            file_name=file_name,
            file_sha=file_sha,
            page_count=doc.page_count,
            pages=tuple(verdicts),
            boreholes=tuple(boreholes),
            pages_not_triaged=doc.page_count - total,
            ocr_available=self._ocr is not None,
            ocr_pages=tuple(ocr_pages),
        )
        self.success(
            "triage of %s: %d borehole(s) on %d sheet(s); classes %s; %d page(s) need OCR",
            file_name,
            len(boreholes),
            len(sheets),
            digest.class_counts,
            len(digest.needs_ocr_pages),
        )
        return BoreholeTriageResult(digest=digest, sheets=sheets)

    def _classify(
        self, page: pymupdf.Page, previous: BoreholeSheet | None
    ) -> tuple[BoreholePageVerdict, BoreholeSheet | None]:
        """Return one page's verdict and, for a log sheet, the sheet read."""
        number = page.number + 1
        words = text_layer_words(page)
        chars = sum(len(w.text) for w in words)
        coverage = _image_coverage(page)
        drawings: int = sum(len(d["items"]) for d in page.get_cdrawings())
        layer_chars = chars

        def verdict(
            page_class: BoreholePageClass,
            text_source: str,
            profile_name: str | None = None,
            name: str | None = None,
        ) -> BoreholePageVerdict:
            return BoreholePageVerdict(
                number, page_class, text_source, profile_name, name, layer_chars, coverage, drawings
            )

        readable = (
            chars >= MIN_TEXT_LAYER_CHARS and text_layer_quality(words) >= GARBLED_TEXT_QUALITY
        )
        source = "text"
        if not readable:
            holds_content = coverage > 0.0 or drawings >= MIN_DRAWINGS_FOR_CONTENT or chars > 0
            if not holds_content:
                return verdict(BoreholePageClass.BLANK, "none"), None
            if self._ocr is None:
                self.debug("page %d: no usable text layer (%d chars), needs OCR", number, chars)
                return verdict(BoreholePageClass.NEEDS_OCR, "needs-ocr"), None
            words = self._ocr.read_page_region(page, page.rect, OCR_PAGE_DPI)
            source = "ocr"
            # From here the page is judged on what OCR read (a scanned log
            # is a log, not a photo).
            chars = sum(len(w.text) for w in words)
            self.info("page %d: OCR read %d word(s)", number, len(words))
        page_text = " ".join(w.text for w in words)
        title = " ".join(w.text for w in words if w.y1 <= page.rect.height * TITLE_TOP_SHARE)
        profile = next((p for p in self._profiles if p.matches(page_text)), None)
        if profile is not None:
            sheet = self._reader.read(
                page,
                profile,
                words=words if source == "ocr" else None,
                text_source=source,
                reference=previous,
            )
            # A triage-only profile reads no rows: a page is a log when it
            # prints a name, or when its title says it is one ("Log sheet")
            # and only the name could not be read (listed with an empty name,
            # never an invented one). Report text that merely mentions a
            # "boorbeschrijving" is neither.
            titled = profile.matches(title)
            if (sheet.name and sheet.rows) or (not profile.parses_rows and (sheet.name or titled)):
                same = (
                    sheet.name is not None and previous is not None and sheet.name == previous.name
                )
                page_class = (
                    BoreholePageClass.CONTINUATION_SHEET if same else BoreholePageClass.LOG_SHEET
                )
                return verdict(page_class, source, profile.name, sheet.name), sheet
            self.debug(
                "page %d: profile %s matched but no %s",
                number,
                profile.name,
                "name" if not sheet.name else "level column",
            )
        if LEGEND_PATTERN.search(title):
            page_class = BoreholePageClass.LEGEND
        elif coverage >= PHOTO_IMAGE_COVERAGE and chars < PHOTO_MAX_CHARS:
            page_class = BoreholePageClass.PHOTO
        else:
            page_class = BoreholePageClass.OTHER
        return verdict(page_class, source), None

    def _group(
        self, verdicts: list[BoreholePageVerdict], sheets: dict[int, BoreholeSheet]
    ) -> list[ReportBorehole]:
        """Group log sheets and their continuation sheets into boreholes."""
        groups: list[list[BoreholePageVerdict]] = []
        for verdict in verdicts:
            if verdict.page_class is BoreholePageClass.LOG_SHEET:
                groups.append([verdict])
            elif verdict.page_class is BoreholePageClass.CONTINUATION_SHEET and groups:
                groups[-1].append(verdict)
        boreholes: list[ReportBorehole] = []
        for group in groups:
            listing = self._listing(group[0], group, [sheets[v.page_number] for v in group])
            earlier = next((b for b in boreholes if b.name == listing.name), None)
            if earlier is not None:
                inside = _within(listing, earlier)
                self.warning(
                    "borehole %s is printed again from page %d (%s the depth of %s)",
                    listing.name,
                    listing.pages[0],
                    "inside" if inside else "outside",
                    earlier.key,
                )
                if inside:
                    listing = replace(listing, repeat_of=earlier.key)
            boreholes.append(listing)
        return boreholes

    @staticmethod
    def _listing(
        first: BoreholePageVerdict,
        group: list[BoreholePageVerdict],
        group_sheets: list[BoreholeSheet],
    ) -> ReportBorehole:
        """Return the listing of one borehole from its sheets."""
        x, y, epsg = None, None, None
        for sheet in group_sheets:
            x, y, epsg = coordinates(sheet.header)
            if x is not None or y is not None:
                break
        ground, z_epsg, _ = ground_level_of(group_sheets)
        date_text = header_value(group_sheets, "date")
        return ReportBorehole(
            key=f"{first.borehole_name or ''}@p{first.page_number}",
            name=first.borehole_name or "",
            profile=first.profile or "",
            pages=tuple(v.page_number for v in group),
            text_verdict="ocr" if any(v.text_source == "ocr" for v in group) else "text",
            parses_rows=any(s.rows for s in group_sheets),
            x=x,
            y=y,
            epsg=epsg,
            ground_level_m=ground,
            z_epsg=z_epsg,
            date_text=date_text,
            date_iso=sheet_date_iso(date_text),
            driller=header_value(group_sheets, "driller"),
            project_code=header_value(group_sheets, "project_code"),
            project_name=header_value(group_sheets, "project_name"),
            depth_top_m=depth_below(ground, group_sheets[0].first_level_m),
            depth_base_m=depth_below(ground, group_sheets[-1].last_level_m),
        )


def _within(listing: ReportBorehole, earlier: ReportBorehole) -> bool:
    """Return whether a borehole's depth range lies inside an earlier one's."""
    if None in (
        listing.depth_top_m,
        listing.depth_base_m,
        earlier.depth_top_m,
        earlier.depth_base_m,
    ):
        return False
    return (
        earlier.depth_top_m <= listing.depth_top_m  # type: ignore[operator]
        and listing.depth_base_m <= earlier.depth_base_m  # type: ignore[operator]
    )


def _image_coverage(page: pymupdf.Page) -> float:
    """Return the share of the page covered by images (overlaps counted once per image)."""
    area = float(page.rect.width * page.rect.height) or 1.0
    covered = 0.0
    for info in page.get_image_info():
        box = pymupdf.Rect(info["bbox"]) & page.rect
        if not box.is_empty:
            covered += box.width * box.height
    return min(1.0, covered / area)
