"""DigitiseCptPdfSounding: re-read one sounding of a triaged report for the overlay."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Any
from uuid import UUID

import pymupdf

from groundmodel.application.pdf_sounding_view import PdfSoundingView
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import (
    CptPdfDigitiser,
    join_sheets,
)
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import OVERLAY_DPI
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_page_renderer import PdfPageRenderer
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
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

    Parameters
    ----------
    store : PdfReportStore
        Holds the spooled report and its triage.
    digitiser_factory : callable
        Builds the digitiser used for the re-read.
    renderer : PdfPageRenderer or None
        Draws the overlays.
    """

    def __init__(
        self,
        store: PdfReportStore,
        digitiser_factory: Callable[[], CptPdfDigitiser] = _no_ocr_digitiser,
        renderer: PdfPageRenderer | None = None,
    ) -> None:
        super().__init__(__name__)
        self._store = store
        self._digitiser_factory = digitiser_factory
        self._renderer = renderer or PdfPageRenderer()

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
            ``PageCalibration.to_dict()`` per re-calibrated page.
        ground_level_m : float or None
            A typed ground level (converts an elevation axis).
        overlay_dpi : float
            Resolution of the overlay PNGs.

        Returns
        -------
        PdfSoundingView
            The curves, the rows a CPT would store and one overlay per page.

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
        with self._store.opened(project_id, file_sha) as doc:
            sounding = self._resolve(doc, report, key, calibrations, ground_level_m)
            overlays = {
                c.page_number: self._renderer.overlay_png(doc, c, sounding, overlay_dpi)
                for c in sounding.calibrations
            }
        try:
            table, sampling, _ = stored_table(sounding)
        except ValueError as exc:
            self.warning("sounding %s: nothing to store yet (%s)", key, exc)
            table, sampling = None, None
        self.success(
            "sounding %s: %d page(s), %s rows",
            key,
            len(overlays),
            len(table) if table is not None else "no",
        )
        return PdfSoundingView(
            listed=listed,
            sounding=sounding,
            table=table,
            sampling=sampling,
            overlays=overlays,
            overlay_dpi=overlay_dpi,
        )

    def sounding(
        self,
        project_id: UUID,
        file_sha: str,
        key: str,
        calibrations: list[dict[str, Any]] | None = None,
        ground_level_m: float | None = None,
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
        """
        report = self._store.require(project_id, file_sha)
        if report.digest.sounding(key) is None:
            raise KeyError(key)
        if not calibrations and ground_level_m is None:
            return report.soundings[key]
        if not report.soundings[key].calibrations:
            return _printed_table(report.soundings[key], key, calibrations)
        with self._store.opened(project_id, file_sha) as doc:
            return self._resolve(doc, report, key, calibrations, ground_level_m)

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
        if not base.calibrations:
            return _printed_table(base, key, calibrations)
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


def _printed_table(
    base: DigitisedSounding, key: str, calibrations: list[dict[str, Any]] | None
) -> DigitisedSounding:
    """Return a sounding read from its printed table as it is: there is nothing to re-read.

    The table's values are the printed numbers (owner 2026-10-08), not a curve
    read through a calibration, so a typed ground level changes nothing and a
    posted calibration has no page to apply to.

    Raises
    ------
    ValueError
        When calibrations were posted for it.
    """
    if calibrations:
        raise ValueError(f"sounding {key} is read from its printed table: no calibration applies")
    return base
