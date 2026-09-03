"""Pydantic schema: :class:`BatchAcceptLithoAnchor`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.project.litho_suggestion.litho_layer_suggestion_item import (
    LithoLayerSuggestionItem,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class BatchAcceptLithoAnchor(StrictRequestModel):
    """One anchor's accepted suggestions inside a batch accept request.

    Mirrors the single-accept body minus ``section_id`` (the batch request
    carries one shared ``section_id`` for all anchors).  Exactly one of
    ``cpt_id`` / ``borehole_id`` must be present.

    Parameters
    ----------
    cpt_id : UUID | None
        CPT anchor.  Mutually exclusive with ``borehole_id``.
    borehole_id : UUID | None
        Borehole anchor.  Mutually exclusive with ``cpt_id``.
    suggestions : list[LithoLayerSuggestionItem]
        The ordered (typically already user-edited) suggestion list to commit
        for this anchor.
    """

    cpt_id: UUID | None = None
    borehole_id: UUID | None = None
    suggestions: list[LithoLayerSuggestionItem] = Field(default_factory=list, min_length=1)

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> BatchAcceptLithoAnchor:
        """Enforce XOR on cpt_id / borehole_id."""
        if (self.cpt_id is not None) == (self.borehole_id is not None):
            raise ValueError("Exactly one of 'cpt_id' or 'borehole_id' must be provided.")
        return self
