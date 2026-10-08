"""BoreholeTriageResult: the digest plus the sheets the triage already read."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_report_digest import (
    BoreholeReportDigest,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet


@dataclass(frozen=True)
class BoreholeTriageResult:
    """What a triage hands to the digitiser: no page is read twice.

    Parameters
    ----------
    digest : BoreholeReportDigest
        The listing.
    sheets : dict
        1-based page number -> the sheet read from it (log and continuation
        sheets only).
    """

    digest: BoreholeReportDigest
    sheets: dict[int, BoreholeSheet] = field(default_factory=dict)
