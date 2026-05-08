"""Result container for a completed GEF parse."""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel


@dataclass
class GEFParseResult:
    """Result of a GEF parse — header, detected type, data frame, and issues.

    Parameters
    ----------
    header : GEFHeader
        Parsed header metadata (project / test ids, location, cone properties).
    cpt_type : CPTType
        Detected CPT subtype (CPTU / CPTE / CPTM / UNKNOWN).
    data : pl.DataFrame
        Parsed measurement rows with normalised column names and units.
    issues : list[ValidationIssue]
        Validation findings emitted during parsing.
    rf_source : DerivedValueSource | None
        Provenance of the ``rf_pct`` column. ``MEASURED`` when the source GEF
        provided Rf directly (qty 4); ``COMPUTED`` when the parser derived it
        from qc and fs; ``None`` when the data has no Rf at all.
    qt_source : DerivedValueSource | None
        Provenance of the ``qt_mpa`` column. ``MEASURED`` when the source GEF
        provided qt directly (qty 15 for CPTU, qty 128 for CPTM totaalweerstand,
        or DOV's ``<Qt>`` element); ``COMPUTED`` when our code derived it from
        qc + u2 (1 - a) — currently never emitted because no parser computes qt;
        ``None`` when the data has no qt at all.
    """

    header: GEFHeader
    cpt_type: CPTType
    data: pl.DataFrame
    issues: list[ValidationIssue] = field(default_factory=list)
    rf_source: DerivedValueSource | None = None
    qt_source: DerivedValueSource | None = None

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return any(i.level == ValidationLevel.ERROR for i in self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return [i for i in self.issues if i.level == ValidationLevel.WARNING]
