"""Pydantic schema for one admixture inside an observation layer."""

from pydantic import BaseModel, ConfigDict


class AdmixtureResponse(BaseModel):
    """One admixture (secondary soil component) inside an observation layer.

    DOV source-vocabulary tokens are passed through verbatim — translation to
    English is a presentation concern (CLAUDE.md memory: "DOV codelists &
    translation strategy"). The frontend looks up display labels at render
    time.
    """

    model_config = ConfigDict(from_attributes=True)

    soil_code: str
    amount: str
    locally: bool
