"""TriageCptPdfReport: triage an uploaded PDF report for the import dialog."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache import OcrWordCache
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import (
    PdfReportTriager,
    TriageProgress,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class TriageCptPdfReport(GroundModelLogger):
    """Use case: classify a stored report, digitise what it offers, remember it.

    Synchronous and CPU-bound (PyMuPDF): the API runs it in a worker thread as
    a background job and streams its progress. A report already triaged in
    this process answers at once from memory.

    Parameters
    ----------
    store : PdfReportStore
        Where the report was spooled and where the result is remembered.
    triager_factory : callable
        Builds the triager (tests pass a fake).
    """

    def __init__(
        self,
        store: PdfReportStore[CachedPdfReport],
        triager_factory: Callable[[], PdfReportTriager] = PdfReportTriager,
    ) -> None:
        super().__init__(__name__)
        self._store = store
        self._triager_factory = triager_factory

    def run(
        self,
        project_id: UUID,
        file_sha: str,
        file_name: str,
        progress: TriageProgress | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> PdfReportDigest:
        """Triage the stored report ``file_sha`` of a project.

        Parameters
        ----------
        project_id : UUID
            The project the report was uploaded into.
        file_sha : str
            SHA-256 hex of the report.
        file_name : str
            The name the user picked it under.
        progress : callable or None
            ``progress(phase, done, total, ocr=...)``.
        should_stop : callable or None
            The job's cancel flag; checked between pages, sheets and OCR
            strips. What OCR read before a cancel is kept for the next try.

        Returns
        -------
        PdfReportDigest
            What the dialog lists.

        Raises
        ------
        CptPdfReportNotFoundError
            When the store holds no such report for the project.
        TriageCancelled
            When ``should_stop`` answered True (nothing is remembered).
        """
        self.info("triage report %s for project %s", file_sha[:12], project_id)
        cached = self._store.recall(project_id, file_sha)
        if cached is not None:
            self.info("report %s already triaged: answering from memory", file_sha[:12])
            return cached.digest
        ocr_cache: OcrWordCache | None = None
        try:
            with self._store.opened(project_id, file_sha) as doc:
                # Built once the store has vouched for the report (a bad sha is
                # its not-found error, not a ValueError from the cache path).
                ocr_cache = self._store.ocr_cache(project_id, file_sha)
                digest, soundings = self._triager_factory().run(
                    doc, file_sha, progress, should_stop=should_stop, ocr_cache=ocr_cache
                )
        finally:
            # Saved on a cancel too: a triage started again resumes where the
            # OCR stopped instead of reading every strip a second time.
            if ocr_cache is not None:
                ocr_cache.save()
        self._store.remember(
            project_id,
            CachedPdfReport(
                path=self._store.path_for(project_id, file_sha),
                file_name=file_name,
                digest=digest,
                soundings=soundings,
            ),
        )
        self.success(
            "report %s triaged: %d campaign soundings, %d set aside",
            file_sha[:12],
            len(digest.campaign),
            len(digest.dropped),
        )
        return digest
