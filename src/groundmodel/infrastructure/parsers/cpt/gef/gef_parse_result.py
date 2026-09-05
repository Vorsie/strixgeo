"""Result container for a completed GEF parse."""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


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
    elevation_source : ElevationSource
        Provenance of ``header.z``. Stamped by each parser based on which
        kind of source produced the result — GEFParser stamps ``GEF``,
        DovParser stamps ``DOV``. Defaults to ``NONE`` so a future
        result type that doesn't yet carry an elevation surfaces as
        "unknown source" rather than a silent fake. Debt #8.

    Notes
    -----
    There is no ``qt_source`` field. ``qt_mpa`` (CPTU corrected cone resistance)
    is currently always source-provided in our pipeline — we never compute
    ``qt = qc + u2 (1 - a)`` ourselves. ``q_total_mpa`` (CPTM totaalweerstand)
    is structurally a measurement, never a derivation. If a future
    ``_calculate_qt`` pathway is added for CPTU, this field can be reintroduced
    in symmetry with ``rf_source``.
    """

    header: GEFHeader
    cpt_type: CPTType
    data: pl.DataFrame
    issues: list[ValidationIssue] = field(default_factory=list)
    rf_source: DerivedValueSource | None = None
    elevation_source: ElevationSource = ElevationSource.NONE

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return issue_warnings(self.issues)
