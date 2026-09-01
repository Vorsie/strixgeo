"""Request / response schemas for the body-union endpoints (debt #278).

The "Join with…" verb — owner ruling 2026-08-31 — lets the engineer state "this
body IS the same as that body" and have the resolver honour it. It is the
additive counterpart to Separate.

Endpoints served (under the shared ``/projects/{pid}/geology`` prefix):

  POST   /models/{mid}/body-unions
  GET    /models/{mid}/body-unions
  DELETE /models/{mid}/body-unions/{union_id}

A union anchors two ``litho_layer`` rows; the request supplies them in either
order and the endpoint stores them canonically (``layer_a_id < layer_b_id``).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator


class CreateBodyUnionRequest(BaseModel):
    """Body for POST /body-unions.

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
    def _distinct(self) -> CreateBodyUnionRequest:
        """Reject a self-union at the API boundary (defence in depth)."""
        if self.layer_a_id == self.layer_b_id:
            raise ValueError("layer_a_id and layer_b_id must be different layers")
        return self


class BodyUnionResponse(BaseModel):
    """Response body for POST /body-unions.

    Attributes
    ----------
    union_id : UUID
        Primary key of the canonical union row (new or pre-existing).
    model_id : UUID
        The model the union belongs to.
    layer_a_id : UUID
        Canonical lesser anchor.
    layer_b_id : UUID
        Canonical greater anchor.
    was_created : bool
        ``True`` when a new union was inserted; ``False`` when it already existed
        (idempotent re-call — the verb is reversible, so a duplicate is a 200 with
        the existing row, never a 409).
    bodies_changed : int
        How many bodies were created or removed when the resolver re-ran in this
        same request. The "layer-stamp diff" the toast reports — ``0`` when the
        union changed nothing (already merged, or an idempotent re-call).
    renamed : list[str]
        Unit names displaced by the re-resolve's lineage adoption, so the toast
        can say what happened to the engineer's labels.
    suppressed : bool
        ``True`` when the in-request resolve SUPPRESSED this join — a standing
        separation overruled it (cannot-link wins), so the two bodies stayed apart
        despite the row being written. Lets the toast say "join blocked by a
        separation" instead of a misleading ``was_created: true, bodies_changed:
        0``. The write-time guards normally refuse such a join 422; this is the
        resolver's ground-truth backstop.
    inert : bool
        ``True`` when the in-request resolve found this join INERT — the two
        anchors re-derived to different masses (class mismatch), so it can never
        make one body. Also normally refused 422 at write time.
    """

    union_id: UUID
    model_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    was_created: bool
    bodies_changed: int
    renamed: list[str] = []
    suppressed: bool = False
    inert: bool = False


class BodyUnionAnchorInfo(BaseModel):
    """Server-resolved display info for one anchor of a union.

    The FE renders "Disjoin from <label>" without owning a resolution map: the
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
        The current body's ordinal within its naming group.
    formation_id : UUID | None
        The current body's formation row — lets the FE compose a soil-coded
        label (e.g. "Za2").
    """

    layer_id: UUID
    body_id: UUID | None = None
    body_name: str | None = None
    body_ordinal: int | None = None
    formation_id: UUID | None = None


class BodyUnionListItem(BaseModel):
    """One union returned by GET /body-unions, with display info.

    Attributes
    ----------
    id : UUID
        Primary key of the ``body_union`` row.
    model_id : UUID
        The model the union belongs to.
    layer_a_id : UUID
        Canonical lesser anchor.
    layer_b_id : UUID
        Canonical greater anchor.
    anchor_a : BodyUnionAnchorInfo
        Current-body display info for ``layer_a_id``.
    anchor_b : BodyUnionAnchorInfo
        Current-body display info for ``layer_b_id``.
    created_at : datetime
        Row creation timestamp.
    """

    id: UUID
    model_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    anchor_a: BodyUnionAnchorInfo
    anchor_b: BodyUnionAnchorInfo
    created_at: datetime


class BodyUnionDisjoinResponse(BaseModel):
    """Response body for DELETE /body-unions/{union_id} (Disjoin).

    Attributes
    ----------
    bodies_changed : int
        How many bodies were created or removed when the resolver re-ran after
        the union was lifted — ``0`` when the two anchors were held together by
        something else anyway.
    renamed : list[str]
        Unit names displaced by the re-resolve's lineage adoption.
    suppressed_unions : int
        How many OTHER unions on the model the post-Disjoin resolve still finds
        suppressed by a standing separation (cannot-link wins). Model-level count,
        so the UI can flag joins that remain blocked.
    inert_unions : int
        How many OTHER unions on the model the post-Disjoin resolve finds inert
        (class mismatch — never a mixed body).
    """

    bodies_changed: int
    renamed: list[str] = []
    suppressed_unions: int = 0
    inert_unions: int = 0
