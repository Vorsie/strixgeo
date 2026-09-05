"""A single validation finding produced during parsing (CPT, borehole, lab)."""

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel


@dataclass
class ValidationIssue:
    """A single validation finding from parsing."""

    level: ValidationLevel
    code: str
    message: str
    rows: list[int] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers — used by every ParseResult / Result class with an ``issues`` list.
# ---------------------------------------------------------------------------


def make_issue(level: ValidationLevel, code: str, message: str) -> ValidationIssue:
    """Build a row-less ``ValidationIssue`` from (level, code, message).

    Single source of truth for the no-row-index factory that the four DOV
    parsers (CPT / boring / interpretation / grain-size) each defined
    identically as a private ``_issue`` helper. Each imports this as ``_issue``
    so its call sites are unchanged.
    """
    return ValidationIssue(level=level, code=code, message=message)


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
