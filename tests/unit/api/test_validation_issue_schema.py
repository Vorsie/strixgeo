"""The API rendering of a parse finding carries the numbers its message names."""

from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel


def test_a_finding_with_details_reaches_the_client_with_them() -> None:
    """PRE_DRILL_NOT_APPLIED: the desktop renders it in NL from the numbers, not the message."""
    issue = ValidationIssue(
        ValidationLevel.WARNING,
        "PRE_DRILL_NOT_APPLIED",
        "Pre-drill of 0.35 m declared ...",
        details={"pre_drill_m": 0.35, "first_depth_m": 0.02},
    )
    schema = ValidationIssueSchema.from_issue(issue)
    assert schema.level == "warning"
    assert schema.code == "PRE_DRILL_NOT_APPLIED"
    assert schema.details == {"pre_drill_m": 0.35, "first_depth_m": 0.02}


def test_a_finding_without_details_serialises_an_empty_map() -> None:
    """Additive field: every older code still serialises, with an empty map."""
    issue = ValidationIssue(ValidationLevel.INFO, "ROWS_WITHOUT_QC", "1 of 3 ...", rows=[1])
    body = ValidationIssueSchema.from_issue(issue).model_dump()
    assert body == {
        "level": "info",
        "code": "ROWS_WITHOUT_QC",
        "message": "1 of 3 ...",
        "rows": [1],
        "details": {},
    }
