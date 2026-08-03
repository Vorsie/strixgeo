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
    refreshed:
        True when the file was already imported in this project and the
        EXISTING row was refreshed in place (same ``cpt_id``, series and header
        replaced from the fresh parse) instead of a new row being created. The
        endpoint answers 200 in that case and 201 for a genuinely new CPT.
    name:
        Display name persisted for the CPT — echoed so the client can name the
        record in its "refreshed" message without a follow-up fetch.
    """

    cpt_id: UUID
    has_errors: bool
    issues: list[ValidationIssueSchema]
    # Additive fields — default so an older client that ignores them, and any
    # caller constructing this schema by hand, keeps working (API rule:
    # additive only, new fields default).
    refreshed: bool = False
    name: str = ""
