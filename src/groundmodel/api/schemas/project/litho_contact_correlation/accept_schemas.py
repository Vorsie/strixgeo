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
    bodies_created : int
        Net-new body rows inserted by the downstream detector.
        Always ``0`` from the accept flow — body materialisation runs
        only on the explicit ``POST .../bodies/detect`` verb.
        Renamed from ``lenses_created`` in Slice 3.3 (2026-06-01).
    bodies_removed : int
        Body rows deleted because their topology is no longer bounded.
        Always ``0`` from the accept flow — see ``bodies_created``.
        Renamed from ``lenses_removed`` in Slice 3.3 (2026-06-01).
    ordinals_changed : int
        Diagnostic count of formation instance-ordinal changes triggered
        by the resolver.  Populated when ``ResolveLithoInstances``
        exposes per-change counts; zero until then.
    """

    edges_accepted: int
    bodies_created: int
    bodies_removed: int
    ordinals_changed: int
