"""Result returned by the ImportBoreholeFile use case."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.application.imported_boring import ImportedBoring
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue


@dataclass
class ImportBoreholeFileResult:
    """Outcome of importing one local DOV borehole XML file.

    Attributes
    ----------
    boreholes : list[ImportedBoring]
        One entry per boring in the file, in file order.
    issues : list[ValidationIssue]
        File-level findings that belong to no single boring (an interpretation
        naming a boring the file does not hold).
    """

    boreholes: list[ImportedBoring] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)
