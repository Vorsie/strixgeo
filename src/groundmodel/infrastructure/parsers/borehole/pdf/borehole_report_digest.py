"""BoreholeReportDigest: the triage of one borehole-log report."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class import (
    BoreholePageClass,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_verdict import (
    BoreholePageVerdict,
)
from groundmodel.infrastructure.parsers.borehole.pdf.report_borehole import ReportBorehole


@dataclass(frozen=True)
class BoreholeReportDigest:
    """Per-page classes and the boreholes found, ready for a list or a JSON file.

    Parameters
    ----------
    file_name : str
        The report's file name.
    file_sha : str
        SHA-256 of the report bytes (empty when triaged from memory).
    page_count : int
        Pages in the report.
    pages : tuple of BoreholePageVerdict
        One verdict per triaged page.
    boreholes : tuple of ReportBorehole
        The boreholes, in report order.
    pages_not_triaged : int
        Pages beyond the page cap, not looked at.
    ocr_available : bool
        Whether OCR could be used.
    ocr_pages : tuple of int
        Pages read by OCR.
    """

    file_name: str
    file_sha: str
    page_count: int
    pages: tuple[BoreholePageVerdict, ...]
    boreholes: tuple[ReportBorehole, ...]
    pages_not_triaged: int = 0
    ocr_available: bool = False
    ocr_pages: tuple[int, ...] = field(default_factory=tuple)

    @property
    def class_counts(self) -> dict[str, int]:
        """Return page class value -> count, in first-seen order."""
        return dict(Counter(p.page_class.value for p in self.pages))

    @property
    def needs_ocr_pages(self) -> tuple[int, ...]:
        """Return the pages that hold content only OCR can read."""
        return tuple(
            p.page_number for p in self.pages if p.page_class is BoreholePageClass.NEEDS_OCR
        )

    def to_dict(self) -> dict[str, Any]:
        """Return the digest as a JSON-ready dict."""
        return {
            "file_name": self.file_name,
            "file_sha": self.file_sha,
            "page_count": self.page_count,
            "pages_not_triaged": self.pages_not_triaged,
            "class_counts": self.class_counts,
            "needs_ocr_pages": list(self.needs_ocr_pages),
            "ocr_available": self.ocr_available,
            "ocr_pages": list(self.ocr_pages),
            "boreholes": [b.to_dict() for b in self.boreholes],
            "pages": [p.to_dict() for p in self.pages],
        }
