"""Pydantic schema: :class:`AcceptLithoSuggestionsRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.project.litho_suggestion.litho_layer_suggestion_item import (
    LithoLayerSuggestionItem,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class AcceptLithoSuggestionsRequest(StrictRequestModel):
    """Body of ``POST .../layers/accept-litho-suggestions``.

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
        Contact-commit and section-seed still run.  Production bulk flows use
        ``POST .../layers/batch-accept-litho-suggestions`` with
        ``run_inference=True`` instead (the standalone recompute-all-absences
        finaliser endpoint was removed — BE-API-07); this per-call flag remains
        for callers that intentionally skip inference (e.g. seeding scripts /
        e2e fixtures).  Defaults to ``False`` (per-accept inference).
    couple_tolerance_m : float
        Litho↔geo coupling coincidence tolerance (#162).  A litho contact
        within this distance of a geological contact on the same investigation
        is linked and snapped to it.  Sourced from the frontend's
        ``litho_snap_tolerance_m`` preference.  Default 0.20 m.
        Range 0.01 – 5.0 m.
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
            "Production bulk flows use the batch-accept endpoint with "
            "run_inference=True instead; this flag remains for callers that "
            "intentionally skip inference. "
            "Default False preserves the original per-accept behaviour."
        ),
    )
    couple_tolerance_m: float = Field(
        default=0.20,
        ge=0.01,
        le=5.0,
        description=(
            "Litho↔geo coupling coincidence tolerance (#162).  A litho contact "
            "within this distance of a geological contact on the same investigation "
            "is linked and snapped to it, so moving one moves the other.  "
            "Sourced from the frontend's litho_snap_tolerance_m preference.  "
            "Default 0.20 m.  Range 0.01 – 5.0 m."
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
