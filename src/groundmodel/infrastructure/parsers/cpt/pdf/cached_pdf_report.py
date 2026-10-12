"""CachedPdfReport: a triaged report kept in memory between the dialog's calls."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest


@dataclass(frozen=True, eq=False)
class CachedPdfReport:
    """One triaged report: the file, the digest and the digitised soundings.

    Parameters
    ----------
    path : pathlib.Path
        The spooled report file.
    file_name : str
        The name the user picked it under (for the stored provenance).
    digest : PdfReportDigest
        What the triage found.
    soundings : dict
        Sounding key -> the digitised sounding, as the triage read it (no
        user calibration applied).
    graph_twins : dict
        Sounding key -> the graph sheet of a printed-table sounding as read
        automatically when the overlay first opened it (the triage never
        reads it: that costs OCR per sheet). Filled on demand, kept for the
        report's lifetime so reopening the overlay does not read it again.
    """

    path: Path
    file_name: str
    digest: PdfReportDigest
    soundings: dict[str, DigitisedSounding]
    graph_twins: dict[str, DigitisedSounding] = field(default_factory=dict)

    @property
    def report_sha(self) -> str:
        """Return the SHA-256 hex of the report (the store's key)."""
        return self.digest.file_sha
