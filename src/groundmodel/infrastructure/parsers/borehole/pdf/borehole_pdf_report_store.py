"""The process-wide store of uploaded borehole-log PDF reports (FastAPI dependency)."""

from __future__ import annotations

from groundmodel.infrastructure.parsers.borehole.pdf.cached_borehole_pdf_report import (
    CachedBoreholePdfReport,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.config import settings

_STORE: PdfReportStore[CachedBoreholePdfReport] | None = None


def get_borehole_pdf_report_store() -> PdfReportStore[CachedBoreholePdfReport]:
    """Return the process-wide borehole report store (FastAPI dependency).

    A store of its own, rooted at ``settings.borehole_pdf_store_dir``: the
    CPT import's store prunes its project folders to a few reports, and a
    borehole report must never push a CPT report out (or the reverse).

    Returns
    -------
    PdfReportStore
        The store, holding ``CachedBoreholePdfReport`` triages.
    """
    global _STORE
    if _STORE is None:
        _STORE = PdfReportStore(settings.borehole_pdf_store_dir)
    return _STORE
