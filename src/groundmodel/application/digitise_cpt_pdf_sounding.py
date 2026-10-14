"""DigitiseCptPdfSounding: re-read one sounding of a triaged report for the overlay."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Any
from uuid import UUID

import polars as pl
import pymupdf

from groundmodel.application.cpt_pdf_graph_twin_reader import (
    CptPdfGraphTwinReader,
    graph_sheet_detector,
)
from groundmodel.application.pdf_sounding_view import PdfSoundingView
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import (
    CptPdfDigitiser,
    join_sheets,
)
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_twin_helpers import (
    graph_pages,
    is_printed_table,
    joined_graph_sheets,
    qc_comparison,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import OVERLAY_DPI
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_page_renderer import PdfPageRenderer
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    SERIES_SOURCE_GRAPH,
    SERIES_SOURCE_TABLE,
    SERIES_SOURCES,
)
from groundmodel.infrastructure.parsers.cpt.pdf.stored_series_helpers import stored_table
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _no_ocr_digitiser() -> CptPdfDigitiser:
    """Return a digitiser without OCR: re-reading through a calibration reads no axes."""
    return CptPdfDigitiser(ocr=False)


class DigitiseCptPdfSounding(GroundModelLogger):
    """Use case: read one listed sounding through the calibration the user settled on.

    The calibration overlay posts a calibration dict per page on every change
    (a dragged corner, a typed tick value, an eyedropper colour); each page is
    re-read through exactly that calibration and the sheets are joined back
    into one sounding. Without overrides the triage's own reading is returned
    untouched. Synchronous (PyMuPDF): the API runs it in a worker thread.

    A printed-table sounding (owner 2026-10-12, report Z2255777: "i see the
    thumbnail, i should be able to set the axes, that is a cpt") keeps its
    printed table as the series, and its GRAPH sheet is read as a raster CPT
    sheet on demand: automatically the first time (axes read by OCR when
    installed, else a frame on the picture to drag), through the user's
    calibration after that. The picture reading is shown apart and, on the
    user's choice, stored instead of the table.

    Parameters
    ----------
    store : PdfReportStore
        Holds the spooled report and its triage.
    digitiser_factory : callable
        Builds the digitiser used for the re-read.
    renderer : PdfPageRenderer or None
        Draws the overlays.
    detector_factory : callable
        Builds the digitiser that reads a printed-table sounding's graph sheet
        automatically (OCR when installed).
    """

    def __init__(
        self,
        store: PdfReportStore[CachedPdfReport],
        digitiser_factory: Callable[[], CptPdfDigitiser] = _no_ocr_digitiser,
        renderer: PdfPageRenderer | None = None,
        detector_factory: Callable[[], CptPdfDigitiser] = graph_sheet_detector,
    ) -> None:
        super().__init__(__name__)
        self._store = store
        self._digitiser_factory = digitiser_factory
        self._renderer = renderer or PdfPageRenderer()
        # Shared with the background read that follows the triage: a sheet it
        # read (or is reading) is never read again here.
        self._twins = CptPdfGraphTwinReader(store, detector_factory)

    def run(
        self,
        project_id: UUID,
        file_sha: str,
        key: str,
        calibrations: list[dict[str, Any]] | None = None,
        ground_level_m: float | None = None,
        overlay_dpi: float = OVERLAY_DPI,
    ) -> PdfSoundingView:
        """Return the sounding read through the given calibrations, with overlays.

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of the report.
        key : str
            The listed sounding's key.
        calibrations : list of dict or None
            ``PageCalibration.to_dict()`` per re-calibrated page (for a
            printed-table sounding: its graph sheets).
        ground_level_m : float or None
            A typed ground level (converts an elevation axis).
        overlay_dpi : float
            Resolution of the overlay PNGs.

        Returns
        -------
        PdfSoundingView
            The curves, the rows a CPT would store and one overlay per page;
            for a printed-table sounding also its graph sheet's reading.

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not triaged in this process.
        KeyError
            When the report lists no sounding ``key``.
        ValueError
            When a calibration dict is malformed or cannot be read through.
        """
        self.info("digitise sounding %s of report %s", key, file_sha[:12])
        report = self._store.require(project_id, file_sha)
        listed = report.digest.sounding(key)
        if listed is None:
            raise KeyError(key)
        base = report.soundings[key]
        graph: DigitisedSounding | None = None
        printed_table = is_printed_table(base)
        # Read (or wait for) the automatic graph reading BEFORE the PyMuPDF
        # lock: the reader takes that lock per page itself (lock order).
        detected = self._detected_twin(project_id, file_sha, report, key) if printed_table else None
        with self._store.opened(project_id, file_sha) as doc:
            if printed_table:
                # The table is the series; the overlay draws the graph sheet.
                sounding = base
                graph = self._graph_twin(doc, report, key, calibrations, detected)
                drawn = graph
            else:
                sounding = self._resolve(doc, report, key, calibrations, ground_level_m)
                drawn = sounding
            overlays = {
                c.page_number: self._renderer.overlay_png(doc, c, drawn, overlay_dpi)
                for c in drawn.calibrations
            }
        table, sampling = self._stored_or_none(key, sounding)
        graph_table = None
        comparison = None
        if graph is not None and graph.curves:
            graph_table, _ = self._stored_or_none(f"{key} (graph sheet)", graph)
            comparison = qc_comparison(sounding, graph)
        self.success(
            "sounding %s: %d page(s), %s rows%s",
            key,
            len(overlays),
            len(table) if table is not None else "no",
            ""
            if graph is None
            else f"; graph sheet {len(graph_table) if graph_table is not None else 'no'} rows",
        )
        return PdfSoundingView(
            listed=listed,
            sounding=sounding,
            table=table,
            sampling=sampling,
            overlays=overlays,
            overlay_dpi=overlay_dpi,
            graph=graph,
            graph_table=graph_table,
            comparison=comparison,
        )

    def sounding(
        self,
        project_id: UUID,
        file_sha: str,
        key: str,
        calibrations: list[dict[str, Any]] | None = None,
        ground_level_m: float | None = None,
        series_source: str | None = None,
    ) -> DigitisedSounding:
        """Return the digitised sounding the import stores (no overlays).

        Parameters
        ----------
        project_id : UUID
            The project.
        file_sha : str
            SHA-256 hex of the report.
        key : str
            The listed sounding's key.
        calibrations : list of dict or None
            Per-page calibration overrides.
        ground_level_m : float or None
            A typed ground level.
        series_source : str or None
            A printed-table sounding only: ``"table"`` (the default) stores the
            printed rows, ``"graph"`` the curve read off its graph sheet.

        Returns
        -------
        DigitisedSounding
            The sounding.

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not triaged in this process.
        KeyError
            When the report lists no sounding ``key``.
        ValueError
            When the source is unknown, names a printed table the sounding
            does not have, or names a graph reading that has no qc yet.
        """
        report = self._store.require(project_id, file_sha)
        if report.digest.sounding(key) is None:
            raise KeyError(key)
        if series_source is not None and series_source not in SERIES_SOURCES:
            raise ValueError(f"sounding {key}: unknown series source {series_source!r}")
        base = report.soundings[key]
        if is_printed_table(base):
            return self._printed_table_sounding(
                project_id, file_sha, report, key, calibrations, series_source
            )
        if series_source == SERIES_SOURCE_TABLE:
            raise ValueError(f"sounding {key} has no printed table to store")
        if not calibrations and ground_level_m is None:
            return base
        with self._store.opened(project_id, file_sha) as doc:
            return self._resolve(doc, report, key, calibrations, ground_level_m)

    def _stored_or_none(
        self, label: str, sounding: DigitisedSounding
    ) -> tuple[pl.DataFrame | None, str | None]:
        """Return the rows a CPT would store and their sampling, or Nones before any qc."""
        try:
            table, sampling, _ = stored_table(sounding)
        except ValueError as exc:
            self.warning("sounding %s: nothing to store yet (%s)", label, exc)
            return None, None
        return table, sampling

    def _printed_table_sounding(
        self,
        project_id: UUID,
        file_sha: str,
        report: CachedPdfReport,
        key: str,
        calibrations: list[dict[str, Any]] | None,
        series_source: str | None,
    ) -> DigitisedSounding:
        """Return what a printed-table sounding stores: the table or its graph reading.

        The table is the default (owner 2026-10-08: "the import takes the
        EXACT printed values"); a typed ground level never re-reads it. The
        graph sheet is read only when it is chosen or the user set its axes,
        and then the qc of both is compared. The chosen source and the
        comparison go into ``printed_table`` (additive keys).
        """
        base = report.soundings[key]
        source = series_source or SERIES_SOURCE_TABLE
        _graph_overrides(base, key, calibrations)  # refuse a foreign page before opening
        graph = None
        if calibrations or source == SERIES_SOURCE_GRAPH:
            detected = self._detected_twin(project_id, file_sha, report, key)
            with self._store.opened(project_id, file_sha) as doc:
                graph = self._graph_twin(doc, report, key, calibrations, detected)
        comparison = qc_comparison(base, graph) if graph is not None else None
        provenance = {
            **(base.table_provenance or {}),
            "series_source": source,
            **({"graph_comparison": comparison} if comparison is not None else {}),
        }
        self.info(
            "sounding %s: stored from the %s%s",
            key,
            "printed table" if source == SERIES_SOURCE_TABLE else "graph sheet",
            f" (picture vs table qc: {comparison})" if comparison else "",
        )
        if source == SERIES_SOURCE_TABLE:
            return replace(base, table_provenance=provenance)
        if graph is None or PanelKind.QC not in graph.curves:
            raise ValueError(
                f"sounding {key}: no qc read off its graph sheet yet; "
                "check its axes or keep the printed table"
            )
        # The picture's curves under the sounding's printed header: the same
        # id, the printed pre-drill and CPT type. The table's own row checks
        # (Rf mismatches, rejected rows) are not about these values.
        return replace(
            graph,
            sounding_id=base.sounding_id,
            printed_pre_drill_m=base.printed_pre_drill_m,
            printed_cpt_type=base.printed_cpt_type,
            table_provenance=provenance,
        )

    def _graph_twin(
        self,
        doc: pymupdf.Document,
        report: CachedPdfReport,
        key: str,
        calibrations: list[dict[str, Any]] | None,
        detected: DigitisedSounding | None,
    ) -> DigitisedSounding:
        """Read a printed-table sounding's graph sheet(s) as raster CPT sheets.

        A posted calibration re-reads its page through exactly that
        calibration; every other graph page keeps the automatic reading
        (``detected``, read once by ``CptPdfGraphTwinReader`` and kept on the
        cached report; a page whose axes were not found has a qc draft on its
        picture there). Called inside ``PdfReportStore.opened``.

        Raises
        ------
        ValueError
            When a calibration names a page that is not one of its graph
            sheets, or a re-read finds no complete panel.
        """
        base = report.soundings[key]
        pages, overrides = _graph_overrides(base, key, calibrations)
        if not pages:
            self.info("sounding %s: printed table without a graph sheet", key)
            return DigitisedSounding(
                sounding_id=base.sounding_id, page_numbers=(), calibrations=(), curves={}
            )
        if detected is None:
            # _detected_twin answers None only for a sounding without graph pages.
            raise ValueError(f"sounding {key}: graph sheet reading missing")
        if not overrides:
            return detected
        digitiser = self._digitiser_factory()
        sheets: list[DigitisedSounding] = []
        for page in pages:
            if page in overrides:
                sheets.append(digitiser.digitise_with_calibration(doc, overrides[page]))
            else:
                own = tuple(c for c in detected.calibrations if c.page_number == page)
                sheets.append(
                    DigitisedSounding(
                        sounding_id=None, page_numbers=(page,), calibrations=own, curves={}
                    )
                )
        return joined_graph_sheets(sheets, base.sounding_id)

    def _detected_twin(
        self, project_id: UUID, file_sha: str, report: CachedPdfReport, key: str
    ) -> DigitisedSounding | None:
        """Return the automatic reading of the graph sheets, or None without one.

        From the cache when the background read (or an earlier open) did it;
        waits for a reading in flight; reads it here as the fallback. Must
        not run under ``PdfReportStore.opened``.
        """
        if not graph_pages(report.soundings[key]):
            return None
        return self._twins.read(project_id, file_sha, report, key)

    def _resolve(
        self,
        doc: pymupdf.Document,
        report: CachedPdfReport,
        key: str,
        calibrations: list[dict[str, Any]] | None,
        ground_level_m: float | None,
    ) -> DigitisedSounding:
        """Re-read every page of the sounding through its (overridden) calibration."""
        base = report.soundings[key]
        overrides = {
            c.page_number: c for c in (PageCalibration.from_dict(d) for d in calibrations or [])
        }
        foreign = set(overrides) - set(base.page_numbers)
        if foreign:
            raise ValueError(f"sounding {key} is not on page(s) {sorted(foreign)}")
        if not overrides and ground_level_m is None:
            return base
        digitiser = self._digitiser_factory()
        sheets: list[DigitisedSounding] = []
        for page, own in zip(base.page_numbers, base.calibrations, strict=True):
            cal = overrides.get(page, own)
            if ground_level_m is not None and cal.depth_reference is DepthReference.ELEVATION:
                cal = replace(cal, ground_level_m=ground_level_m)
            sheets.append(digitiser.digitise_with_calibration(doc, cal))
        joined = join_sheets(sheets)
        return replace(joined, sounding_id=base.sounding_id)


def _graph_overrides(
    base: DigitisedSounding, key: str, calibrations: list[dict[str, Any]] | None
) -> tuple[list[int], dict[int, PageCalibration]]:
    """Return a printed-table sounding's graph pages and the posted calibration per page.

    Raises
    ------
    ValueError
        When a calibration names a page that is not one of its graph sheets
        (a table page has no axes to set).
    """
    pages = graph_pages(base)
    overrides = {
        c.page_number: c for c in (PageCalibration.from_dict(d) for d in calibrations or [])
    }
    foreign = sorted(set(overrides) - set(pages))
    if foreign:
        raise ValueError(
            f"sounding {key}: page(s) {foreign} are not a graph sheet of its printed "
            f"table (graph sheets: {pages or 'none'})"
        )
    return pages, overrides
