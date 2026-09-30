"""Pydantic schema: one calibration overlay image of a PDF sounding page."""

from pydantic import BaseModel


class CptPdfOverlay(BaseModel):
    """The page with its frames and the digitised curve in orange, as a PNG.

    Parameters
    ----------
    page_number:
        1-based page in the report.
    dpi:
        Render resolution (a PDF point is ``dpi / 72`` pixels).
    width, height:
        Image size in pixels.
    png_base64:
        The PNG, base64-encoded.
    """

    page_number: int
    dpi: float
    width: int
    height: int
    png_base64: str
