"""Pydantic schema: :class:`LithoLayerCompositionRequest`."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.project.admixture_item import AdmixtureItem
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerCompositionRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{pid}/geology/models/{mid}/layers/{lid}/composition``.

    "Edit composition" for one accepted litho layer: repoint it to the litho
    unit for a different ``(main soil code, admixtures)`` composition — e.g. turn
    an accepted SILT into a ZAND — without deleting the layer. Depths, anchor and
    status are unchanged; only which formation (unit) the layer belongs to.

    Parameters
    ----------
    litho_main_soil_code : str
        Target BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN).
    admixtures : list[AdmixtureItem]
        Target admixtures for the unit (empty for a pure lithology).
    """

    litho_main_soil_code: str = Field(min_length=1, max_length=20)
    admixtures: list[AdmixtureItem] = Field(default_factory=list)
