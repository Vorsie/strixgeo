"""Schemas for POST .../contact-correlations/auto (#133 Phase 2)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AutoCorrelateContactRequest(BaseModel):
    """Request body for the auto-correlate endpoint.

    Attributes
    ----------
    base_depth_threshold_m : float | None
        Depth-match window (metres) at zero column distance — the user's
        Settings "Auto-correlate depth window" knob (#163b).  ``None``
        falls back to the algorithm default (``BASE_DEPTH_THRESHOLD_M``).
        Bounded 0.05–5.0 m to mirror the frontend control.
    """

    base_depth_threshold_m: float | None = Field(default=None, ge=0.05, le=5.0)


class AutoCorrelateContactResponse(BaseModel):
    """Response body for the auto-correlate endpoint.

    Attributes
    ----------
    edges_created : int
        Net-new edge rows inserted (did not already exist).
    edges_skipped_existing : int
        Candidate pairs that already had a contact-correlation edge
        (ON CONFLICT DO NOTHING semantics; idempotent re-call is safe).
    """

    edges_created: int
    edges_skipped_existing: int
