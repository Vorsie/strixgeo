"""Pydantic schema for a single parse validation finding."""

from typing import Any

from pydantic import BaseModel


class ValidationIssueSchema(BaseModel):
    """Serialisable representation of a parse / import ``ValidationIssue``.

    Parameters
    ----------
    level:
        ``"error"`` | ``"warning"`` | ``"info"``.
    code:
        Stable machine code; the desktop keys its translated sentence on it.
    message:
        English sentence (shown as the raw tooltip next to the translation).
    rows:
        Source row indices (GEF); empty when none.
    params:
        The message's variable parts (names, counts, depths, permkeys) as JSON
        values, so the desktop renders the finding in the user's language.
        Additive (2026-10-04), defaults empty; a client that ignores it keeps
        showing ``message``.
    """

    level: str  # "error" | "warning" | "info"
    code: str
    message: str
    rows: list[int]
    params: dict[str, Any] = {}
