"""Pydantic schema: the header fields the user may type for one PDF sounding."""

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class CptPdfHeaderEdit(StrictRequestModel):
    """Typed header values that replace the sheet's (all optional).

    Parameters
    ----------
    x, y:
        Position; both or neither (half a position is no position).
    epsg:
        Coordinate system of ``x`` / ``y`` (31370 Lambert72, 28992 RD).
    ground_level_m:
        Ground level; also converts an elevation axis to depth.
    test_date:
        Test date as typed.
    """

    x: float | None = None
    y: float | None = None
    epsg: int | None = Field(default=None, ge=1024, le=32767)
    ground_level_m: float | None = Field(default=None, ge=-500.0, le=9000.0)
    test_date: str | None = Field(default=None, max_length=40)
