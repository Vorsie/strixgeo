"""TriagedPdfReport: what a PDF report store keeps in memory, whatever the digitiser."""

from __future__ import annotations

from typing import Protocol, TypeVar


class TriagedPdfReport(Protocol):
    """A triaged report held between the import dialog's calls.

    The CPT digitiser keeps a ``CachedPdfReport`` (digest + soundings), the
    borehole digitiser a ``CachedBoreholePdfReport`` (digest + boreholes); the
    store only needs the SHA-256 it is keyed on.
    """

    @property
    def report_sha(self) -> str:
        """Return the SHA-256 hex of the report bytes."""
        ...


# The report type one store instance holds (``PdfReportStore[ReportT]``).
ReportT = TypeVar("ReportT", bound=TriagedPdfReport)
