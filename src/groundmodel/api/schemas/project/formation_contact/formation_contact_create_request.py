"""Pydantic schema: :class:`FormationContactCreateRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

from .contact_enums import ContactConfidence, ContactSource


class FormationContactCreateRequest(StrictRequestModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/contacts``.

    Exactly one of ``borehole_id`` / ``cpt_id`` must be set. Per the
    v1 scope, the API only accepts borehole-anchored contacts —
    CPT-anchored contacts are reserved for Phase 5 (Robertson Ic) but
    the column exists so the editor can render the constraint shape
    consistently across both anchor types.
    """

    formation_id: UUID
    depth_top_m: float
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    source: ContactSource = "manual_pick"
    confidence: ContactConfidence = "medium"
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    notes: str | None = None
    # Explicit-content invariant (owner directive 2026-05-17).
    # When the user manually draws a contact on a section, the section editor
    # passes its section_id here so the router appends the new contact's id to
    # the section's seeded_formation_contact_ids in the same request.
    # When absent (None), the contact is created without touching any section.
    section_id: UUID | None = None

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> FormationContactCreateRequest:
        """XOR check on the borehole / CPT anchor at the API boundary.

        Mirrors the DB ``CheckConstraint`` so the client gets a clean
        422 with a clear message instead of an opaque INSERT error.
        """
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError(
                "Exactly one of borehole_id / cpt_id must be set on a FormationContact"
            )
        return self
