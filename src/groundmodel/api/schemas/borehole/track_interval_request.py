"""Pydantic schema for one interval of a hand-edited borehole track."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from groundmodel.api.schemas.borehole.track_admixture_request import TrackAdmixtureRequest
from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.borehole_track_constants import (
    MAX_TRACK_INTERVAL_ADMIXTURES,
    MAX_TRACK_MAIN_SOIL_CODES,
)


class TrackIntervalRequest(StrictRequestModel):
    """One depth interval of a track, in the ONE shape every kind shares.

    A field-log kind (``color`` / ``moisture`` / ``consistency``) fills
    ``value``; a coded kind (``coded_lithology`` / ``geotechnical_coding``)
    fills ``main_soil_codes`` (+ ``admixtures`` / ``color``); every other
    observation kind fills ``description``. The domain validator checks the
    kind-specific content and the depth rules (top < base, no overlap, 1 mm
    grain); the schema only bounds the sizes.
    """

    top_m: float
    base_m: float
    # Field-log value, raw DOV token (column is VARCHAR(200)).
    value: str | None = Field(default=None, max_length=200)
    # Free text or a stratigraphy unit code (column is TEXT, uncapped).
    description: str | None = None
    # Coded-row colour, raw DOV token (column is VARCHAR(50)).
    color: str | None = Field(default=None, max_length=50)
    main_soil_codes: list[Annotated[str, Field(max_length=20)]] = Field(
        default_factory=list, max_length=MAX_TRACK_MAIN_SOIL_CODES
    )
    admixtures: list[TrackAdmixtureRequest] = Field(
        default_factory=list, max_length=MAX_TRACK_INTERVAL_ADMIXTURES
    )
