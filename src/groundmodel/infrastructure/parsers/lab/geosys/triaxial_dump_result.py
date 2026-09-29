"""Result of parsing one Geosys triaxial raw dump (one sample, n specimens)."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.lab.geosys.triaxial_specimen import TriaxialSpecimen
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


@dataclass
class TriaxialDumpResult:
    """One triaxial test on one sample: identity, specimens, findings.

    Parameters
    ----------
    source_name : str
        The file name the text came from (messages only).
    test_type : str or None
        The lab's test type token, verbatim (``"CD"``, ``"CU"``, ``"UU"``).
    job_number, report_for, origin : str or None
        Lab job, client contact, site text.
    borehole_name, sequence_number, sample_number : str or None
        Sample identity as the lab writes it.
    depth_top_m, depth_base_m : float or None
        Sampling interval, m below ground.
    visual_description : str or None
        The lab's visual description.
    specimens : list[TriaxialSpecimen]
        Every sub-specimen block, in file order.
    raw : dict[str, list[str]]
        Every sample-level header label → its value cells.
    issues : list[ValidationIssue]
        Findings.
    """

    source_name: str
    test_type: str | None = None
    job_number: str | None = None
    report_for: str | None = None
    origin: str | None = None
    borehole_name: str | None = None
    sequence_number: str | None = None
    sample_number: str | None = None
    depth_top_m: float | None = None
    depth_base_m: float | None = None
    visual_description: str | None = None
    specimens: list[TriaxialSpecimen] = field(default_factory=list)
    raw: dict[str, list[str]] = field(default_factory=dict)
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return only the WARNING-level issues."""
        return issue_warnings(self.issues)
