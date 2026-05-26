"""Schemas for POST .../contact-correlations/accept (#133 Phase 2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AcceptContactCorrelationsRequest(BaseModel):
    """Body for the accept endpoint.

    Attributes
    ----------
    section_id : UUID | None
        When supplied, only edges whose both endpoints are seeded on
        this section are approved.  When ``None`` (default), every
        unapproved edge in the model is accepted.
    """

    section_id: UUID | None = None


class AcceptContactCorrelationsResponse(BaseModel):
    """Response body for the accept endpoint.

    Attributes
    ----------
    edges_accepted : int
        Number of edge rows flipped from ``user_approved=False`` to
        ``True`` in this call.
    lenses_created : int
        Net-new ``LithoLensOrm`` rows inserted by the downstream lens
        detector.
    lenses_removed : int
        ``LithoLensOrm`` rows deleted because their topological body is
        no longer bounded by two approved edges.
    ordinals_changed : int
        Diagnostic count of formation instance-ordinal changes triggered
        by the resolver.  Populated when ``ResolveLithoInstances``
        exposes per-change counts; zero until then.
    """

    edges_accepted: int
    lenses_created: int
    lenses_removed: int
    ordinals_changed: int
