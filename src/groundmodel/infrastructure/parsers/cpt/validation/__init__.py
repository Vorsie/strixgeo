"""Back-compat shim: validation package moved to ``parsers.validation`` (shared by all parsers)."""

from groundmodel.infrastructure.parsers.validation import ValidationIssue, ValidationLevel

__all__ = ["ValidationIssue", "ValidationLevel"]
