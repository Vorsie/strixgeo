"""BoreholePageClass enum."""

from __future__ import annotations

from enum import StrEnum


class BoreholePageClass(StrEnum):
    """What a page of a borehole-log report is.

    Members
    -------
    LOG_SHEET
        The first sheet of a borehole log.
    CONTINUATION_SHEET
        A further sheet of the borehole on the sheet before it (same name).
    LEGEND
        The symbol legend of the logs.
    PHOTO
        Dominated by a photograph or a pasted image.
    NEEDS_OCR
        Content without a usable text layer (a scan, text converted to
        outlines) that OCR was not run on: what it is stays unknown.
    BLANK
        No text, no image, almost no drawing.
    OTHER
        Cover, table, report text, map: anything else.
    """

    LOG_SHEET = "log-sheet"
    CONTINUATION_SHEET = "continuation-sheet"
    LEGEND = "legend"
    PHOTO = "photo"
    NEEDS_OCR = "needs-ocr"
    BLANK = "blank"
    OTHER = "other"
