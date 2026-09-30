"""PdfReportIdentity: which report file a digitised sounding came from."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PdfReportIdentity:
    """The report a sounding was read from, for the stored provenance.

    Parameters
    ----------
    file_name : str
        The report's file name as the user picked it.
    file_sha : str
        SHA-256 of the report bytes (identifies the exact file).
    ocr_available : bool
        Whether OCR could be used while reading it.
    """

    file_name: str
    file_sha: str
    ocr_available: bool
