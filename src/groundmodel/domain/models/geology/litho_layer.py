"""LithoLayer — one lithology interval at one investigation, with status.

A LithoLayer is the primitive unit of the unified litho boundary model
(spec ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).
It replaces the dual representation ``LithoLayerSuggestion`` (in-memory,
segmenter output) + ``FormationContact`` (DB, one-per-boundary) for the
lithostratigraphic axis.

A layer records:

* The **formation** that occupies the interval (FK to
  ``geological_formation`` — a litho-kind formation with its
  ``litho_main_soil_code`` + ``litho_admixtures`` encoding).
* The **interval** itself: ``depth_top_m`` and ``depth_base_m`` on one
  investigation anchor.
* The **status** (pending / accepted / rejected) — the layer's
  lifecycle. Pending layers are the segmenter's proposals or the
  user's manual placements awaiting confirmation; accepted layers are
  the committed model; rejected layers stay in the table for
  un-reject and audit but render as crossed-out and contribute
  nothing geometrically.
* **Source** + **confidence** for provenance, matching the existing
  geological-axis ``FormationContact`` columns.
* Optional ``parent_geo_contact_id`` for the litho↔geo coupling (debt
  #162) — same shape as on FormationContact.

Boundaries between adjacent same-anchor layers are derived: layer A's
``depth_base_m`` == layer B's ``depth_top_m`` IS the boundary. Moving a
boundary mutates two layer rows atomically (the ``boundary-move``
endpoint introduced in slice A2). There is no separate "boundary" or
"contact" table for litho models after this work lands.

This is the domain-layer dataclass; ORM mapping lives in
``infrastructure/db/models/litho_layer_orm.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

LithoLayerStatus = str
"""One of ``"pending"`` / ``"accepted"`` / ``"rejected"``. Plain str at
the dataclass level; the Pydantic API schema constrains the literal."""

LithoLayerSource = str
"""One of ``"segmenter"`` / ``"manual"`` / ``"observation_layer"`` /
``"observation_interpretation"``. The legacy ``"manual_pick"`` token from
``FormationContact.source`` translates to ``"manual"`` in this model."""

LithoLayerConfidence = str
"""One of ``"low"`` / ``"medium"`` / ``"high"``. Matches FormationContact."""


@dataclass(frozen=True)
class LithoLayer:
    """One lithology interval at one investigation.

    Attributes
    ----------
    id : UUID
        Primary key.
    model_id : UUID
        Lithostratigraphic model this layer belongs to.
    formation_id : UUID
        The litho-kind ``geological_formation`` occupying the
        interval. Carries the lithology + admixture encoding via the
        formation's own columns.
    depth_top_m : float
        Top depth of the interval (m below surface, positive down).
    depth_base_m : float
        Base depth. DB CHECK enforces ``depth_top_m < depth_base_m``.
    status : str
        ``"pending"`` / ``"accepted"`` / ``"rejected"``. See module
        docstring; the unified model uses status as the lifecycle
        primitive (was: dual model with suggestion + contact).
    source : str
        Provenance — see ``LithoLayerSource``.
    borehole_id : UUID | None
        Anchor when the layer belongs to a borehole. XOR with
        ``cpt_id``.
    cpt_id : UUID | None
        Anchor when the layer belongs to a CPT.
    observation_id : UUID | None
        Backlink to the source observation when source =
        ``"observation_layer"`` / ``"observation_interpretation"``.
    observation_layer_id : UUID | None
        Backlink to the specific observation layer that contributed.
    confidence : str
        ``"low"`` / ``"medium"`` / ``"high"``. Drives UI styling +
        downstream weighting in the same way as FormationContact.
    parent_geo_contact_id : UUID | None
        Litho↔geo coupling (debt #162). When set, this layer's top
        boundary is bound to the geological backbone contact pointed
        at — drag of the geo contact propagates here. NULL = not
        coupled.
    notes : str | None
        Free-text engineer note.
    created_at, updated_at : datetime | None
        Audit timestamps; populated by the ORM on insert/update.
    """

    id: UUID
    model_id: UUID
    formation_id: UUID
    depth_top_m: float
    depth_base_m: float
    status: LithoLayerStatus
    source: LithoLayerSource
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    confidence: LithoLayerConfidence = "medium"
    parent_geo_contact_id: UUID | None = None
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
