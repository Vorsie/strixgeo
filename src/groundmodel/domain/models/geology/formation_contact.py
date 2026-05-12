"""FormationContact — one formation-top pick at one investigation.

A contact is "the top of formation X starts at depth Y at this
borehole / CPT". The geological model is the *set* of contacts;
interpolated formation surfaces between contacts are a
render-time computation, not persisted geometry (Phase 4 keeps it
that way; Phase 5 may store manually-adjusted intermediate
points).

The anchor is polymorphic at the row level: each contact carries
EITHER a ``borehole_id`` OR a ``cpt_id`` (XOR enforced at the
DB + API layers; the domain dataclass holds both as optional and
trusts the layer above to honour the rule).

This is the domain-layer dataclass; ORM mapping lives in
``infrastructure/db/models/formation_contact_orm.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class FormationContact:
    """One formation-top pick at one investigation.

    Attributes
    ----------
    id : UUID
        Primary key.
    model_id : UUID
        Geological model this contact belongs to.
    formation_id : UUID
        Which formation's top this pick marks.
    borehole_id : UUID | None
        Anchor investigation when it's a borehole. Mutually
        exclusive with ``cpt_id``.
    cpt_id : UUID | None
        Anchor investigation when it's a CPT. Mutually exclusive
        with ``borehole_id``.
    depth_top_m : float
        Depth (m below surface) of the formation top at this
        column. Always non-negative; surface contact = 0.0.
    source : str
        How the pick was determined: ``"manual_pick"`` (engineer
        drew it on the section), ``"observation_layer"`` (derived
        from a DOV observation layer boundary),
        ``"interpretation_layer"`` (from a DOV interpretation
        stream), or other future sources.
    observation_id : UUID | None
        Backlink to the observation row when source =
        ``observation_layer``.
    observation_layer_id : UUID | None
        Backlink to the specific layer boundary.
    confidence : str
        Engineer's certainty: ``"low"`` / ``"medium"`` / ``"high"``.
        Drives UI styling (low = dashed, high = solid).
    notes : str | None
        Free-text engineer note specific to this pick.
    created_at, updated_at : datetime
        Audit timestamps.
    """

    id: UUID
    model_id: UUID
    formation_id: UUID
    depth_top_m: float
    source: str
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    confidence: str = "medium"
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
