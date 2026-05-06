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
