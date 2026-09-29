"""Pydantic schema for one track-validation finding on the wire."""

from __future__ import annotations

from pydantic import BaseModel


class TrackIssueResponse(BaseModel):
    """One finding of the track validator.

    ``loc`` is the dotted key path of the offending request field
    (``"intervals.3.base_m"``); ``code`` is machine-readable and the desktop
    translates it; ``message`` is the English log sentence.
    """

    loc: str
    code: str
    message: str
