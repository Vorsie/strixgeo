"""Pydantic schema for a single parse / import validation finding."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue


class ValidationIssueSchema(BaseModel):
    """Serialisable representation of a parse / import ``ValidationIssue``.

    Attributes
    ----------
    level : str
        ``"error"`` | ``"warning"`` | ``"info"``.
    code : str
        Stable machine code; the desktop keys its translated sentence on it.
    message : str
        English sentence (shown as the raw tooltip next to the translation).
    rows : list[int]
        Source row indices (GEF); empty when none.
    details : dict[str, float]
        The numbers the message names (e.g. ``pre_drill_m`` /
        ``first_depth_m`` for ``PRE_DRILL_NOT_APPLIED``), so a client renders
        the finding in its own language. Additive: empty for most codes, and
        an older client ignores it.
    params : dict[str, Any]
        The message's variable parts (names, counts, depths, permkeys) as JSON
        values, so the desktop renders the finding in the user's language.
        Additive (2026-10-04), defaults empty; a client that ignores it keeps
        showing ``message``.
    """

    level: str
    code: str
    message: str
    rows: list[int]
    details: dict[str, float] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_issue(cls, issue: ValidationIssue) -> ValidationIssueSchema:
        """Build the wire shape of a parser finding.

        Parameters
        ----------
        issue : ValidationIssue
            The finding as the parser raised it.

        Returns
        -------
        ValidationIssueSchema
            The same finding with its level as the lowercase string value.
        """
        return cls(
            level=issue.level.value,
            code=issue.code,
            message=issue.message,
            rows=issue.rows,
            details=dict(issue.details),
            params=dict(issue.params),
        )
