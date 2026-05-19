"""Request / response schemas for litho-correlation endpoints (Phase-2 Slice 1).

Endpoints:
  POST   /projects/{pid}/geology/models/{mid}/correlations
  DELETE /projects/{pid}/geology/models/{mid}/correlations

These are MODEL-level operations.  No section_id, no
seeded_formation_contact_ids — correlations live entirely in the
geological model tree.  This is the structural boundary that prevents
the #57/applyUpdatedSection trap from recurring here.
"""

from __future__ import annotations

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
    source : str
        Provenance token.  Defaults to 'manual' (user-drawn gesture).
        Future automated tokens: 'g3dv3_seed', 'cpt_sbt_auto'.
    """

    formation_a_id: UUID
    formation_b_id: UUID
    source: str = "manual"

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
