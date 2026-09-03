"""Pydantic schema: :class:`LithoLayerBulkCreateRequest` (Slice A2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerConfidenceLiteral,
    LithoLayerSourceLiteral,
    LithoLayerStatusLiteral,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerCreateItem(StrictRequestModel):
    """One per-layer payload in a bulk-create."""

    formation_id: UUID
    # ``allow_inf_nan=False``: JSON carries a bare ``NaN`` literal, every
    # comparison against NaN is false, so a NaN depth walks through the
    # ordering validator below and only trips the DB CHECK — a 500 for a typo.
    depth_top_m: float = Field(allow_inf_nan=False)
    depth_base_m: float = Field(allow_inf_nan=False)
    status: LithoLayerStatusLiteral = "pending"
    source: LithoLayerSourceLiteral = "segmenter"
    confidence: LithoLayerConfidenceLiteral = "medium"
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    parent_geo_contact_id: UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _xor_anchor_and_depth_order(self) -> LithoLayerCreateItem:
        """Anchor XOR + depth ordering guard.

        Both are enforced at the DB level (CHECK constraints) but
        Pydantic-level rejection gives a 422 with a clearer message
        than a Postgres IntegrityError.
        """
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError("Each layer item requires exactly one of borehole_id / cpt_id")
        if self.depth_top_m >= self.depth_base_m:
            raise ValueError("Each layer item requires depth_top_m strictly less than depth_base_m")
        return self


class LithoLayerBulkCreateRequest(StrictRequestModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/layers``.

    Inserts N rows in one transaction. Used by the suggest-litho
    persistence path (segmenter output → pending layers) and by the
    manual-create-contact path (single-item array with section_id) after
    the A4 cut-over.

    The optional ``section_id`` carries the explicit-content invariant
    forward from the contact-side endpoint: when the user manually draws
    a layer on a section, that section's ``seeded_formation_contact_ids``
    array gets unioned with the freshly-created layer ids so the
    section view's filter shows the new content immediately. Same
    semantic as ``FormationContactCreateRequest.section_id``.
    """

    layers: list[LithoLayerCreateItem] = Field(
        description="Per-layer payloads. Empty list = no-op (returns [])."
    )
    section_id: UUID | None = Field(
        default=None,
        description=(
            "When set, the created layer ids are unioned into this "
            "section's seeded_formation_contact_ids array — the "
            "explicit-content invariant from the contact side."
        ),
    )
