"""Result container for a completed DOV interpretation XML parse."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


@dataclass
class InterpretationParseResult:
    """Result of parsing a single DOV interpretation XML body.

    Carries one ``Observation`` (with its layers nested via the domain entity's
    relationship) plus a list of validation issues. Each layer's nested
    ``admixtures`` collection is also populated by the parser when present.

    Mirrors ``BoreholeParseResult`` and ``GEFParseResult`` — same shape, same
    ``has_errors`` / ``warnings`` accessors, same ``ValidationIssue`` schema,
    so the API can render a single union of validation findings without
    translating between formats.

    Parameters
    ----------
    observation : Observation
        Domain entity assembled from the interpretation XML, with its
        ``layers`` list (each layer with its ``admixtures``) populated.
        ``borehole_id`` is supplied by the caller (Phase C orchestrator),
        not by the XML itself — the orchestrator already knows which
        borehole an interpretation belongs to from the WFS row that led
        it to fetch this XML.
    issues : list[ValidationIssue]
        Validation findings produced during parsing — empty layer lists,
        unknown layer shapes, malformed intervals, etc.
    """

    observation: Observation
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return issue_warnings(self.issues)
