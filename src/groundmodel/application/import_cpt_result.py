"""Result returned by the ImportCpt use case."""

from dataclasses import dataclass
from uuid import UUID

from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


@dataclass
class ImportCptResult:
    """Outcome of a single CPT import.

    Returned by ``ImportCpt.execute()``.  The CPT is always persisted even when
    ``has_errors`` is True — callers decide whether to surface or suppress the
    record based on their context.

    Attributes
    ----------
    cpt_id : UUID
        UUID7 of the newly created ``CptOrm`` row — or, when ``refreshed`` is
        True, the id of the pre-existing row that was updated in place.
    issues : list[ValidationIssue]
        All parse findings (ERROR, WARNING, INFO) from the GEF parser.
    refreshed : bool
        True when the import updated a CPT that was already present in the
        project (same GEF project_id + test_id) instead of creating a new row.
        Callers surface this differently: "imported" vs "refreshed from file".
    name : str
        Display name persisted on the row — the API echoes it so the desktop
        can name the CPT in its toast without a follow-up fetch. Defaults to
        the empty string for results built by callers that never surface it
        (bulk imports, test doubles).
    """

    cpt_id: UUID
    issues: list[ValidationIssue]
    refreshed: bool = False
    name: str = ""

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return issue_warnings(self.issues)
