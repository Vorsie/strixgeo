"""Pydantic schema: one ticked borehole of ``POST /borehole/pdf/import``."""

from pydantic import Field

from groundmodel.api.schemas.borehole.borehole_pdf_crs_confirmation import (
    BoreholePdfCrsConfirmation,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class BoreholePdfImportItem(StrictRequestModel):
    """One borehole to import, with the confirmations its findings ask for.

    Parameters
    ----------
    key:
        The borehole's triage key (``"<name>@p<first page>"``).
    crs:
        The confirmed coordinate system for X/Y printed without one; required
        (here or on another row with scope ``"report"``) when the triage
        listed ``CRS_ASSUMED``.
    water_unit_confirmed:
        The water level reads as cm below ground (owner ruling 2026-10-08,
        4); required True when the triage listed ``WATER_UNIT_ASSUMED``.
    """

    key: str = Field(min_length=1, max_length=400)
    crs: BoreholePdfCrsConfirmation | None = None
    water_unit_confirmed: bool = False
