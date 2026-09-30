"""Response schema for one lab-series test with its whole tree."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.lab_series.lab_series_lab_result_response import (
    LabSeriesLabResultResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_specimen_response import (
    LabSeriesSpecimenResponse,
)
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class LabSeriesTestResponse(BaseModel):
    """One imported raw lab test: identity, source stamp, findings, readings.

    Served by ``GET /samples/{sample_id}/lab-series``. The lab's identity and
    header values are pass-through; ``import_issues`` are the parser findings
    frozen at import; ``lab_results`` are the lab's reported values.
    """

    id: UUID
    sample_id: UUID
    kind: str
    test_type_token: str | None = None
    standard_token: str | None = None
    lab_job_number: str | None = None
    lab_sample_number: str | None = None
    lab_borehole_name: str | None = None
    lab_sequence_number: str | None = None
    sampling_depth_top_m: float | None = None
    sampling_depth_base_m: float | None = None
    visual_description: str | None = None
    test_start_date: date | None = None
    source_format: str
    source_file_name: str
    source_native_file: str | None = None
    source_program_version: str | None = None
    source_header: dict[str, Any] = {}
    import_issues: list[ValidationIssueSchema] = []
    n_specimens: int = 0
    specimens: list[LabSeriesSpecimenResponse] = []
    lab_results: list[LabSeriesLabResultResponse] = []
