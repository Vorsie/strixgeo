"""TriageBoreholePdfReport: triage an uploaded borehole-log PDF report for the import dialog."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser import (
    BoreholePdfDigitiser,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.borehole.pdf.cached_borehole_pdf_report import (
    CachedBoreholePdfReport,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache import OcrWordCache
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.exceptions import TriageCancelled
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# ``progress(phase, done, total, ocr=...)``: the CPT triage's tick shape, so the
# desktop reads both streams with one hook.
TriageTick = Callable[..., None]


def default_borehole_triager() -> BoreholePdfTriager:
    """Return the triager the import uses: OCR when the ``pdf-ocr`` extra is installed.

    Returns
    -------
    BoreholePdfTriager
        With an ``OcrReader`` when RapidOCR + OpenCV import, else without
        (pages with no text layer stay "needs OCR").
    """
    from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
    from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import ocr_available

    return BoreholePdfTriager(ocr=OcrReader() if ocr_available() else None)


class TriageBoreholePdfReport(GroundModelLogger):
    """Use case: classify a stored borehole report, parse what it offers, remember it.

    The borehole twin of ``TriageCptPdfReport``: synchronous and CPU-bound
    (PyMuPDF), run in a worker thread as a background job whose progress the
    API streams. A report already triaged in this process answers at once
    from memory.

    Parameters
    ----------
    store : PdfReportStore
        Where the report was spooled and where the triage is remembered.
    triager_factory : callable
        Builds the triager (tests pass one without OCR).
    """

    def __init__(
        self,
        store: PdfReportStore[CachedBoreholePdfReport],
        triager_factory: Callable[[], BoreholePdfTriager] = default_borehole_triager,
    ) -> None:
        super().__init__(__name__)
        self._store = store
        self._triager_factory = triager_factory

    def run(
        self,
        project_id: UUID,
        file_sha: str,
        file_name: str,
        progress: TriageTick | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> CachedBoreholePdfReport:
        """Triage and parse the stored report ``file_sha`` of a project.

        Parameters
        ----------
        project_id : UUID
            The project the report was uploaded into.
        file_sha : str
            SHA-256 hex of the report.
        file_name : str
            The name the user picked it under.
        progress : callable or None
            ``progress(phase, done, total, ocr=...)``: ``classify`` per page,
            then ``digitise`` once the boreholes are parsed.
        should_stop : callable or None
            The job's cancel flag; checked before every page and between OCR
            regions. What OCR read before a cancel is kept for the next try.

        Returns
        -------
        CachedBoreholePdfReport
            The digest and the parsed boreholes.

        Raises
        ------
        CptPdfReportNotFoundError
            When the store holds no such report for the project.
        TriageCancelled
            When ``should_stop`` answered True (nothing is remembered).
        """
        self.info("triage borehole report %s for project %s", file_sha[:12], project_id)
        cached = self._store.recall(project_id, file_sha)
        if cached is not None:
            self.info("borehole report %s already triaged: answering from memory", file_sha[:12])
            return cached

        def classify_tick(done: int, total: int, ocr: bool = False) -> None:
            if progress is not None:
                progress("classify", done, total, ocr=ocr)

        ocr_cache: OcrWordCache | None = None
        try:
            with self._store.opened(project_id, file_sha) as doc:
                # Built once the store has vouched for the report (a bad sha is
                # its not-found error, not a ValueError from the cache path).
                ocr_cache = self._store.ocr_cache(project_id, file_sha)
                result = self._triager_factory().triage(
                    doc,
                    file_name=file_name,
                    file_sha=file_sha,
                    ocr_cache=ocr_cache,
                    progress=classify_tick,
                    should_stop=should_stop,
                )
        finally:
            # Saved on a cancel too: a triage started again resumes where the
            # OCR stopped instead of reading every page a second time.
            if ocr_cache is not None:
                ocr_cache.save()
        if should_stop is not None and should_stop():
            listed = len(result.digest.boreholes)
            raise TriageCancelled(listed, listed)
        identity = PdfReportIdentity(
            file_name=file_name, file_sha=file_sha, ocr_available=result.digest.ocr_available
        )
        boreholes = BoreholePdfDigitiser().digitise(result, identity)
        if progress is not None:
            progress("digitise", len(boreholes), len(boreholes), ocr=False)
        report = CachedBoreholePdfReport(
            path=self._store.path_for(project_id, file_sha),
            file_name=file_name,
            digest=result.digest,
            boreholes={b.key: b for b in boreholes},
        )
        self._store.remember(project_id, report)
        self.success(
            "borehole report %s triaged: %d borehole(s) listed, %d parsed, %d repeat(s) dropped",
            file_sha[:12],
            len(result.digest.boreholes),
            len(boreholes),
            len(result.digest.dropped),
        )
        return report
