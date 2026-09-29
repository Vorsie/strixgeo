"""Pydantic schema for one admixture of a hand-edited track interval."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class TrackAdmixtureRequest(StrictRequestModel):
    """One admixture (secondary soil) of a coded-lithology track interval.

    Raw DOV tokens, never translated: ``soil_code`` from DOV's
    ``codetabel_hoofdnaam`` (``"KL"``, ``"GL"``, ...), ``amount`` one of the DOV
    steps (``""`` unspecified). The desktop picker offers only codelist values;
    the backend stores what it receives (translation and the codelist live at
    the presentation boundary).
    """

    soil_code: str = Field(min_length=1, max_length=20)
    amount: str = Field(default="", max_length=10)
    locally: bool = False
