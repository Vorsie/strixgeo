"""Pydantic schema for the ``POST /cpt/pdf/import`` answer."""

from pydantic import BaseModel

from groundmodel.api.schemas.cpt.cpt_pdf_import_result_item import CptPdfImportResultItem


class CptPdfImportResponse(BaseModel):
    """One outcome per requested sounding, in request order.

    Parameters
    ----------
    results:
        The outcomes.
    """

    results: list[CptPdfImportResultItem]
