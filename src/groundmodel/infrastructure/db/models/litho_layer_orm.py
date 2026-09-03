"""ORM model for LithoLayer — one lithology interval at one investigation."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class LithoLayerOrm(Base):
    """Persisted LithoLayer.

    A single lithology interval on one investigation anchor — the
    primitive unit of the unified litho boundary model
    (spec ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).

    Replaces the dual representation (``LithoLayerSuggestion`` in
    memory + ``FormationContact`` per-boundary in DB) for litho models.
    Boundaries between adjacent same-anchor layers are derived from
    each row's depth_top_m / depth_base_m — no separate boundary
    table for litho models after this work lands.

    Anchor XOR: exactly one of ``borehole_id`` or ``cpt_id`` is set.
    The CHECK constraint enforces it.

    Status drives the layer's lifecycle:
    * ``pending`` — segmenter proposal or manual placement awaiting
      confirmation. Renders as hatched + accept/reject affordances.
    * ``accepted`` — committed to the model. Renders as the
      formation's colour, contributes to surface compute.
    * ``rejected`` — explicitly dismissed. Stays in the table (so
      un-reject + audit work) but renders as crossed out and is
      ignored by the bound walker.

    The status CHECK constraint enforces the literal set at the DB
    level so a typo in a write path can't slip past.
    """

    __tablename__ = "litho_layer"
    __table_args__ = (
        # Two-anchor XOR — exactly one of borehole / cpt must be set.
        # Synthetic anchors (like FormationContact's pinch-out tip)
        # are NOT supported here: a litho layer is always tied to a
        # physical investigation column. Pinch-out wedges live in the
        # geological model.
        CheckConstraint(
            "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END)"
            " = 1",
            name="litho_layer_anchor_xor",
        ),
        # Depth ordering — top must be shallower than base.
        CheckConstraint(
            "depth_top_m < depth_base_m",
            name="litho_layer_depth_ordered",
        ),
        # Status whitelist — DB-level guard against typos in write paths.
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="litho_layer_status_valid",
        ),
        # Source whitelist — same DB-level guard.
        CheckConstraint(
            "source IN ('segmenter', 'manual', 'observation_layer', 'observation_interpretation')",
            name="litho_layer_source_valid",
        ),
        # Confidence whitelist.
        CheckConstraint(
            "confidence IN ('low', 'medium', 'high')",
            name="litho_layer_confidence_valid",
        ),
        # Per-anchor depth lookup — the dominant query is "give me
        # this anchor's layers in this model, sorted by depth_top_m".
        Index(
            "idx_litho_layer_model_borehole_depth",
            "model_id",
            "borehole_id",
            "depth_top_m",
        ),
        Index(
            "idx_litho_layer_model_cpt_depth",
            "model_id",
            "cpt_id",
            "depth_top_m",
        ),
        # Status filter — the renderer pulls pending / accepted /
        # rejected sets separately on the litho axis.
        Index("idx_litho_layer_model_status", "model_id", "status"),
        # Formation filter — the inspector lists layers per formation
        # and the absence-recompute pipeline groups by formation.
        Index("idx_litho_layer_formation", "formation_id"),
        # Litho↔geo coupling lookup (debt #162 parity).
        Index("idx_litho_layer_parent_geo", "parent_geo_contact_id"),
        # Body (instance) backlink — the resolver stamps this; the renderer
        # groups layers by body to frame each instance from its member layers.
        Index("idx_litho_layer_body", "body_id"),
        # Covering litho band backlink — a geotech-model band points at the
        # accepted litho band it subdivides. The Parameters tree derives the
        # band's litho BODY live through this (never stored — litho recomputes
        # re-mint body ids). Indexed for the tree's per-parent grouping.
        Index("idx_litho_layer_parent_litho_layer", "parent_litho_layer_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # CASCADE on both parents — same rationale as FormationContact.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # XOR anchor pair.
    borehole_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=True,
    )
    cpt_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cpt.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Interval. Both ends required; CHECK enforces top < base.
    depth_top_m: Mapped[float] = mapped_column(Double, nullable=False)
    depth_base_m: Mapped[float] = mapped_column(Double, nullable=False)

    # Lifecycle status. CHECK enforces the literal set.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Provenance — see CHECK above.
    source: Mapped[str] = mapped_column(String(30), nullable=False)

    # Optional source observation backlinks. SET NULL on parent delete
    # so the layer survives reshuffles, same as FormationContact.
    observation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("observation.id", ondelete="SET NULL"),
        nullable=True,
    )
    observation_layer_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("observation_layer.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Litho↔geo coupling (#162). NULL = not coupled.
    parent_geo_contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The body (instance) this layer belongs to. NULL until the instance
    # resolver runs. SET NULL on body delete so the layer survives a body
    # reconciliation that drops its instance. See spec
    # docs/superpowers/specs/2026-06-03-per-instance-body-identity-design.md.
    body_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The accepted litho band this geotech band subdivides (self-referencing).
    # NULL on litho-model rows (they ARE litho bands) and on a geotech band with
    # no covering accepted litho band (a true orphan — the honest state the
    # Parameters tree reports). Band-level, not body-level: this band FK is
    # STABLE across litho recomputes (which re-mint litho BODY ids). The
    # body-level litho parent DOES now exist as a stored FK —
    # ``body.parent_litho_body_id`` (debt #278, R1, owner 2026-08-31) — derived
    # FROM this band FK and kept current by the resolver (it re-stamps sibling
    # geotech bodies on every litho recompute), reversing the earlier
    # "a body FK would dangle" decision. SET NULL on delete so the geotech band
    # survives a litho reshuffle that drops its parent.
    parent_litho_layer_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("litho_layer.id", ondelete="SET NULL"),
        nullable=True,
    )

    confidence: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    model: Mapped[GeologicalModelOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GeologicalModelOrm", back_populates="litho_layers", lazy=RELATIONSHIP_LAZY
    )
    formation: Mapped[GeologicalFormationOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GeologicalFormationOrm", back_populates="litho_layers", lazy=RELATIONSHIP_LAZY
    )
