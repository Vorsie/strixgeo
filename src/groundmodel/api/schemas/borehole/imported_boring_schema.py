"""Pydantic schema for one boring in the POST /borehole/import response."""

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class ImportedBoringSchema(BaseModel):
    """What happened to one boring of an imported DOV XML file.

    Parameters
    ----------
    borehole_id:
        New or refreshed borehole id; None when the boring was not imported.
    name:
        Display name (DOV alternative name when present, else identificatie).
    test_id:
        DOV identificatie, the dedup key.
    has_errors:
        True when at least one issue has level "error".
    issues:
        Every parse finding and import flag for this boring (error, warning,
        info), each message naming the boring.
    refreshed:
        True when an existing borehole was refreshed in place.
    imported:
        False when the boring was skipped (see its NOT_IMPORTED issue).
    """

    borehole_id: UUID | None
    name: str
    test_id: str
    has_errors: bool
    issues: list[ValidationIssueSchema]
    refreshed: bool = False
    imported: bool = True
