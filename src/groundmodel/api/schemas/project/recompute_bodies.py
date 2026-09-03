"""Pydantic schemas for ``POST .../bodies/recompute`` (geometric body identity).

Request and response form one cohesive contract (the voxel-build-request
precedent for grouping request/response vocabulary in a single module). The
section payload reuses ``SectionPartitionInputSchema`` verbatim — the recompute
consumes exactly what the frontend renders, minus fallback regions, which the
frontend omits before posting (owner ruling 2026-08-12: fallback paint never
defines identity).
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from groundmodel.api.schemas.project.voxel_build_request import SectionPartitionInputSchema
from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput


class RecomputeBodiesRequest(StrictRequestModel):
    """The frontend's connectivity evidence for one model.

    Attributes
    ----------
    sections : list[SectionPartitionInputSchema]
        Every section's partition as rendered (fallback regions omitted);
        regions carry ``layer_ids``.
    layer_groups : list[list[list[str]]]
        Per section, parallel to ``sections``: the fill's connectivity groups
        of LAYER ids. Layer ids are the ONLY wire currency — body ids are the
        labels the recompute itself rewrites, and body-labelled evidence
        oscillated in production (a merge erased its own grounds on the next
        payload; dogfeed 2026-08-12 evening).
    """

    sections: list[SectionPartitionInputSchema] = Field(default_factory=list)
    # One cross-section id per entry in ``sections``, in the same order. The
    # replace is model-wide, so the server verifies this set EQUALS the
    # project's sections (audit P1-3) — geometry alone cannot prove coverage.
    section_ids: list[UUID] = Field(default_factory=list)
    layer_groups: list[list[list[str]]] = Field(default_factory=list)

    @model_validator(mode="after")
    def _groups_parallel_to_sections(self) -> RecomputeBodiesRequest:
        """``layer_groups`` must be empty or exactly one entry per section."""
        if self.layer_groups and len(self.layer_groups) != len(self.sections):
            raise ValueError(
                f"layer_groups carries {len(self.layer_groups)} entries for "
                f"{len(self.sections)} sections — must be parallel or empty"
            )
        return self

    @model_validator(mode="after")
    def _ids_parallel_to_sections(self) -> RecomputeBodiesRequest:
        """``section_ids`` must name exactly one section per frame."""
        if self.sections and len(self.section_ids) != len(self.sections):
            raise ValueError(
                f"section_ids carries {len(self.section_ids)} id(s) for "
                f"{len(self.sections)} sections — every frame must name its section"
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
    renamed : list[str]
        Names displaced by a merge (oldest name wins).
    """

    facts_written: int
    facts_dropped_stale: int
    bodies_merged: int
    bodies_split: int
    renamed: list[str] = Field(default_factory=list)
