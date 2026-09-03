"""Pydantic schema: :class:`LithoLayerUpdateRequest` (Slice A2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import model_validator

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerConfidenceLiteral,
    LithoLayerSourceLiteral,
    LithoLayerStatusLiteral,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class LithoLayerUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{pid}/geology/models/{mid}/layers/{lid}``.

    Only fields present in the body are written. The anchor pair
    (``borehole_id`` / ``cpt_id``) IS updatable so a drag-re-anchor
    flow works without delete+recreate, with the same XOR rule as
    the contact PATCH: both anchor fields must be present together
    when either is touched.
    """

    formation_id: UUID | None = None
    depth_top_m: float | None = None
    depth_base_m: float | None = None
    status: LithoLayerStatusLiteral | None = None
    source: LithoLayerSourceLiteral | None = None
    confidence: LithoLayerConfidenceLiteral | None = None
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    parent_geo_contact_id: UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _xor_when_anchor_touched(self) -> LithoLayerUpdateRequest:
        """XOR enforcement on the anchor pair when the patch touches either.

        Mirrors ``FormationContactUpdateRequest._xor_when_anchor_touched``:
        either neither field, or both fields with exactly one non-null.
        """
        sent = {"borehole_id", "cpt_id"} & self.model_fields_set
        if not sent:
            return self
        if sent != {"borehole_id", "cpt_id"}:
            raise ValueError(
                "Anchor update on a litho layer requires both borehole_id and cpt_id "
                "in the request body (set the unused one to null)"
            )
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError(
                "Anchor update on a litho layer: exactly one of "
                "borehole_id / cpt_id must be non-null"
            )
        return self

    @model_validator(mode="after")
    def _depth_ordering(self) -> LithoLayerUpdateRequest:
        """Reject patches that would invert the depth interval.

        If both depths are in the body, top must be strictly less than base.
        If only one is sent, the row's existing other end is trusted
        (caller is responsible for not pushing top past the stored base).
        """
        if self.depth_top_m is not None and self.depth_base_m is not None:
            if self.depth_top_m >= self.depth_base_m:
                raise ValueError(
                    "Layer depth ordering: depth_top_m must be strictly less than depth_base_m"
                )
        return self
