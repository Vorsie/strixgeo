"""A single validation finding produced during CPT parsing."""

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel


@dataclass
class ValidationIssue:
    """A single validation finding from CPT parsing."""

    level: ValidationLevel
    code: str
    message: str
    rows: list[int] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers — used by every ParseResult / Result class with an ``issues`` list.
# ---------------------------------------------------------------------------


def issues_have_errors(issues: list[ValidationIssue]) -> bool:
    """Return ``True`` when any issue has ERROR severity.

    Single source of truth for the "has it failed?" predicate every
    ``*ParseResult`` / ``Import*Result`` class delegates to. Changing the
    ERROR semantic (e.g. adding a CRITICAL level above ERROR) only needs
    a one-line change here instead of touching each result class.
    """
    return any(i.level == ValidationLevel.ERROR for i in issues)


def issue_warnings(issues: list[ValidationIssue]) -> list[ValidationIssue]:
    """Return only the WARNING-level entries from *issues*, in source order."""
    return [i for i in issues if i.level == ValidationLevel.WARNING]
