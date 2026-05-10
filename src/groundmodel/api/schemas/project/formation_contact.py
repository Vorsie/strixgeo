"""Pydantic schemas for the FormationContact API surface."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Closed enum for the source column. Pydantic enforces these literally;
# the DB column stays plain VARCHAR so adding a new source is a
# Pydantic-only change.
ContactSource = Literal["borehole_observation", "manual_pick", "interpolated"]
ContactConfidence = Literal["high", "medium", "low"]


class FormationContactCreateRequest(BaseModel):
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


class FormationContactUpdateRequest(BaseModel):
    """Body of ``PATCH /projects/{pid}/geology/models/{mid}/contacts/{cid}``.

    Only fields present in the body are written. The anchor (borehole_id
    / cpt_id) is intentionally NOT updatable — repointing a contact at
    a different investigation is rare and easy to do wrong; delete +
    create is the safer flow.
    """

    formation_id: UUID | None = None
    depth_top_m: float | None = None
    source: ContactSource | None = None
    confidence: ContactConfidence | None = None
    notes: str | None = None


class FormationContactResponse(BaseModel):
    """API representation of a FormationContact row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    borehole_id: UUID | None
    cpt_id: UUID | None
    depth_top_m: float
    source: str
    confidence: str
    observation_id: UUID | None
    observation_layer_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class GapIssueResponse(BaseModel):
    """One item in the validate-no-gaps response."""

    kind: str
    detail: str
    depth_m: float | None = None
    contact_ids: list[UUID] = Field(default_factory=list)


class GapValidationResponse(BaseModel):
    """Body returned by ``GET /projects/{pid}/geology/models/{mid}/boreholes/{bid}/validate``.

    Empty ``issues`` ⇒ contacts form a clean contiguous stratigraphy.
    Any non-empty list is a soft warning — the editor decides whether
    to block save.
    """

    model_id: UUID
    borehole_id: UUID
    issues: list[GapIssueResponse] = Field(default_factory=list)
