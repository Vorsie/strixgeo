"""Pydantic schema: :class:`FormationContactResponse`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FormationContactResponse(BaseModel):
    """API representation of a FormationContact row.

    On the PATCH (update) endpoint the response also carries
    ``deleted_contact_ids`` — the peer contacts a cross-merge deleted on the
    way to this survivor (empty on a plain update).  The renderer prunes those
    ids from the section at once so a crossed boundary never lingers as a row
    the user can only "delete" into a 404 (installer #20 dogfeed 2026-09-06).
    The field is additive and defaults to empty everywhere else the schema is
    reused (list / create responses).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    borehole_id: UUID | None
    cpt_id: UUID | None
    # Set only on synthetic pinch-out contacts (no borehole/CPT anchor);
    # null for normal contacts. The absolute tip elevation lives in
    # synthetic_elevation_m (depth_top_m is a 0.0 sentinel there).
    synthetic_x: float | None = None
    synthetic_y: float | None = None
    synthetic_elevation_m: float | None = None
    depth_top_m: float
    source: str
    confidence: str
    observation_id: UUID | None
    observation_layer_id: UUID | None
    # Litho↔geo coupling (#162): set on a lithostratigraphic contact,
    # pointing at the geological contact it is the same physical surface as.
    # NULL = not coupled (default for all existing contacts).
    parent_geo_contact_id: UUID | None = None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    # Peer contacts a cross-merge deleted to produce this survivor (drag-up:
    # crossed peers; plain update: empty).  Additive, populated only by the
    # update endpoint; from_attributes falls back to this default for the
    # list / create responses whose ORM rows carry no such attribute.
    deleted_contact_ids: list[UUID] = Field(default_factory=list)
