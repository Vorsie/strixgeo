"""Pydantic schema for one observation (interpretation stream) on a borehole."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from groundmodel.api.schemas.borehole.observation_layer_response import (
    ObservationLayerResponse,
)


class ObservationResponse(BaseModel):
    """One interpretation stream attached to a borehole.

    A borehole can carry multiple observations of different ``observation_type``s
    (coded_lithology, formal_stratigraphy, ...). Each is its own row with its
    own author / date / quality metadata and aggregates its layers via the
    ``layers`` list.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    observation_type: str
    author: str | None
    observation_date: date | None
    reliability: str | None
    score_category: str | None
    drill_method_score: str | None
    layers: list[ObservationLayerResponse]
    # Provenance of the track (Data Integrity rule 1, 2026-09-29). Optional
    # with defaults so the shape stays additive: ``source`` is ``"dov"`` /
    # ``"manual"``; ``edited_manually_at`` is set once the track was saved
    # from the track editor; ``dov_permkey`` is the upstream identity an
    # edited import keeps.
    source: str = "dov"
    edited_manually_at: datetime | None = None
    dov_permkey: str | None = None
