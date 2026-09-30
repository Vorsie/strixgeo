"""Response schema for ``POST /lab-series/preview`` (nothing written)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class LabSeriesPreviewResponse(BaseModel):
    """The proposal the import dialog shows before anything is written.

    Mirrors :class:`~groundmodel.application.lab_series_preview.LabSeriesPreview`
    field for field (see there for each field's meaning). ``borehole_match``
    is ``unique`` | ``ambiguous`` | ``none`` | ``chosen``; ``sample_match`` is
    ``overlap`` | ``sample_number`` | ``none``. ``dov_lookup`` (additive,
    2026-09-30) is ``{status, borehole_name, borehole_id}`` with status
    ``fetched`` | ``not_found`` | ``unreachable`` when the borehole was looked
    up in DOV, else ``None``.
    """

    file_name: str
    kind: str
    source_format: str
    test_type_token: str | None = None
    identity: dict[str, Any]
    specimens: list[dict[str, Any]] = []
    borehole_candidates: list[dict[str, str]] = []
    borehole_match: str
    proposed_borehole_id: str | None = None
    samples: list[dict[str, Any]] = []
    proposed_sample_id: str | None = None
    sample_match: str
    create_sample_default: dict[str, Any] | None = None
    existing_test: dict[str, Any] | None = None
    issues: list[ValidationIssueSchema] = []
    has_errors: bool = False
    dov_lookup: dict[str, Any] | None = None
