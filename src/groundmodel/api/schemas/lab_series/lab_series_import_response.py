"""Response schema for ``POST /lab-series/import``."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class LabSeriesImportResponse(BaseModel):
    """What the import did (201 new; 200 refreshed or unchanged).

    Parameters
    ----------
    test_id, sample_id : UUID
        The stored test and its sample.
    kind : str
        ``oedometer`` | ``triaxial``.
    created_sample : bool
        The import created the sample.
    refreshed : bool
        A stored test with the same identity was replaced (consented).
    unchanged : bool
        The same file was already stored; nothing was written.
    has_errors : bool
        Any finding is an ERROR (the test is still stored when new).
    issues : list[ValidationIssueSchema]
        The file's findings.
    """

    test_id: UUID
    sample_id: UUID
    kind: str
    created_sample: bool = False
    refreshed: bool = False
    unchanged: bool = False
    has_errors: bool = False
    issues: list[ValidationIssueSchema] = []
