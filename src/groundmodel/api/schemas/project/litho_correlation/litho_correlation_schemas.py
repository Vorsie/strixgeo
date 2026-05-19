"""Request / response schemas for litho-correlation endpoints (Phase-2 Slices 1+3).

Endpoints (Slice 1):
  POST   /projects/{pid}/geology/models/{mid}/correlations
  DELETE /projects/{pid}/geology/models/{mid}/correlations

Endpoints (Slice 3):
  POST   /projects/{pid}/geology/models/{mid}/correlations/resolve
  GET    /projects/{pid}/geology/models/{mid}/correlations

All of these are MODEL-level operations.  No section_id, no
seeded_formation_contact_ids — correlations live entirely in the
geological model tree.  This is the structural boundary that prevents
the #57/applyUpdatedSection trap from recurring here.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, model_validator


class LithoCorrelationRequest(BaseModel):
    """Body for POST and DELETE /correlations.

    Attributes
    ----------
    formation_a_id : UUID
        One endpoint of the undirected edge.  May be supplied in either
        order — the use case normalises to canonical (min, max) before
        insert / delete.
    formation_b_id : UUID
        The other endpoint.
    source : Literal["manual"]
        Provenance token. Phase-2 only emits 'manual' (user-drawn
        gesture); constrained to that literal so a typo / premature
        automated token cannot silently persist (review C3). Widen the
        Literal when an automated path (e.g. 'g3dv3_seed') actually
        ships.
    """

    formation_a_id: UUID
    formation_b_id: UUID
    source: Literal["manual"] = "manual"

    @model_validator(mode="after")
    def _no_self_loop(self) -> LithoCorrelationRequest:
        """Reject self-loops at the API boundary (defence in depth)."""
        if self.formation_a_id == self.formation_b_id:
            raise ValueError("formation_a_id and formation_b_id must be different formations")
        return self


class OrdinalUpdateItem(BaseModel):
    """One formation whose instance_ordinal changed after resolution.

    Attributes
    ----------
    formation_id : UUID
        The formation whose ordinal was updated.
    new_ordinal : int
        The ordinal assigned by the resolver.
    """

    formation_id: UUID
    new_ordinal: int


class LithoCorrelationResponse(BaseModel):
    """Response body for POST /correlations.

    Attributes
    ----------
    edge_id : UUID
        The id of the canonical edge row (new or pre-existing).
    formation_a_id : UUID
        Canonical lesser endpoint (min(a, b) after ordering).
    formation_b_id : UUID
        Canonical greater endpoint.
    was_created : bool
        ``True`` when a new edge was inserted; ``False`` when the edge
        already existed (idempotent re-call returns 200, not 201).
    instance_ordinals_updated : list[OrdinalUpdateItem]
        One entry per formation whose ``instance_ordinal`` was changed
        by the resolver in this call.
    """

    edge_id: UUID
    formation_a_id: UUID
    formation_b_id: UUID
    was_created: bool
    instance_ordinals_updated: list[OrdinalUpdateItem]


# ---------------------------------------------------------------------------
# Slice 3 — resolve endpoint + edge list endpoint
# ---------------------------------------------------------------------------


class ResolveInstancesResponse(BaseModel):
    """Response body for POST /correlations/resolve.

    Attributes
    ----------
    updated : list[OrdinalUpdateItem]
        One entry per formation whose ``instance_ordinal`` changed
        as a result of this resolve call.  Empty list when nothing
        changed (idempotent re-resolve with no structural changes).
    """

    updated: list[OrdinalUpdateItem]


class LithoCorrelationEdgeListItem(BaseModel):
    """One edge returned by GET /correlations.

    Attributes
    ----------
    id : UUID
        Primary key of the ``litho_correlation_edge`` row.
    formation_a_id : UUID
        Canonical lesser endpoint (min ordering enforced by DB).
    formation_b_id : UUID
        Canonical greater endpoint.
    source : str
        Provenance token ('manual' in Phase 2; widened later when
        automated paths ship).
    created_at : datetime
        Row creation timestamp — exposed so the frontend can sort edges
        chronologically for display and track the edge-set snapshot hash
        (stale-badge computation).
    """

    model_config = {"from_attributes": True}

    id: UUID
    formation_a_id: UUID
    formation_b_id: UUID
    source: str
    created_at: datetime
