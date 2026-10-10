"""Pydantic schema: the user's confirmation of a coordinate system the sheets do not name."""

from typing import Literal

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class BoreholePdfCrsConfirmation(StrictRequestModel):
    """X/Y printed without a named system, confirmed by the user (owner ruling 2026-10-08, 3).

    Parameters
    ----------
    epsg:
        The system the printed X/Y are in: 31370 for "Lambert 72", another
        code for "another CRS" (the server refuses codes it cannot place,
        ``borehole_pdf_crs_unsupported``).
    scope:
        ``"this"``: this borehole is in that system; ``"report"``: every
        borehole of the report in this import is (a row without its own
        confirmation takes it).
    """

    epsg: int = Field(gt=0)
    scope: Literal["this", "report"]
