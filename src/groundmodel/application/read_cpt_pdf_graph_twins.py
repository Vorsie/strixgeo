"""ReadCptPdfGraphTwins: read every printed-table graph sheet of a report in the background."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import UUID

from groundmodel.application.cpt_pdf_graph_twin_reader import (
    CptPdfGraphTwinReader,
    graph_sheet_detector,
)
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.graph_twin_helpers import (
    graph_pages,
    is_printed_table,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import GRAPH_TWIN_PHASE
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.exceptions import TriageCancelled
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ReadCptPdfGraphTwins(GroundModelLogger):
    """Use case: after a triage, read the graph sheets of its printed-table soundings.

    Owner dogfeed 2026-10-14 (report Z2255777, 15 printed-table soundings):
    "sondering wordt gelezen is traag" -- the overlay read a sounding's graph
    sheet with OCR when it opened (about 20 s per sheet). The triage job now
    spawns this one: it reads every graph sheet the overlay would read, one
    sounding at a time, into the report's cache, so the overlay opens at
    once. The printed table stays the source of the import, which never
    waits for it. Synchronous and CPU-bound: the API runs it in a worker
    thread as a background job and streams its progress.

    Parameters
    ----------
    store : PdfReportStore
        Holds the spooled report and its triage.
    detector_factory : callable
        Builds the digitiser that reads the sheets (OCR when installed).
    """

    def __init__(
        self,
        store: PdfReportStore[CachedPdfReport],
        detector_factory: Callable[[], CptPdfDigitiser] = graph_sheet_detector,
    ) -> None:
        super().__init__(__name__)
        self._store = store
        self._reader = CptPdfGraphTwinReader(store, detector_factory)

    def pending(self, project_id: UUID, file_sha: str) -> list[str]:
        """Return the listed printed-table soundings whose graph sheets are not read yet.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of the report.

        Returns
        -------
        list of str
            Sounding keys in list order (campaign, then unknown origin).

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not triaged in this process.
        """
        report = self._store.require(project_id, file_sha)
        digest = report.digest
        keys: list[str] = []
        for listed in (*digest.campaign, *digest.unknown):
            sounding = report.soundings.get(listed.key)
            if sounding is None or not is_printed_table(sounding) or not graph_pages(sounding):
                continue
            if listed.key not in report.graph_twins:
                keys.append(listed.key)
        return keys

    def run(
        self,
        project_id: UUID,
        file_sha: str,
        progress: Callable[..., None] | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        """Read every pending graph sheet of the report into its cache.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of the report.
        progress : callable or None
            ``progress("graph", done, total, key=<sounding key>)`` once before
            the first sounding (``done = 0``, no key) and after each one.
        should_stop : callable or None
            The job's cancel flag; checked between soundings and pages.

        Returns
        -------
        dict
            ``{"read": [keys read by this run], "total": n}``.

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not triaged in this process.
        TriageCancelled
            When ``should_stop`` answered True (what was read stays cached).
        """
        keys = self.pending(project_id, file_sha)
        total = len(keys)
        self.info(
            "report %s: %d printed-table graph sheet(s) to read in the background",
            file_sha[:12],
            total,
        )
        if total == 0:
            return {"read": [], "total": 0}
        report = self._store.require(project_id, file_sha)
        if progress is not None:
            progress(GRAPH_TWIN_PHASE, 0, total)
        read: list[str] = []
        for i, key in enumerate(keys, start=1):
            if should_stop is not None and should_stop():
                self.info("report %s: graph sheet read cancelled at %d/%d", file_sha[:12], i, total)
                raise TriageCancelled(i - 1, total)
            self.debug(
                "[%d/%d] report %s: reading the graph sheet of %s", i, total, file_sha[:12], key
            )
            self._reader.read(project_id, file_sha, report, key, should_stop)
            read.append(key)
            if progress is not None:
                progress(GRAPH_TWIN_PHASE, i, total, key=key)
        self.success("report %s: %d graph sheet reading(s) cached", file_sha[:12], len(read))
        return {"read": read, "total": total}
