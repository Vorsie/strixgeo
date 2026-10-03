"""Request / response schemas for the body-separation endpoints (debt #278 R5).

The "Separate" verb — owner ruling 2026-08-31 — lets the engineer state "these
two are NOT the same body" and have the resolver honour it permanently. It is the
subtractive counterpart to Dissolve.

Endpoints served (under the shared ``/projects/{pid}/geology`` prefix):

  POST   /models/{mid}/body-separations
  GET    /models/{mid}/body-separations
  DELETE /models/{mid}/body-separations/{sep_id}

A separation anchors two ``litho_layer`` rows; the request supplies them in
either order and the endpoint stores them canonically (``layer_a_id <
layer_b_id``).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class CreateBodySeparationRequest(StrictRequestModel):
    """Body for POST /body-separations.

    Attributes
    ----------
    layer_a_id : UUID
        One anchor layer (a member of the first body). May be supplied in either
        order — the endpoint canonicalises to ``(min, max)`` before insert.
    layer_b_id : UUID
        The other anchor layer (a member of the second body).
    """

    layer_a_id: UUID
    layer_b_id: UUID

    @model_validator(mode="after")
    def _distinct(self) -> CreateBodySeparationRequest:
        """Reject a self-separation at the API boundary (defence in depth)."""
        if self.layer_a_id == self.layer_b_id:
            raise ValueError("layer_a_id and layer_b_id must be different layers")
        return self


class BodySeparationResponse(BaseModel):
    """Response body for POST /body-separations.

    Attributes
    ----------
    separation_id : UUID
        Primary key of the canonical separation row (new or pre-existing).
    model_id : UUID
        The model the separation belongs to.
    layer_a_id : UUID
        Canonical lesser anchor.
    layer_b_id : UUID
        Canonical greater anchor.
    was_created : bool
        ``True`` when a new separation was inserted; ``False`` when it already
        existed (idempotent re-call — the verb is reversible, so a duplicate is a
        200 with the existing row, never a 409).
    bodies_changed : int
        How many bodies were created or removed when the resolver re-ran in this
        same request. The "layer-stamp diff" the toast reports — ``0`` when the
        separation changed nothing (already split, or an idempotent re-call).
    renamed : list[str]
        Unit names displaced by the re-resolve's lineage adoption, so the toast
        can say what happened to the engineer's labels.
    """

    separation_id: UUID
    model_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    was_created: bool
    bodies_changed: int
    renamed: list[str] = []


class BodySeparationAnchorInfo(BaseModel):
    """Server-resolved display info for one anchor of a separation.

    The FE renders "Rejoin with <label>" without owning a resolution map: the
    server reports each anchor's CURRENT body (its ``litho_layer.body_id`` at
    request time), so the label always reflects the live partition.

    Attributes
    ----------
    layer_id : UUID
        The anchor layer id.
    body_id : UUID | None
        The body the anchor layer currently belongs to, or ``None`` when the
        layer has not been stamped into a body yet.
    body_name : str | None
        The current body's user name, or ``None`` when unnamed (the FE falls
        back to a derived ordinal label).
    body_ordinal : int | None
        The current body's ordinal within its mass unit (one sequence per litho unit).
    formation_id : UUID | None
        The current body's formation row — lets the FE compose a soil-coded
        label (e.g. "Za2").
    """

    layer_id: UUID
    body_id: UUID | None = None
    body_name: str | None = None
    body_ordinal: int | None = None
    formation_id: UUID | None = None


class BodySeparationListItem(BaseModel):
    """One separation returned by GET /body-separations, with display info.

    Attributes
    ----------
    id : UUID
        Primary key of the ``body_separation`` row.
    model_id : UUID
        The model the separation belongs to.
    layer_a_id : UUID
        Canonical lesser anchor.
    layer_b_id : UUID
        Canonical greater anchor.
    anchor_a : BodySeparationAnchorInfo
        Current-body display info for ``layer_a_id``.
    anchor_b : BodySeparationAnchorInfo
        Current-body display info for ``layer_b_id``.
    created_at : datetime
        Row creation timestamp.
    """

    id: UUID
    model_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    anchor_a: BodySeparationAnchorInfo
    anchor_b: BodySeparationAnchorInfo
    created_at: datetime


class BodySeparationRejoinResponse(BaseModel):
    """Response body for DELETE /body-separations/{sep_id} (Rejoin).

    Attributes
    ----------
    bodies_changed : int
        How many bodies were created or removed when the resolver re-ran after
        the separation was lifted — ``0`` when the two anchors were not going to
        re-union anyway.
    renamed : list[str]
        Unit names displaced by the re-resolve's lineage adoption.
    """

    bodies_changed: int
    renamed: list[str] = []
