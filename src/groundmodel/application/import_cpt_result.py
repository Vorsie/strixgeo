"""Result returned by the ImportCpt use case."""
from dataclasses import dataclass
from uuid import UUID

from groundmodel.infrastructure.parsers.cpt.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel


@dataclass
class ImportCptResult:
    """Outcome of a single CPT import.

    Returned by ``ImportCpt.execute()``.  The CPT is always persisted even when
    ``has_errors`` is True — callers decide whether to surface or suppress the
    record based on their context.

    Attributes
    ----------
    cpt_id : UUID
        UUID7 of the newly created ``CptOrm`` row.
    issues : list[ValidationIssue]
        All parse findings (ERROR, WARNING, INFO) from the GEF parser.
    """

    cpt_id: UUID
    issues: list[ValidationIssue]

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return any(i.level == ValidationLevel.ERROR for i in self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return [i for i in self.issues if i.level == ValidationLevel.WARNING]
