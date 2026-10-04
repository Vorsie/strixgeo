"""A single validation finding produced during parsing (CPT, borehole, lab)."""

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel


@dataclass
class ValidationIssue:
    """A single validation finding from parsing.

    Parameters
    ----------
    level : ValidationLevel
        Severity.
    code : str
        Stable machine code (``NAME_FROM_ALTERNATIVE``, ``INVALID_INTERVAL``, ...).
    message : str
        English sentence for logs and as the raw tooltip in the desktop.
    rows : list[int]
        Source row indices the finding concerns (GEF); empty when none.
    params : dict[str, Any]
        The variable parts of the message (names, counts, depths, permkeys) as
        JSON-safe values, so the desktop can render the finding in the user's
        language from a per-code catalogue entry (translate at the presentation
        boundary). Empty for a code without variable parts, and for codes the
        catalogue does not know yet (the desktop then shows ``message``).
    """

    level: ValidationLevel
    code: str
    message: str
    rows: list[int] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers — used by every ParseResult / Result class with an ``issues`` list.
# ---------------------------------------------------------------------------


def make_issue(
    level: ValidationLevel,
    code: str,
    message: str,
    params: dict[str, Any] | None = None,
) -> ValidationIssue:
    """Build a row-less ``ValidationIssue`` from (level, code, message[, params]).

    Single source of truth for the no-row-index factory that the four DOV
    parsers (CPT / boring / interpretation / grain-size) each defined
    identically as a private ``_issue`` helper. Each imports this as ``_issue``
    so its call sites are unchanged.

    Parameters
    ----------
    level : ValidationLevel
        Severity.
    code : str
        Machine code.
    message : str
        English sentence (logs, tooltip).
    params : dict[str, Any] | None
        Variable parts of the message for the desktop catalogue; ``None``
        stores an empty dict.

    Returns
    -------
    ValidationIssue
        The finding.
    """
    return ValidationIssue(level=level, code=code, message=message, params=dict(params or {}))


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


def interval_params(
    part: str, top_m: float | None, base_m: float | None, reason: str
) -> dict[str, Any]:
    """Build the ``params`` of an ``INVALID_INTERVAL`` finding.

    Shared by the DOV boring parser (drill segments, field log) and the
    interpretation parser (layers) so the desktop catalogue reads one shape.

    Parameters
    ----------
    part : str
        What the interval belongs to: ``"drill_segment"``, a field-log kind
        (``"color"``, ``"moisture"``, ``"consistency"``) or ``"layer"``.
    top_m, base_m : float | None
        The interval as the source gave it.
    reason : str
        ``"base_not_below_top"`` (inverted or empty interval) or
        ``"invalid_value"`` (a single-field guard refused it; the English
        message carries the detail).

    Returns
    -------
    dict[str, Any]
        ``{"part", "top_m", "base_m", "reason"}``.
    """
    return {"part": part, "top_m": top_m, "base_m": base_m, "reason": reason}
