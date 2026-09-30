"""Pydantic schema for ``POST /cpt/pdf/digitise``."""

from typing import Any
from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class CptPdfDigitiseRequest(StrictRequestModel):
    """Read one listed sounding, optionally through edited calibrations.

    Parameters
    ----------
    project_id:
        The project the report was uploaded into.
    file_sha:
        SHA-256 of the report (from the triage).
    sounding_id:
        The listed sounding's key.
    calibrations:
        ``PageCalibration`` dicts (as ``/digitise`` returned them) for the
        pages the user re-calibrated; omitted pages keep the digitiser's own.
    ground_level_m:
        A typed ground level (converts an elevation axis to depth).
    """

    project_id: UUID
    file_sha: str = Field(pattern=r"^[0-9a-f]{64}$")
    sounding_id: str = Field(min_length=1, max_length=200)
    calibrations: list[dict[str, Any]] | None = Field(default=None, max_length=20)
    ground_level_m: float | None = Field(default=None, ge=-500.0, le=9000.0)
