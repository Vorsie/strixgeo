"""Pydantic schema for the POST /borehole/import (local DOV XML file) response."""

from pydantic import BaseModel

from groundmodel.api.schemas.borehole.imported_boring_schema import ImportedBoringSchema
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class ImportBoreholeFileResponse(BaseModel):
    """Every boring of one uploaded DOV borehole XML file.

    Parameters
    ----------
    boreholes:
        One entry per ``<boring>`` in the file, in file order.
    file_issues:
        Findings that belong to no single boring (an interpretation naming a
        boring the file does not hold). Additive, defaults empty.
    """

    boreholes: list[ImportedBoringSchema]
    file_issues: list[ValidationIssueSchema] = []
