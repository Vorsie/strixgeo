"""PdfReportDigest: what the import dialog shows after triaging a report."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.dropped_sheet import DroppedSheet
from groundmodel.infrastructure.parsers.cpt.pdf.report_fingerprint import ReportFingerprint
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding


@dataclass(frozen=True)
class PdfReportDigest:
    """The triage of one report: what can be imported and what was set aside.

    Parameters
    ----------
    file_sha : str
        SHA-256 of the report file (the handle later calls use).
    page_count : int
        Pages in the report.
    class_counts : dict
        Page class value -> count (prose, photo, cpt-graph, ...).
    campaign : tuple of ReportSounding
        The campaign's own soundings, page order: offered for import.
    unknown : tuple of ReportSounding
        CPT sheets whose origin could not be decided: listed apart, the user
        may tick them.
    dropped : tuple of DroppedSheet
        Desk-study reprints, repeated sheets and unreadable sheets.
    fingerprint : ReportFingerprint
        The campaign the report is about.
    ocr_available : bool
        Whether tick labels could be read by OCR; False -> the UI says "tick
        reading unavailable: type the axis values".
    raster_pages_unread : int
        Image pages not looked at because the raster engine is absent.
    """

    file_sha: str
    page_count: int
    class_counts: dict[str, int]
    campaign: tuple[ReportSounding, ...]
    unknown: tuple[ReportSounding, ...]
    dropped: tuple[DroppedSheet, ...]
    fingerprint: ReportFingerprint
    ocr_available: bool
    raster_pages_unread: int = 0
    profiles: tuple[str, ...] = field(default_factory=tuple)

    @property
    def desk_study_ids(self) -> tuple[str, ...]:
        """Return the desk-study sounding ids, each once, in page order."""
        seen: list[str] = []
        for d in self.dropped:
            if d.reason == "desk-study" and d.sounding_id not in seen:
                seen.append(d.sounding_id)
        return tuple(seen)

    @property
    def report_code(self) -> str | None:
        """Return the campaign code the report is about ("CAMZ-001"), if found."""
        codes = self.fingerprint.campaign_codes
        return codes[0] if codes else None

    def sounding(self, key: str) -> ReportSounding | None:
        """Return the listed sounding with ``key`` (campaign or unknown).

        Parameters
        ----------
        key : str
            The sounding key.

        Returns
        -------
        ReportSounding or None
            The sounding, or None when the report lists none by that key.
        """
        for s in self.campaign + self.unknown:
            if s.key == key:
                return s
        return None

    def to_dict(self) -> dict[str, Any]:
        """Return the digest as a JSON-ready dict for the UI."""
        return {
            "file_sha": self.file_sha,
            "page_count": self.page_count,
            "class_counts": dict(self.class_counts),
            "campaign": [s.to_dict() for s in self.campaign],
            "unknown": [s.to_dict() for s in self.unknown],
            "dropped": [d.to_dict() for d in self.dropped],
            "desk_study_ids": list(self.desk_study_ids),
            "report_code": self.report_code,
            "campaign_codes": list(self.fingerprint.campaign_codes),
            "project_numbers": list(self.fingerprint.project_numbers),
            "ocr_available": self.ocr_available,
            "raster_pages_unread": self.raster_pages_unread,
            "profiles": list(self.profiles),
        }
