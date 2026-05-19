"""Pydantic schema: :class:`AcceptLithoSuggestionsRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from groundmodel.api.schemas.project.litho_suggestion.litho_layer_suggestion_item import (
    LithoLayerSuggestionItem,
)


class AcceptLithoSuggestionsRequest(BaseModel):
    """Body of ``POST .../contacts/accept-litho-suggestions``.

    Carries the list of suggestions to commit plus the anchor investigation.
    Exactly one of ``cpt_id`` / ``borehole_id`` must be present (XOR enforced
    by ``_exactly_one_anchor``).

    Parameters
    ----------
    cpt_id : UUID | None
        CPT anchor.  Mutually exclusive with ``borehole_id``.
    borehole_id : UUID | None
        Borehole anchor.  Mutually exclusive with ``cpt_id``.
    section_id : UUID | None
        When provided, the accepted contact ids are unioned into this
        section's ``seeded_formation_contact_ids`` so they appear on the
        section immediately (explicit-content invariant).
    suggestions : list[LithoLayerSuggestionItem]
        The ordered suggestion list returned by the suggest-litho endpoint.
        The caller may pass a subset (e.g. only accepted layers).
    """

    cpt_id: UUID | None = None
    borehole_id: UUID | None = None
    section_id: UUID | None = None
    suggestions: list[LithoLayerSuggestionItem] = Field(default_factory=list, min_length=1)

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> AcceptLithoSuggestionsRequest:
        """Enforce XOR on cpt_id / borehole_id."""
        has_cpt = self.cpt_id is not None
        has_borehole = self.borehole_id is not None
        if has_cpt == has_borehole:
            raise ValueError("Exactly one of 'cpt_id' or 'borehole_id' must be provided.")
        return self
