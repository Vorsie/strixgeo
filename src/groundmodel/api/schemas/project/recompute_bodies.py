"""Pydantic schemas for ``POST .../bodies/recompute`` (geometric body identity).

Request and response form one cohesive contract (the voxel-build-request
precedent for grouping request/response vocabulary in a single module). The
section payload reuses ``SectionPartitionInputSchema`` verbatim — the recompute
consumes exactly what the frontend renders, minus fallback regions, which the
frontend omits before posting (owner ruling 2026-08-12: fallback paint never
defines identity).
"""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from groundmodel.api.schemas.project.voxel_build_request import SectionPartitionInputSchema
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput


class RecomputeBodiesRequest(BaseModel):
    """The frontend's connectivity evidence for one model.

    Attributes
    ----------
    sections : list[SectionPartitionInputSchema]
        Every section's partition as rendered (fallback regions omitted).
    body_groups : list[list[list[str]]]
        Per section, parallel to ``sections``: the per-section merge groups of
        ORIGINAL body ids (frontend ``mergeTouchingBodies`` union-find output).
        Carried separately because payload regions arrive already relabeled to
        per-section representatives.
    body_members : dict[str, list[str]]
        Body id → member layer ids, from the SAME frontend snapshot that
        produced the regions — the layer ids are the wire currency, so a
        previous recompute's restamp can never orphan this payload.
    """

    sections: list[SectionPartitionInputSchema] = Field(default_factory=list)
    body_groups: list[list[list[str]]] = Field(default_factory=list)
    body_members: dict[str, list[str]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _groups_parallel_to_sections(self) -> RecomputeBodiesRequest:
        """``body_groups`` must be empty or exactly one entry per section."""
        if self.body_groups and len(self.body_groups) != len(self.sections):
            raise ValueError(
                f"body_groups carries {len(self.body_groups)} entries for "
                f"{len(self.sections)} sections — must be parallel or empty"
            )
        return self

    def to_domain_sections(self) -> list[SectionPartitionInput]:
        """Convert the section payload into frozen domain value objects."""
        return [s.to_domain() for s in self.sections]


class RecomputeBodiesResponse(BaseModel):
    """The diff one recompute produced, for the frontend's toast.

    Attributes
    ----------
    facts_written : int
        Fact rows persisted after the stale filter.
    facts_dropped_stale : int
        Planned facts dropped because a layer left the model since the
        payload snapshot.
    bodies_merged : int
        Previously-distinct bodies fused into survivors (layer-stamp diff).
    bodies_split : int
        The mirror count.
    unresolved_body_ids : list[str]
        Body ids named by the evidence with no member layers in the snapshot.
    renamed : list[str]
        Names displaced by a merge (oldest name wins).
    """

    facts_written: int
    facts_dropped_stale: int
    bodies_merged: int
    bodies_split: int
    unresolved_body_ids: list[str] = Field(default_factory=list)
    renamed: list[str] = Field(default_factory=list)
