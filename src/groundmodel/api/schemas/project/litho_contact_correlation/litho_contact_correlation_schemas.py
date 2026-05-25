"""Request / response schemas for litho contact-correlation endpoints (#133 Phase 1).

Endpoints served:
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations
  DELETE /projects/{pid}/geology/models/{mid}/contact-correlations
  GET    /projects/{pid}/geology/models/{mid}/contact-correlations

All are MODEL-level — no section_id, no seeded_formation_contact_ids.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, model_validator


class ContactCorrelationRequest(BaseModel):
    """Body for POST and DELETE /contact-correlations.

    Attributes
    ----------
    contact_a_id : UUID
        One formation-contact endpoint.  May be supplied in either order —
        the use case normalises to canonical ``(min, max)`` before insert /
        delete.
    contact_b_id : UUID
        The other endpoint.
    source : Literal["manual"]
        Provenance token.  Only 'manual' is accepted in Phase 1; 'auto'
        is reserved for Phase 2 auto-correlate.
    """

    contact_a_id: UUID
    contact_b_id: UUID
    source: Literal["manual"] = "manual"

    @model_validator(mode="after")
    def _no_self_loop(self) -> ContactCorrelationRequest:
        """Reject self-loops at the API boundary (defence in depth)."""
        if self.contact_a_id == self.contact_b_id:
            raise ValueError("contact_a_id and contact_b_id must be different contacts")
        return self


class ContactCorrelationResponse(BaseModel):
    """Response body for POST /contact-correlations.

    Attributes
    ----------
    edge_id : UUID
        Primary key of the canonical edge row (new or pre-existing).
    contact_a_id : UUID
        Canonical lesser endpoint (min-ordered).
    contact_b_id : UUID
        Canonical greater endpoint.
    model_id : UUID
        The lithostratigraphic model this edge belongs to.
    source : str
        Provenance token ('manual' in Phase 1).
    was_created : bool
        ``True`` when a new edge was inserted; ``False`` when the edge
        already existed (idempotent re-call returns 200 not 201).
    """

    edge_id: UUID
    contact_a_id: UUID
    contact_b_id: UUID
    model_id: UUID
    source: str
    was_created: bool


class ContactCorrelationEdgeListItem(BaseModel):
    """One edge returned by GET /contact-correlations.

    Attributes
    ----------
    id : UUID
        Primary key of the ``litho_contact_correlation_edge`` row.
    contact_a_id : UUID
        Canonical lesser endpoint.
    contact_b_id : UUID
        Canonical greater endpoint.
    model_id : UUID
        The lithostratigraphic model.
    source : str
        Provenance token.
    created_at : datetime
        Row creation timestamp.
    """

    model_config = {"from_attributes": True}

    id: UUID
    contact_a_id: UUID
    contact_b_id: UUID
    model_id: UUID
    source: str
    created_at: datetime
