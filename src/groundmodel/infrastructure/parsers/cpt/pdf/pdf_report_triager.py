"""PdfReportTriager: triage a whole report and digitise the soundings it offers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

import pymupdf

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
from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import ocr_available
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_evidence import PageEvidence
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note import ReportSoundingNote
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note_constants import (
    NOTE_CLIPPED_POINTS,
    NOTE_ELEVATION_AXIS,
    NOTE_ELEVATION_AXIS_NO_GROUND_LEVEL,
    NOTE_NO_POSITION_PRINTED,
    NOTE_READ_FROM_IMAGE,
    NOTE_TICKS_NOT_READ,
    NOTE_TICKS_UNAVAILABLE_NO_OCR,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_T = TypeVar("_T")

#: ``progress(phase, done, total)`` -- phase is "classify" or "digitise".
TriageProgress = Callable[[str, int, int], None]


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

    @property
    def digitiser(self) -> CptPdfDigitiser:
        """Return the digitiser (same profiles and OCR engine as the triage)."""
        return self._digitiser

    def run(
        self,
        doc: pymupdf.Document,
        file_sha: str,
        progress: TriageProgress | None = None,
    ) -> tuple[PdfReportDigest, dict[str, DigitisedSounding]]:
        """Triage ``doc`` and digitise the soundings it offers.

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        file_sha : str
            SHA-256 of the report file, carried into the digest.
        progress : callable or None
            ``progress(phase, done, total)``.

        Returns
        -------
        tuple
            ``(digest, soundings)``: the digest for the UI and the digitised
            soundings by their key (campaign and unknown alike).
        """
        self.info("report triage: %d pages (OCR %s)", doc.page_count, bool(self._ocr))
        report = self._triage.classify(
            doc, progress=(lambda d, t: progress("classify", d, t)) if progress else None
        )
        evidence = {p.page_number: p for p in report.pages}
        graphs = [p for p in report.pages if p.page_class is PageClass.CPT_GRAPH]
        dropped = [_desk_study(p) for p in graphs if p.origin is CptOrigin.DESK_STUDY]
        wanted = [p for p in graphs if p.origin is not CptOrigin.DESK_STUDY]

        per_origin: dict[CptOrigin, list[DigitisedSounding]] = {
            CptOrigin.CAMPAIGN: [],
            CptOrigin.UNKNOWN: [],
        }
        for i, page in enumerate(wanted, start=1):
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
                progress("digitise", i, len(wanted))

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
                entry = _report_sounding(key, origin, sounding, evidence, self._ocr is not None)
                self.debug("sounding %s: notes %s", key, [n.code for n in entry.notes])
                listed[origin].append(entry)
                soundings[key] = sounding

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
            profiles=tuple(sorted({p.profile_name for p in graphs})),
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
) -> ReportSounding:
    """Combine a merged sounding with its sheets' header evidence and warnings."""
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
    )
