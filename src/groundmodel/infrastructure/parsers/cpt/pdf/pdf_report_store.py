"""PdfReportStore: the uploaded reports of the import dialog, on disk and in memory."""

from __future__ import annotations

import shutil
import threading
from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    MAX_CACHED_PDF_REPORTS,
    MAX_SPOOLED_PDF_REPORTS_PER_PROJECT,
)
from groundmodel.shared.config import settings
from groundmodel.shared.exceptions import CptPdfReportNotFoundError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

if TYPE_CHECKING:
    # The API imports this module at boot (the store dependency); PyMuPDF
    # loads on the first report opened, not at start-up.
    import pymupdf

# PyMuPDF keeps one global MuPDF context and is not safe to drive from two
# threads at once (its documentation says so). The triage runs in a worker
# thread while the dialog may already ask for page thumbnails, so every PyMuPDF
# call of the import flow runs under this one lock.
PDF_ENGINE_LOCK = threading.Lock()


class PdfReportStore(GroundModelLogger):
    """Keep uploaded reports per project, keyed by the SHA-256 of their bytes.

    On disk: ``<root>/<project id>/<sha>.pdf`` -- the same report uploaded
    twice is stored once, and the triage, every re-extract and the import read
    the same bytes. The oldest files of a project are pruned beyond a small
    cap (a temp store; the imported CPT keeps its provenance, not the file).
    In memory: the last few triaged reports (digest + digitised soundings),
    so a re-extract or an import needs no second triage.

    Parameters
    ----------
    root : pathlib.Path
        The spool directory.
    """

    def __init__(self, root: Path) -> None:
        super().__init__(__name__)
        self._root = root
        self._cache: OrderedDict[tuple[UUID, str], CachedPdfReport] = OrderedDict()
        self._lock = threading.Lock()

    def project_dir(self, project_id: UUID) -> Path:
        """Return the spool directory of a project (uploads are streamed into it).

        Parameters
        ----------
        project_id : UUID
            The project.

        Returns
        -------
        pathlib.Path
            ``<root>/<project id>``.
        """
        return self._root / str(project_id)

    def path_for(self, project_id: UUID, file_sha: str) -> Path:
        """Return where a report of a project is (or would be) spooled.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of the report.

        Returns
        -------
        pathlib.Path
            The file path.

        Raises
        ------
        ValueError
            When ``file_sha`` is not a 64-character hex string (never let a
            request-supplied value build a path).
        """
        if len(file_sha) != 64 or any(c not in "0123456789abcdef" for c in file_sha):
            raise ValueError("file_sha must be a lower-case SHA-256 hex digest")
        return self.project_dir(project_id) / f"{file_sha}.pdf"

    def put_file(self, project_id: UUID, file_sha: str, spooled: Path) -> Path:
        """Move a freshly spooled upload into the store (or drop it when already there).

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of ``spooled``.
        spooled : pathlib.Path
            The temporary upload file; consumed.

        Returns
        -------
        pathlib.Path
            The stored file.
        """
        target = self.path_for(project_id, file_sha)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            spooled.unlink(missing_ok=True)
            self.debug("report %s already stored for project %s", file_sha[:12], project_id)
        else:
            shutil.move(str(spooled), target)
            self.info("report %s stored for project %s", file_sha[:12], project_id)
        self._prune(target.parent, keep=target)
        return target

    @contextmanager
    def opened(self, project_id: UUID, file_sha: str) -> Iterator[pymupdf.Document]:
        """Open a stored report for the ``with`` block, holding the PyMuPDF lock.

        Every PyMuPDF call of the import flow goes through here, so the lock
        (see ``PDF_ENGINE_LOCK``) is held for exactly the life of the open
        document and the document is always closed.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex.

        Yields
        ------
        pymupdf.Document
            The open report.

        Raises
        ------
        CptPdfReportNotFoundError
            When the project holds no such report.
        """
        try:
            path = self.path_for(project_id, file_sha)
        except ValueError as exc:
            raise CptPdfReportNotFoundError(file_sha) from exc
        if not path.exists():
            raise CptPdfReportNotFoundError(file_sha)
        import pymupdf

        with PDF_ENGINE_LOCK:
            doc = pymupdf.open(path)
            try:
                yield doc
            finally:
                doc.close()

    def remember(self, project_id: UUID, report: CachedPdfReport) -> None:
        """Keep a triaged report in memory (least recently used ones drop out).

        Parameters
        ----------
        project_id : UUID
            The project.
        report : CachedPdfReport
            The triaged report.
        """
        key = (project_id, report.digest.file_sha)
        with self._lock:
            self._cache[key] = report
            self._cache.move_to_end(key)
            while len(self._cache) > MAX_CACHED_PDF_REPORTS:
                dropped, _ = self._cache.popitem(last=False)
                self.debug("forgot triaged report %s", dropped[1][:12])

    def recall(self, project_id: UUID, file_sha: str) -> CachedPdfReport | None:
        """Return a triaged report of a project, if still in memory.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex.

        Returns
        -------
        CachedPdfReport or None
            The report, or None when it was never triaged or was forgotten.
        """
        with self._lock:
            report = self._cache.get((project_id, file_sha))
            if report is not None:
                self._cache.move_to_end((project_id, file_sha))
            return report

    def require(self, project_id: UUID, file_sha: str) -> CachedPdfReport:
        """Return a triaged report or raise the not-found error the API maps to 404.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex.

        Returns
        -------
        CachedPdfReport
            The report.

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not (or no longer) triaged in this process.
        """
        report = self.recall(project_id, file_sha)
        if report is None:
            raise CptPdfReportNotFoundError(file_sha)
        return report

    def _prune(self, directory: Path, keep: Path) -> None:
        """Delete a project's oldest spooled reports beyond the per-project cap."""
        files = sorted(
            (p for p in directory.glob("*.pdf") if p != keep),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old in files[MAX_SPOOLED_PDF_REPORTS_PER_PROJECT - 1 :]:
            old.unlink(missing_ok=True)
            self.debug("pruned spooled report %s", old.name[:12])


_STORE: PdfReportStore | None = None


def get_pdf_report_store() -> PdfReportStore:
    """Return the process-wide report store (FastAPI dependency).

    Returns
    -------
    PdfReportStore
        The store rooted at ``settings.cpt_pdf_store_dir``.
    """
    global _STORE
    if _STORE is None:
        _STORE = PdfReportStore(settings.cpt_pdf_store_dir)
    return _STORE
