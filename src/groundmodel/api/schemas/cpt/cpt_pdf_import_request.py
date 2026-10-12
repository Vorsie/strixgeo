"""Pydantic schema for ``POST /cpt/pdf/import``."""

from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.cpt.cpt_pdf_header_edit import CptPdfHeaderEdit
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class CptPdfImportRequest(StrictRequestModel):
    """Import the ticked soundings of a triaged report.

    Parameters
    ----------
    project_id:
        The project to import into.
    file_sha:
        SHA-256 of the report (from the triage).
    sounding_ids:
        The ticked soundings' keys, in the order to import them.
    calibrations:
        Sounding key -> the ``PageCalibration`` dicts the user settled on in
        the calibration overlay (pages left out keep the digitiser's own).
    headers:
        Sounding key -> typed header values (position, ground level, date).
    series_source:
        Sounding key -> where a printed-table sounding's stored series comes
        from: ``"table"`` (the printed rows, the default when a key is absent)
        or ``"graph"`` (the curve read off its graph sheet through the
        calibration in ``calibrations``). Additive (owner 2026-10-12).
    confirm_refresh:
        The user consented to replacing these soundings where they are
        already in the project. The dialog re-posts only the soundings he
        agreed to, one consent dialog at a time.
    """

    project_id: UUID
    file_sha: str = Field(pattern=r"^[0-9a-f]{64}$")
    sounding_ids: list[str] = Field(min_length=1, max_length=500)
    calibrations: dict[str, list[dict[str, Any]]] | None = None
    headers: dict[str, CptPdfHeaderEdit] | None = None
    series_source: dict[str, Literal["table", "graph"]] | None = None
    confirm_refresh: bool = False
