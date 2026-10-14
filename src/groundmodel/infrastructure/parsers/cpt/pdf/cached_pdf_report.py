"""CachedPdfReport: a triaged report kept in memory between the dialog's calls."""

from __future__ import annotations

import threading
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
        reads it: that costs OCR per sheet). Filled by the background read
        that follows the triage (owner 2026-10-14) or, as the fallback, when
        the overlay opens it; kept for the report's lifetime so reopening the
        overlay does not read it again.
    """

    path: Path
    file_name: str
    digest: PdfReportDigest
    soundings: dict[str, DigitisedSounding]
    graph_twins: dict[str, DigitisedSounding] = field(default_factory=dict)
    # One lock per sounding key: the background read and an overlay opened
    # mid-read wait for each other instead of reading the same sheet twice.
    _twin_locks: dict[str, threading.Lock] = field(default_factory=dict, repr=False)
    _twin_guard: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def twin_lock(self, key: str) -> threading.Lock:
        """Return the lock that guards reading one sounding's graph sheets.

        Parameters
        ----------
        key : str
            The listed sounding's key.

        Returns
        -------
        threading.Lock
            The same lock for every caller of that key.
        """
        with self._twin_guard:
            lock = self._twin_locks.get(key)
            if lock is None:
                lock = self._twin_locks[key] = threading.Lock()
            return lock

    @property
    def report_sha(self) -> str:
        """Return the SHA-256 hex of the report (the store's key)."""
        return self.digest.file_sha
