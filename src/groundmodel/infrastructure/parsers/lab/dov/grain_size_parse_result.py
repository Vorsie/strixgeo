"""Result container for a completed DOV grain-size observation parse."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.domain.models.lab.grain_size import GrainSize
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


@dataclass
class GrainSizeParseResult:
    """Result of parsing a single DOV grain-size observation XML.

    Carries one ``GrainSize`` entity plus a list of validation issues.
    Mirrors ``BoreholeParseResult`` / ``InterpretationParseResult`` /
    ``GEFParseResult`` — same shape, same ``has_errors`` / ``warnings``
    accessors, same ``ValidationIssue`` schema, so a unified validation
    view across CPT, borehole, and lab pipelines is one queue.

    The ``GrainSize`` always exists even when the source curve was
    unrecoverable — in that case its ``diameters_mm`` and ``pct_larger``
    arrays are empty and an ``INVALID_CURVE`` ERROR issue is present.
    The orchestrator inspects ``has_errors`` to decide whether to persist.

    Parameters
    ----------
    grain_size : GrainSize
        Domain entity with the curve, method, test_date, and
        pre-treatment booleans populated. ``sample_id`` is supplied by
        the caller (Phase C orchestrator), not the XML — the orchestrator
        already knows which sample an observation belongs to from the
        ``gekoppeld_aan_link`` it followed to fetch this XML.
    issues : list[ValidationIssue]
        Validation findings — empty / non-ascending / out-of-range
        curves, missing method, mismatched parametergroep, etc.
    """

    grain_size: GrainSize
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return issue_warnings(self.issues)
