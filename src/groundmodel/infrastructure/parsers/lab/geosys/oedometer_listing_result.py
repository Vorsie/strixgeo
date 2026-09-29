"""Result of parsing one Geosys oedometer control listing."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.lab.geosys.oedometer_lab_summary_row import (
    OedometerLabSummaryRow,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_listing_header import (
    OedometerListingHeader,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_stage import OedometerStage
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


@dataclass
class OedometerListingResult:
    """One oedometer test: header, raw stages, the lab's summary, findings.

    Parameters
    ----------
    source_name : str
        The file name the text came from (for messages only).
    header : OedometerListingHeader
        Sample identity and specimen metadata.
    stages : list[OedometerStage]
        Every load step with every reading, in test order.
    lab_summary : list[OedometerLabSummaryRow]
        The lab's per-stage derived table (first copy only).
    issues : list[ValidationIssue]
        Findings from parsing and the raw-data cross-checks.
    """

    source_name: str
    header: OedometerListingHeader
    stages: list[OedometerStage] = field(default_factory=list)
    lab_summary: list[OedometerLabSummaryRow] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return only the WARNING-level issues."""
        return issue_warnings(self.issues)
