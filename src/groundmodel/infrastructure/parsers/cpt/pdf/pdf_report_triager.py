"""PdfReportTriager: triage a whole report and digitise the soundings it offers."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from typing import Any, TypeVar

import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.coordinate_extent_helpers import (
    position_outside_extent,
)
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import (
    CptPdfDigitiser,
    merge_continuations,
)
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.dropped_sheet import DroppedSheet
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache import OcrWordCache
from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import ocr_available
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_evidence import PageEvidence
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_digitiser import (
    PrintedTableDigitiser,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_report import PrintedTableReport
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_report_reader import (
    PrintedTableReportReader,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_sounding import PrintedTableSounding
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note import ReportSoundingNote
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note_constants import (
    NOTE_CLIPPED_POINTS,
    NOTE_COORDINATE_OUT_OF_RANGE,
    NOTE_DRILLED_INTERVALS,
    NOTE_ELEVATION_AXIS,
    NOTE_ELEVATION_AXIS_NO_GROUND_LEVEL,
    NOTE_NO_POSITION_PRINTED,
    NOTE_PRE_DRILL_FLOOR_ROWS,
    NOTE_READ_FROM_IMAGE,
    NOTE_READ_FROM_PRINTED_TABLE,
    NOTE_SHEET_AXIS_GAP,
    NOTE_TABLE_RF_MISMATCH,
    NOTE_TABLE_ROWS_REJECTED,
    NOTE_TICKS_NOT_READ,
    NOTE_TICKS_UNAVAILABLE_NO_OCR,
)
from groundmodel.shared.exceptions import TriageCancelled
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_T = TypeVar("_T")

#: ``progress(phase, done, total, ocr=...)`` -- phase is "classify" or
#: "digitise"; ``ocr`` (keyword, default False) is True while OCR is what the
#: triage is doing, the slow part of a report with an unreadable text layer.
TriageProgress = Callable[..., None]


class PdfReportTriager(GroundModelLogger):
    """Classify every page, set desk-study and repeated sheets aside, digitise the rest.

    The import dialog needs, in one pass: the campaign soundings (id, pages,
    ground level, position when printed, sheet count, warnings), the sheets of
    unknown origin the user may tick, and what was set aside and why. The
    vector path is fast (CAMZ-001: 161 graph pages in ~25 s), so every
    campaign and unknown sheet is digitised here; later calls reuse the
    curves instead of reading the report again.

    Parameters
    ----------
    registry : LayoutProfileRegistry or None
        Layout profiles; the built-in registry when None.
    ocr : OcrReader or None or bool
        True = use OCR when the optional ``pdf-ocr`` extra is installed,
        False/None = never, or a ready reader.
    """

    def __init__(
        self,
        registry: LayoutProfileRegistry | None = None,
        ocr: OcrReader | None | bool = True,
    ) -> None:
        super().__init__(__name__)
        self._registry = registry or LayoutProfileRegistry.default()
        if ocr is True:
            self._ocr: OcrReader | None = OcrReader() if ocr_available() else None
        elif ocr is False:
            self._ocr = None
        else:
            self._ocr = ocr
        self._triage = PageTriage(self._registry, self._ocr)
        self._digitiser = CptPdfDigitiser(self._registry, self._ocr)
        self._tables = PrintedTableReportReader()
        self._table_digitiser = PrintedTableDigitiser()

    @property
    def digitiser(self) -> CptPdfDigitiser:
        """Return the digitiser (same profiles and OCR engine as the triage)."""
        return self._digitiser

    def run(
        self,
        doc: pymupdf.Document,
        file_sha: str,
        progress: TriageProgress | None = None,
        should_stop: Callable[[], bool] | None = None,
        ocr_cache: OcrWordCache | None = None,
    ) -> tuple[PdfReportDigest, dict[str, DigitisedSounding]]:
        """Triage ``doc`` and digitise the soundings it offers.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        file_sha : str
            SHA-256 of the report file, carried into the digest.
        progress : callable or None
            ``progress(phase, done, total, ocr=...)``; ``ocr`` True while OCR
            is what the triage is doing.
        should_stop : callable or None
            Checked between pages, between sheets and between OCR strips;
            True stops the triage (the user cancelled).
        ocr_cache : OcrWordCache or None
            The report's OCR words (the store keeps them next to the file);
            an in-memory cache for this run when None, so the digitise pass
            never OCRs a strip the classify pass already read.

        Returns
        -------
        tuple
            ``(digest, soundings)``: the digest for the UI and the digitised
            soundings by their key (campaign and unknown alike).

        Raises
        ------
        TriageCancelled
            When ``should_stop`` answered True.
        """
        self.info("report triage: %d pages (OCR %s)", doc.page_count, bool(self._ocr))
        cache = ocr_cache if ocr_cache is not None else OcrWordCache()
        session: AbstractContextManager[object] = (
            self._ocr.session(cache=cache, should_stop=should_stop)
            if self._ocr is not None
            else nullcontext()
        )
        try:
            with session:
                return self._run(doc, file_sha, progress, should_stop)
        finally:
            if self._ocr is not None and (cache.hits or cache.misses):
                self.info("OCR cache: %d hit / %d miss", cache.hits, cache.misses)

    def _run(
        self,
        doc: pymupdf.Document,
        file_sha: str,
        progress: TriageProgress | None,
        should_stop: Callable[[], bool] | None,
    ) -> tuple[PdfReportDigest, dict[str, DigitisedSounding]]:
        """Run the classify and digitise passes (inside the OCR session)."""

        def classify_tick(done: int, total: int, ocr: bool = False) -> None:
            """Forward a page tick under the ``classify`` phase."""
            if progress is not None:
                progress("classify", done, total, ocr=ocr)

        report = self._triage.classify(doc, progress=classify_tick, should_stop=should_stop)
        # A sounding the report also prints as a numeric table is read from
        # the table (owner 2026-10-08: "the printed table wins"); its graph
        # sheets are its picture, never digitised.
        tables = self._tables.read(doc, should_stop)
        claimed = tables.claimed_pages
        evidence = {p.page_number: p for p in report.pages}
        graphs = [
            p
            for p in report.pages
            if p.page_class is PageClass.CPT_GRAPH and p.page_number not in claimed
        ]
        dropped = [_desk_study(p) for p in graphs if p.origin is CptOrigin.DESK_STUDY]
        wanted = [p for p in graphs if p.origin is not CptOrigin.DESK_STUDY]

        per_origin: dict[CptOrigin, list[DigitisedSounding]] = {
            CptOrigin.CAMPAIGN: [],
            CptOrigin.UNKNOWN: [],
        }
        for i, page in enumerate(wanted, start=1):
            if should_stop is not None and should_stop():
                self.info("triage cancelled after sheet %d of %d", i - 1, len(wanted))
                raise TriageCancelled(i - 1, len(wanted))
            calls_before = self._ocr.engine_calls if self._ocr is not None else 0
            try:
                sheet = self._digitiser.digitise_page(doc, page.page_number, page.graph_kind)
            except ValueError as exc:
                self.error(
                    "[%d/%d] page %d not digitised: %s", i, len(wanted), page.page_number, exc
                )
                dropped.append(_unread(page, str(exc)))
            else:
                self.debug("[%d/%d] page %d digitised", i, len(wanted), page.page_number)
                per_origin[page.origin or CptOrigin.UNKNOWN].append(sheet)
            if progress is not None:
                used_ocr = self._ocr is not None and self._ocr.engine_calls > calls_before
                progress("digitise", i, len(wanted), ocr=used_ocr)

        keys: set[str] = set()
        listed: dict[CptOrigin, list[ReportSounding]] = {}
        soundings: dict[str, DigitisedSounding] = {}
        for origin, sheets in per_origin.items():
            repeats: list[tuple[DigitisedSounding, DigitisedSounding]] = []
            merged = merge_continuations(sheets, self, repeats)
            dropped.extend(_duplicate(sheet, kept) for sheet, kept in repeats)
            listed[origin] = []
            for sounding in merged:
                key = _unique_key(sounding, keys)
                entry = _report_sounding(
                    key,
                    origin,
                    sounding,
                    evidence,
                    self._ocr is not None,
                    campaign_code=_first(list(report.fingerprint.campaign_codes)),
                    logger=self,
                )
                self.debug("sounding %s: notes %s", key, [n.code for n in entry.notes])
                listed[origin].append(entry)
                soundings[key] = sounding

        for table in tables.soundings:
            sounding = self._table_digitiser.to_sounding(table, tables.epsg, tables.z_epsg)
            key = _unique_key(sounding, keys)
            listed[CptOrigin.CAMPAIGN].append(
                _table_report_sounding(
                    key,
                    table,
                    sounding,
                    tables,
                    campaign_code=_first(list(report.fingerprint.campaign_codes)),
                    logger=self,
                )
            )
            soundings[key] = sounding
        if tables.soundings:
            listed[CptOrigin.CAMPAIGN].sort(key=lambda s: s.page_numbers[0])

        digest = PdfReportDigest(
            file_sha=file_sha,
            page_count=doc.page_count,
            class_counts={k.value: v for k, v in report.class_counts().items()},
            campaign=tuple(listed[CptOrigin.CAMPAIGN]),
            unknown=tuple(listed[CptOrigin.UNKNOWN]),
            dropped=tuple(sorted(dropped, key=lambda d: d.page_numbers)),
            fingerprint=report.fingerprint,
            ocr_available=self._ocr is not None,
            raster_pages_unread=self._triage.raster_pages_unread,
            profiles=tuple(
                sorted(
                    {p.profile_name for p in graphs}
                    | ({tables.profile_name} if tables.soundings else set())
                )
            ),
        )
        self.success(
            "report triage: %d campaign + %d unknown soundings, %d desk-study sheets, "
            "%d set aside in all",
            len(digest.campaign),
            len(digest.unknown),
            sum(1 for d in digest.dropped if d.reason == "desk-study"),
            len(digest.dropped),
        )
        return digest, soundings


def _desk_study(page: PageEvidence) -> DroppedSheet:
    """Return the notice for a desk-study reprint (DOV or another project)."""
    name = page.dov_id or page.sounding_id or f"page {page.page_number}"
    where = "DOV" if page.dov_id or page.profile_name == "dov" else "its own project"
    return DroppedSheet(
        sounding_id=name,
        page_numbers=(page.page_number,),
        reason="desk-study",
        note=f"desk-study reprint: look {name} up in {where}",
    )


def _unread(page: PageEvidence, why: str) -> DroppedSheet:
    """Return the notice for a sheet the digitiser could not read."""
    return DroppedSheet(
        sounding_id=page.sounding_id or f"page {page.page_number}",
        page_numbers=(page.page_number,),
        reason="unread",
        note=f"not read: {why}",
    )


def _duplicate(sheet: DigitisedSounding, kept: DigitisedSounding) -> DroppedSheet:
    """Return the notice for a sheet printed a second time."""
    pages = ", ".join(str(n) for n in kept.page_numbers)
    return DroppedSheet(
        sounding_id=sheet.sounding_id or f"page {sheet.page_numbers[0]}",
        page_numbers=sheet.page_numbers,
        reason="duplicate",
        note=f"printed twice: the sheet on page {pages} is kept",
    )


def _unique_key(sounding: DigitisedSounding, taken: set[str]) -> str:
    """Return a report-unique key: the printed id, else ``page-<first page>``."""
    key = sounding.sounding_id or f"page-{sounding.page_numbers[0]}"
    if key in taken:
        key = f"{key}@p{sounding.page_numbers[0]}"
    taken.add(key)
    return key


def _first(values: list[_T | None]) -> _T | None:
    """Return the first value that is not None."""
    return next((v for v in values if v is not None), None)


def _report_sounding(
    key: str,
    origin: CptOrigin,
    sounding: DigitisedSounding,
    evidence: dict[int, PageEvidence],
    ocr: bool,
    campaign_code: str | None = None,
    logger: GroundModelLogger | None = None,
) -> ReportSounding:
    """Combine a merged sounding with its sheets' header evidence and warnings.

    ``campaign_code`` is the report's campaign code, the stand-in project id
    of a sounding whose sheets print no project number. ``logger`` receives
    the DEBUG line per gap dropped at a sheet join.
    """
    pages = [evidence[n] for n in sounding.page_numbers if n in evidence]
    ground = _first([p.ground_level_m for p in pages])
    if ground is None:
        ground = _first([c.ground_level_m for c in sounding.calibrations])
    placed = next((p for p in pages if p.x is not None and p.epsg is not None), None)
    kind = pages[0].graph_kind if pages and pages[0].graph_kind else GraphKind.VECTOR
    clipped = sum(int(c.clipped.sum()) for c in sounding.curves.values())
    elevation = any(c.depth_reference is DepthReference.ELEVATION for c in sounding.calibrations)
    # Each note travels twice: as an English sentence (``warnings``, what
    # older clients render) and as a code + params (``notes``, rendered by the
    # desktop in the app language). One append keeps the two lists aligned.
    warnings: list[str] = []
    notes: list[ReportSoundingNote] = []

    def note(code: str, english: str, **params: Any) -> None:
        """Record one note as its English sentence and as its code + params."""
        warnings.append(english)
        notes.append(ReportSoundingNote(code=code, params=params))

    if not sounding.curves:
        if ocr:
            note(NOTE_TICKS_NOT_READ, "axis values not read: type two tick values per axis")
        else:
            note(NOTE_TICKS_UNAVAILABLE_NO_OCR, "tick reading unavailable: type the axis values")
    if placed is None:
        note(NOTE_NO_POSITION_PRINTED, "no position printed: type X and Y before importing")
    elif (
        placed.x is not None
        and placed.y is not None
        and position_outside_extent(placed.x, placed.y, placed.epsg)
    ):
        # The sheet itself can print a typo (owner finding 2026-10-08, S28A:
        # Y 2244433.030); the value is kept as printed, the row asks for a check.
        if logger is not None:
            logger.warning(
                f"sounding {key}: printed position ({placed.x}, {placed.y}) lies outside "
                f"the extent of EPSG {placed.epsg}"
            )
        note(
            NOTE_COORDINATE_OUT_OF_RANGE,
            "coordinate outside the range of its system: check the sheet header",
            x=placed.x,
            y=placed.y,
            epsg=placed.epsg,
        )
    if elevation:
        if ground is not None:
            note(
                NOTE_ELEVATION_AXIS,
                "elevation axis: depth = printed ground level - plotted elevation",
            )
        else:
            note(
                NOTE_ELEVATION_AXIS_NO_GROUND_LEVEL,
                "elevation axis without a printed ground level: type the ground level",
            )
    if clipped:
        note(
            NOTE_CLIPPED_POINTS,
            f"{clipped} point(s) on an axis maximum: the true value is higher",
            count=clipped,
        )
    drilled = [[top, base] for top, base in sounding.drilled_intervals(logger)]
    if drilled:
        listed = ", ".join(f"{top:.1f} to {base:.1f} m" for top, base in drilled)
        note(
            NOTE_DRILLED_INTERVALS,
            f"drilled: {listed}",
            intervals=drilled,
            count=len(drilled),
        )
    for sheet, d1, d2 in sounding.sheet_axis_gaps():
        # Centimetres are what the sheet's axis can be read to.
        note(
            NOTE_SHEET_AXIS_GAP,
            f"Sheet {sheet} ends at {d1:.2f} m, sheet {sheet + 1} starts at {d2:.2f} m: "
            "no reading in between",
            sheet=sheet,
            next=sheet + 1,
            d1=round(d1, 2),
            d2=round(d2, 2),
        )
    if kind is GraphKind.RASTER:
        note(NOTE_READ_FROM_IMAGE, "read from an image: check the orange curve against the sheet")
    return ReportSounding(
        key=key,
        sounding_id=sounding.sounding_id,
        origin=origin,
        page_numbers=sounding.page_numbers,
        graph_kind=kind,
        profile_name=pages[0].profile_name if pages else "generic",
        ground_level_m=ground,
        z_epsg=_first([p.z_epsg for p in pages]),
        x=placed.x if placed else None,
        y=placed.y if placed else None,
        epsg=placed.epsg if placed else None,
        test_date=_first([p.test_date for p in pages]),
        curves=tuple(k.value for k in sounding.curves),
        clipped_points=clipped,
        digitised=bool(sounding.curves),
        warnings=tuple(warnings),
        notes=tuple(notes),
        project_number=_first([p.project for p in pages]),
        campaign_code=campaign_code,
    )


def _table_report_sounding(
    key: str,
    table: PrintedTableSounding,
    sounding: DigitisedSounding,
    tables: PrintedTableReport,
    campaign_code: str | None = None,
    logger: GroundModelLogger | None = None,
) -> ReportSounding:
    """Return the dialog's entry of a sounding read from its printed table.

    The position is the printed GPS X / Y in the system the REPORT names
    (the sheets name none); when the report names none, or more than one,
    the position is left for the user, never guessed. The ground level is
    the table's printed level + depth (``ground_level_source``).
    """
    header = table.header
    provenance = sounding.table_provenance or {}
    placed = header.x is not None and header.y is not None and tables.epsg is not None
    ground = provenance.get("ground_level_m")
    warnings: list[str] = []
    notes: list[ReportSoundingNote] = []

    def note(code: str, english: str, **params: Any) -> None:
        """Record one note as its English sentence and as its code + params."""
        warnings.append(english)
        notes.append(ReportSoundingNote(code=code, params=params))

    note(NOTE_READ_FROM_PRINTED_TABLE, "read from the printed table: the values as printed")
    if not placed:
        note(NOTE_NO_POSITION_PRINTED, "no position printed: type X and Y before importing")
    drilled = [[top, base] for top, base in sounding.drilled_intervals(logger)]
    if drilled:
        listed = ", ".join(f"{top:.1f} to {base:.1f} m" for top, base in drilled)
        note(
            NOTE_DRILLED_INTERVALS,
            f"drilled: {listed}",
            intervals=drilled,
            count=len(drilled),
        )
    if table.rejected:
        note(
            NOTE_TABLE_ROWS_REJECTED,
            f"{len(table.rejected)} printed row(s) not read",
            count=len(table.rejected),
        )
    rf_flags = provenance.get("rf_mismatch_depths_m") or []
    if rf_flags:
        note(
            NOTE_TABLE_RF_MISMATCH,
            f"{len(rf_flags)} printed Rf value(s) contradict fs / qc: dropped, the Rf cell empty",
            count=len(rf_flags),
        )
    floor = provenance.get("pre_drill_floor_rows_m") or []
    effective = provenance.get("effective_pre_drill_m")
    if floor and effective is not None:
        note(
            NOTE_PRE_DRILL_FLOOR_ROWS,
            f"{len(floor)} row(s) with qc 0.01 directly after the pre-drill: no reading, "
            f"the curve starts at {effective:.2f} m",
            count=len(floor),
            depth=effective,
        )
    return ReportSounding(
        key=key,
        sounding_id=header.sounding_id,
        origin=CptOrigin.CAMPAIGN,
        page_numbers=sounding.page_numbers,
        graph_kind=GraphKind.TABLE,
        profile_name=tables.profile_name,
        ground_level_m=ground,
        z_epsg=tables.z_epsg if ground is not None else None,
        x=header.x if placed else None,
        y=header.y if placed else None,
        epsg=tables.epsg if placed else None,
        test_date=header.test_date,
        curves=tuple(k.value for k in sounding.curves),
        clipped_points=0,
        digitised=bool(sounding.curves),
        warnings=tuple(warnings),
        notes=tuple(notes),
        project_number=header.report_number,
        campaign_code=campaign_code,
        ground_level_source="printed-table" if ground is not None else None,
    )
