"""ORM model for FormationContact — formation top observed at an investigation."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Double, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class FormationContactOrm(Base):
    """Persisted FormationContact — "this formation tops out at depth X at this investigation".

    The primary data point of the geological model. Anchored to either
    a borehole or a CPT (XOR enforced at the DB layer via CHECK).
    The CPT column is reserved for Phase 5 — Robertson Ic classification
    can synthesise stratigraphy from CPT signals — and v1 only writes
    via the borehole anchor.

    The "no gaps" rule (a borehole's contacts must form a contiguous
    depth coverage from surface down to test depth) is NOT a hard DB
    constraint. It runs as a domain validation on save: hard
    constraints would fight legitimate edits where, mid-flow, a new
    contact temporarily overlaps with an existing one.

    Provenance columns (``observation_id`` / ``observation_layer_id``)
    are nullable + SET-NULL-on-delete. A contact survives a reshuffle
    of its source observation while losing the back-link; the depth
    value stands on its own.
    """

    __tablename__ = "formation_contact"
    __table_args__ = (
        # Exactly one anchor: borehole_id XOR cpt_id. Phrased as
        # ``num_nonnull = 1`` so a future third anchor (e.g. a virtual
        # section anchor for purely modelled points) is one extra term.
        CheckConstraint(
            "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END) "
            "+ (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="formation_contact_anchor_xor",
        ),
        Index("idx_formation_contact_model_borehole", "model_id", "borehole_id"),
        Index("idx_formation_contact_model_formation", "model_id", "formation_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # CASCADE on both parents — a deleted model / formation evaporates
    # its contacts. The data has no meaning without the parent.
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

    # XOR anchor pair. CASCADE delete so a vanished investigation
    # doesn't leave dangling contacts.
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

    # Depth of the formation top at this investigation, positive
    # downwards from surface (consistent with every other depth column
    # in the schema — see CLAUDE.md "Domain Model").
    depth_top_m: Mapped[float] = mapped_column(Double, nullable=False)

    # Provenance: 'borehole_observation' / 'manual_pick' / 'interpolated'.
    # Plain VARCHAR — enum migrations are pain and the value set is
    # small. Validation lives at the Pydantic layer.
    source: Mapped[str] = mapped_column(String(30), nullable=False)

    # Optional links to the observation that drove this contact. SET
    # NULL on parent delete so the contact survives a reshuffle while
    # losing its back-link.
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

    # 'high' / 'medium' / 'low'. Same VARCHAR rationale as source.
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
        "GeologicalModelOrm", back_populates="contacts"
    )
    formation: Mapped[GeologicalFormationOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GeologicalFormationOrm", back_populates="contacts"
    )
