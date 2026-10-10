"""Pydantic schema for ``POST /borehole/pdf/import``."""

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.borehole.borehole_pdf_import_item import BoreholePdfImportItem
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class BoreholePdfImportRequest(StrictRequestModel):
    """Import the ticked boreholes of a triaged borehole-log report.

    Parameters
    ----------
    project_id:
        The project to import into.
    file_sha:
        SHA-256 of the report (from the triage).
    boreholes:
        The ticked boreholes with their confirmations, in import order.
    confirm_refresh:
        The user saw the old-vs-new diff and agreed to replace the boreholes
        already in the project (the XML import's consent rule).
    """

    project_id: UUID
    file_sha: str = Field(pattern=r"^[0-9a-f]{64}$")
    boreholes: list[BoreholePdfImportItem] = Field(min_length=1, max_length=500)
    confirm_refresh: bool = False
