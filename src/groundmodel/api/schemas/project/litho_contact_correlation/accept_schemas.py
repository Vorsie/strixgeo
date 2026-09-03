"""Schemas for POST .../contact-correlations/accept (#133 Phase 2)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class AcceptContactCorrelationsRequest(StrictRequestModel):
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
    ordinals_changed : int
        Diagnostic count of formation instance-ordinal changes triggered
        by the resolver.  Populated when ``ResolveLithoInstances``
        exposes per-change counts; zero until then.
    """

    edges_accepted: int
    ordinals_changed: int


class ConfirmEdgeReviewResponse(BaseModel):
    """Response from the confirm-review endpoints.

    Attributes
    ----------
    edges_confirmed : int
        How many edges had their ``review_reason`` cleared.  ``0`` is a normal
        answer — confirming an edge that carries no flag is a no-op, not an
        error — so the client should not treat it as a failure.
    """

    edges_confirmed: int
