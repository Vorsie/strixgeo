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
    defer_inference : bool
        When ``True``, the R7 inference hook
        (``RecomputeFormationAbsencesForFormation`` +
        ``MaterializeWedgeTipsForFormation``) is skipped for this call.
        Contact-commit and section-seed still run.  The caller is responsible
        for calling ``POST .../recompute-all-absences`` once after the full
        batch of deferred accepts to run inference in a single pass.  Defaults
        to ``False`` (original per-accept behaviour).
    """

    cpt_id: UUID | None = None
    borehole_id: UUID | None = None
    section_id: UUID | None = None
    suggestions: list[LithoLayerSuggestionItem] = Field(default_factory=list, min_length=1)
    defer_inference: bool = Field(
        default=False,
        description=(
            "When True, skip the per-accept inference + wedge-tip pass (R7 hook). "
            "The contact-commit and section-seed steps still run. "
            "The caller MUST follow with POST .../recompute-all-absences after all "
            "deferred accepts complete so inference runs once for the whole batch. "
            "Default False preserves the original per-accept behaviour."
        ),
    )

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> AcceptLithoSuggestionsRequest:
        """Enforce XOR on cpt_id / borehole_id."""
        has_cpt = self.cpt_id is not None
        has_borehole = self.borehole_id is not None
        if has_cpt == has_borehole:
            raise ValueError("Exactly one of 'cpt_id' or 'borehole_id' must be provided.")
        return self
