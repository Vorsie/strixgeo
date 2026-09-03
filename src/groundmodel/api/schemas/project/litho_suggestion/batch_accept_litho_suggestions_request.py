"""Pydantic schema: :class:`BatchAcceptLithoSuggestionsRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_anchor import (
    BatchAcceptLithoAnchor,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class BatchAcceptLithoSuggestionsRequest(StrictRequestModel):
    """Body of ``POST .../layers/batch-accept-litho-suggestions``.

    Accepts the suggestions for many anchors in a single request so the whole
    bulk-accept commits in one transaction (one fsync, one HTTP round-trip)
    instead of one call per anchor — the #153 batch lever.

    Parameters
    ----------
    anchors : list[BatchAcceptLithoAnchor]
        One entry per investigation, each carrying that anchor's accepted
        suggestion list.  Empty list is a no-op (returns zero counts).
    section_id : UUID | None
        When provided, every created/found contact id across all anchors is
        unioned into this section's ``seeded_formation_contact_ids`` in a
        single update (explicit-content invariant).
    run_inference : bool
        When ``True`` (default), ``RecomputeAllAbsencesForModel`` runs once
        after all anchors are committed — the batched equivalent of the
        frontend's post-loop recompute call.  When ``False`` the caller owns
        running inference.
    couple_tolerance_m : float
        Litho↔geo coupling coincidence tolerance (#162).  Forwarded verbatim
        to each per-anchor ``AcceptLithoSuggestions.execute(...)`` call.
        Sourced from the frontend's ``litho_snap_tolerance_m`` preference.
        Default 0.20 m.  Range 0.01 – 5.0 m.
    """

    anchors: list[BatchAcceptLithoAnchor] = Field(default_factory=list)
    section_id: UUID | None = None
    run_inference: bool = True
    couple_tolerance_m: float = Field(
        default=0.20,
        ge=0.01,
        le=5.0,
        description=(
            "Litho↔geo coupling coincidence tolerance (#162).  Forwarded verbatim "
            "to each per-anchor AcceptLithoSuggestions.execute call.  "
            "Sourced from the frontend's litho_snap_tolerance_m preference.  "
            "Default 0.20 m.  Range 0.01 – 5.0 m."
        ),
    )
