"""Validation severity and issue types shared across all parsers (CPT, borehole, lab)."""

from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

__all__ = ["ValidationIssue", "ValidationLevel"]
