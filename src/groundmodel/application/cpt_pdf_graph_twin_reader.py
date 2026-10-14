"""CptPdfGraphTwinReader: read a printed-table sounding's graph sheets once, cached."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_twin_helpers import (
    graph_pages,
    joined_graph_sheets,
    picture_draft,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import RASTER_DPI
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import render_page
from groundmodel.shared.exceptions import TriageCancelled
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def graph_sheet_detector() -> CptPdfDigitiser:
    """Return the digitiser that reads a graph sheet automatically (OCR when installed).

    Returns
    -------
    CptPdfDigitiser
        With OCR on; it falls back to no OCR when the ``pdf-ocr`` extra is absent.
    """
    return CptPdfDigitiser(ocr=True)


class CptPdfGraphTwinReader(GroundModelLogger):
    """Read the graph sheet(s) of one printed-table sounding automatically, once.

    Shared by the background read that follows the triage
    (``ReadCptPdfGraphTwins``, owner 2026-10-14: "sondering wordt gelezen is
    traag") and the overlay's on-demand fallback
    (``DigitiseCptPdfSounding``). The reading is kept on
    ``CachedPdfReport.graph_twins``; a per-sounding lock
    (``CachedPdfReport.twin_lock``) makes a second caller wait for the first
    reading instead of reading the same sheet twice.

    Lock order: the sounding lock first, the PyMuPDF lock
    (``PdfReportStore.opened``) inside it and only for the render of one page.
    The OCR and curve tracing run outside the PyMuPDF lock, so page
    thumbnails and other soundings keep answering while a sheet is read.
    A caller must therefore never hold ``PdfReportStore.opened`` around
    :meth:`read`.

    Parameters
    ----------
    store : PdfReportStore
        Holds the spooled report.
    detector_factory : callable
        Builds the digitiser that reads the sheets (OCR when installed).
    """

    def __init__(
        self,
        store: PdfReportStore[CachedPdfReport],
        detector_factory: Callable[[], CptPdfDigitiser],
    ) -> None:
        super().__init__(__name__)
        self._store = store
        self._detector_factory = detector_factory

    def read(
        self,
        project_id: UUID,
        file_sha: str,
        report: CachedPdfReport,
        key: str,
        should_stop: Callable[[], bool] | None = None,
    ) -> DigitisedSounding:
        """Return the automatic reading of a sounding's graph sheets (cached on the report).

        When the axes of a page are not found, the page gets a qc draft on its
        picture, so the overlay always has a frame to drag.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of the report.
        report : CachedPdfReport
            The triaged report (holds the cache and the locks).
        key : str
            The listed sounding's key (a printed-table sounding).
        should_stop : callable or None
            A cooperative stop flag, checked before every page.

        Returns
        -------
        DigitisedSounding
            The joined reading of the graph pages (no curves while no axis
            was read).

        Raises
        ------
        TriageCancelled
            When ``should_stop`` answered True (nothing is cached for the key).
        CptPdfReportNotFoundError
            When the store no longer holds the report file.
        """
        with report.twin_lock(key):
            cached = report.graph_twins.get(key)
            if cached is not None:
                self.debug("sounding %s: graph sheet reading from the cache", key)
                return cached
            base = report.soundings[key]
            pages = graph_pages(base)
            ground = (base.table_provenance or {}).get("ground_level_m")
            detector = self._detector_factory()
            sheets: list[DigitisedSounding] = []
            for i, page in enumerate(pages, start=1):
                if should_stop is not None and should_stop():
                    self.info("sounding %s: graph sheet read stopped at page %d", key, page)
                    raise TriageCancelled(i - 1, len(pages))
                sheets.append(self._read_page(project_id, file_sha, key, page, ground, detector))
                self.debug(
                    "[%d/%d] sounding %s graph page %d read: curves %s",
                    i,
                    len(pages),
                    key,
                    page,
                    ",".join(k.value for k in sheets[-1].curves) or "-",
                )
            twin = joined_graph_sheets(sheets, base.sounding_id)
            report.graph_twins[key] = twin
            self.info(
                "sounding %s: graph sheet(s) %s read automatically: curves %s",
                key,
                pages,
                ",".join(k.value for k in twin.curves) or "none (axes for the user)",
            )
            return twin

    def _read_page(
        self,
        project_id: UUID,
        file_sha: str,
        key: str,
        page: int,
        ground: float | None,
        detector: CptPdfDigitiser,
    ) -> DigitisedSounding:
        """Read one graph page: render under the PyMuPDF lock, trace outside it."""
        with self._store.opened(project_id, file_sha) as doc:
            image = render_page(doc[page - 1], RASTER_DPI)
            # PyMuPDF ships no annotation for get_text (the infrastructure package
            # relaxes this check; the application layer does not).
            text: str = doc[page - 1].get_text()  # type: ignore[no-untyped-call]
        try:
            return detector.digitise_raster_image(image, text, page, ground_level_m=ground)
        except ValueError as exc:
            self.warning(
                "sounding %s graph page %d: axes not found (%s); a frame on the picture "
                "for the user",
                key,
                page,
                exc,
            )
        with self._store.opened(project_id, file_sha) as doc:
            draft = picture_draft(doc[page - 1], page, ground)
        return DigitisedSounding(
            sounding_id=None, page_numbers=(page,), calibrations=(draft,), curves={}
        )
