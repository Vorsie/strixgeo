"""Outcome for one boring of a local DOV borehole XML file import."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issues_have_errors,
)


@dataclass
class ImportedBoring:
    """What happened to one boring of the file.

    Attributes
    ----------
    borehole_id : UUID | None
        The new row's id, the refreshed row's (unchanged) id, or None when the
        boring was not imported.
    name : str
        Display name (alternative name when DOV has one, else identificatie).
    test_id : str
        DOV identificatie, the dedup key.
    issues : list[ValidationIssue]
        Every parse finding and file-import flag for this boring.
    refreshed : bool
        True when an existing borehole was refreshed in place.
    imported : bool
        False when the boring was skipped (see its NOT_IMPORTED issue).
    """

    borehole_id: UUID | None
    name: str
    test_id: str
    issues: list[ValidationIssue] = field(default_factory=list)
    refreshed: bool = False
    imported: bool = True

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)
