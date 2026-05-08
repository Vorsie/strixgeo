"""Pydantic schema for one depth interval within an observation."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from groundmodel.api.schemas.borehole.admixture_response import AdmixtureResponse


class ObservationLayerResponse(BaseModel):
    """One depth interval within an observation.

    Carries both the lithology sub-shape (``color`` + ``main_soil_codes`` +
    ``admixtures``) and the stratigraphy sub-shape (``description``) — the
    parent observation's ``observation_type`` discriminates which is
    populated. See ``observation_layer_orm`` docstring for the layout
    rationale.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    top_m: float
    base_m: float
    color: str | None
    main_soil_codes: list[str]
    description: str | None
    layer_index: int
    admixtures: list[AdmixtureResponse]
