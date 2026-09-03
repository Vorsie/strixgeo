"""Schemas for POST .../contact-correlations/auto (#133 Phase 2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class AutoCorrelateContactRequest(StrictRequestModel):
    """Request body for the auto-correlate endpoint.

    Attributes
    ----------
    base_depth_threshold_m : float | None
        Depth-match window (metres) at zero column distance — the user's
        Settings "Auto-correlate depth window" knob (#163b).  ``None``
        falls back to the algorithm default (``BASE_DEPTH_THRESHOLD_M``).
        Bounded 0.05–5.0 m to mirror the frontend control.
    section_id : UUID | None
        When supplied, adjacency is gated to consecutive columns ALONG this
        section (left-to-right along-distance order) instead of the model-wide
        map-plane relative-neighbourhood graph.  This makes correlations follow
        the section's column order — the user's mental model — rather than
        true-2D proximity, which crosses columns for off-line investigations
        (dogfeed 2026-05-29).  ``None`` keeps the model-wide RNG behaviour.
    """

    base_depth_threshold_m: float | None = Field(default=None, ge=0.05, le=5.0)
    section_id: UUID | None = Field(default=None)


class DeleteAutoCorrelationsResponse(BaseModel):
    """Response body for the bulk delete-auto-suggestions endpoint (#179).

    Attributes
    ----------
    deleted : int
        Number of unapproved (``source='auto'``, ``user_approved=False``)
        contact-correlation edges removed. Approved manual edges are untouched.
    """

    deleted: int


class CrossingPinchOutResponse(BaseModel):
    """One pinch-out lens candidate inferred from a correlation crossing.

    Auto-lens (drop + lens): when two proposed correlations cross, neither is a
    flat correlation, so both edges are dropped and the pinching layer is
    surfaced here for the frontend to render as a lens ghost.

    Attributes
    ----------
    source_investigation_id : UUID
        The investigation carrying the framing contacts.
    above_contact_id : UUID
        Shallower framing contact (top of the pinching layer) on the source.
    below_contact_id : UUID
        Deeper framing contact (base of the pinching layer) on the source.
    neighbour_investigation_id : UUID
        The investigation the layer pinches out toward.
    """

    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID
    neighbour_investigation_id: UUID


class AutoCorrelateContactResponse(BaseModel):
    """Response body for the auto-correlate endpoint.

    Attributes
    ----------
    edges_created : int
        Net-new edge rows inserted (did not already exist).
    edges_skipped_existing : int
        Candidate pairs that already had a contact-correlation edge
        (ON CONFLICT DO NOTHING semantics; idempotent re-call is safe).
    edges_dropped_crossing : int
        Candidate edges withheld from persistence because they were part of a
        crossing (auto-lens drop + lens). Defaults to 0.
    crossing_pinch_outs : list[CrossingPinchOutResponse]
        Pinch-out lens candidates inferred from those crossings, for the
        frontend to render as lens ghosts. Defaults to empty.
    """

    edges_created: int
    edges_skipped_existing: int
    edges_dropped_crossing: int = 0
    crossing_pinch_outs: list[CrossingPinchOutResponse] = Field(default_factory=list)
