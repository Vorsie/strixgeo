"""Result container for a completed GEF parse."""
from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from groundmodel.infrastructure.parsers.cpt.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.cpt.validation_level import ValidationLevel


@dataclass
class GEFParseResult:
    """Result of a GEF parse — header, detected type, data frame, and issues."""

    header: GEFHeader
    cpt_type: CPTType
    data: pl.DataFrame
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return any(i.level == ValidationLevel.ERROR for i in self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return [i for i in self.issues if i.level == ValidationLevel.WARNING]
