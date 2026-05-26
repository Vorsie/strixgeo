"""Schemas for POST .../contact-correlations/auto (#133 Phase 2)."""

from __future__ import annotations

from pydantic import BaseModel


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
