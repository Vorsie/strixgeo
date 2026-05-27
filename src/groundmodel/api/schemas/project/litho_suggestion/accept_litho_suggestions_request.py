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
    create_formation_only: bool = Field(
        default=False,
        description=(
            "When True, find-or-create the litho formation(s) for each suggestion "
            "but do NOT create any contact row and do NOT seed "
            "``seeded_formation_contact_ids`` on the section. "
            "``depth_top_m`` / ``depth_base_m`` are used only for parent-formation "
            "inference (TIN sampling at the anchor's x/y + the suggestion's depth). "
            "Returns ``created_formation_ids`` / ``found_formation_ids`` as usual; "
            "``created_contact_ids`` and ``found_contact_ids`` are always empty. "
            "Use case: 'Add new unit' ghost flow — create the formation row before "
            "the user drags the ghost, so the normal ghost-accept can find it by its "
            "find-or-create key (Bug 2 dogfeed 2026-05-26). "
            "Default False preserves the original per-accept behaviour."
        ),
    )
    merge_same_lithology: bool = Field(
        default=True,
        description=(
            "When True (default), run ``merge_adjacent_same_lithology`` on the "
            "input suggestions before the find-or-create loop, mirroring the "
            "segmenter's final pass.  Catches pending ghosts that drifted from "
            "the merged shape because of user editing (split / insert / "
            "absorb) between Suggest and Accept — without this two stacked "
            "SAND ghosts could end up as two stacked SAND contacts even when "
            "the project's merge-same-lithology toggle is on.  When False the "
            "input is honoured verbatim: two adjacent SAND ghosts produce two "
            "adjacent SAND contacts (the user split them on purpose and the "
            "same-litho merge is opt-out).  The frontend forwards the same "
            "value the user picked in Settings → 'Merge same-lithology "
            "layers' so the Suggest and Accept halves of the flow share one "
            "rule (#149 fix, owner directive 2026-05-27)."
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
