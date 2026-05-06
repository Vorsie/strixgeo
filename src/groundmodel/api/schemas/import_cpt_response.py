"""Pydantic schema for the import CPT endpoint response."""

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class ImportCptResponse(BaseModel):
    """Response returned by POST /cpt/import.

    Parameters
    ----------
    cpt_id:
        UUID of the newly created CPT record.
    has_errors:
        True when at least one validation issue with level "error" is present.
        The CPT is still persisted — callers decide whether to surface it.
    issues:
        All validation findings produced during parsing, in the order they were
        raised.  Includes errors, warnings, and informational messages.
    """

    cpt_id: UUID
    has_errors: bool
    issues: list[ValidationIssueSchema]
