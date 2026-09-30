"""TriageCptPdfReport: triage an uploaded PDF report for the import dialog."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
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
        store: PdfReportStore,
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
            ``progress(phase, done, total)``.

        Returns
        -------
        PdfReportDigest
            What the dialog lists.

        Raises
        ------
        CptPdfReportNotFoundError
            When the store holds no such report for the project.
        """
        self.info("triage report %s for project %s", file_sha[:12], project_id)
        cached = self._store.recall(project_id, file_sha)
        if cached is not None:
            self.info("report %s already triaged: answering from memory", file_sha[:12])
            return cached.digest
        with self._store.opened(project_id, file_sha) as doc:
            digest, soundings = self._triager_factory().run(doc, file_sha, progress)
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
