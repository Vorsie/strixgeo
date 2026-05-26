"""ORM model for LithoContactCorrelationEdge — boundary-to-boundary correlation (#133)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoContactCorrelationEdgeOrm(Base):
    """Persisted LithoContactCorrelationEdge — contact-level correlation edge (#133).

    Records that two ``formation_contact`` rows (both belonging to the same
    lithostratigraphic model) represent the **same stratigraphic boundary** at
    different investigation columns.  Two such edges — one at the top and one
    at the base — bound a body.  A layer between two paired boundary-edges
    whose lithology differs from the flanking bodies is a LENS (Phase 2 of
    #133 implements lens detection).

    This is the Phase 1 implementation of the boundary-to-boundary correlation
    model (owner directive 2026-05-25).  It coexists with the original
    formation-level ``litho_correlation_edge`` table; migration is Phase 3.

    Canonical ordering
    ------------------
    ``contact_a_id < contact_b_id`` is enforced by a DB CHECK constraint AND
    by every use-case caller before INSERT, matching the pattern from
    ``litho_correlation_edge``.  The UNIQUE constraint on
    ``(model_id, LEAST(contact_a_id, contact_b_id),
    GREATEST(contact_a_id, contact_b_id))`` is expressed as a standard
    ``UniqueConstraint`` on the canonically-ordered columns because
    PostgreSQL cannot use ``LEAST``/``GREATEST`` in a UNIQUE constraint
    directly — the CHECK + caller-normalisation is sufficient.

    Model-level scoping
    -------------------
    ``model_id`` duplicates the information available by following
    ``contact_a.model_id``, but is stored explicitly so the index
    ``idx_litho_contact_corr_model_id`` can satisfy the common
    "list all contact edges for this model" query without a join.

    No relationships defined
    ------------------------
    FK columns only — no SQLAlchemy ``relationship()`` objects.  Use-cases
    load edges with explicit ``select()`` queries to respect the
    clean-architecture rule (domain must not import from infrastructure).
    """

    __tablename__ = "litho_contact_correlation_edge"
    __table_args__ = (
        # Canonical ordering: use-case normalises (min, max) before every
        # INSERT; CHECK is defence in depth.
        CheckConstraint(
            "contact_a_id < contact_b_id",
            name="ck_litho_contact_corr_canonical_order",
        ),
        # A contact cannot be correlated with itself.
        CheckConstraint(
            "contact_a_id != contact_b_id",
            name="ck_litho_contact_corr_no_self_loop",
        ),
        # Only one edge per (model, contact-pair).  Canonical ordering makes
        # this UNIQUE constraint cover the symmetric duplicate.
        UniqueConstraint(
            "model_id",
            "contact_a_id",
            "contact_b_id",
            name="uq_litho_contact_corr_triple",
        ),
        # Source must be one of the two accepted provenance tokens.
        CheckConstraint(
            "source IN ('manual', 'auto')",
            name="ck_litho_contact_corr_source",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # FK to geological_model.  ON DELETE CASCADE — model deletion removes all
    # its contact-correlation edges atomically.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The two contact endpoints (canonical: a < b).  ON DELETE CASCADE —
    # deleting either contact dissolves the edge, keeping the DB consistent
    # when a layer is removed from the section.
    contact_a_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="CASCADE"),
        nullable=False,
    )
    contact_b_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Provenance token.  'manual' = user boundary-click gesture in the section
    # editor.  'auto' = auto-correlate algorithm (Phase 2 of #133).
    source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="manual",
        server_default="manual",
    )

    # User-approved flag — distinguishes auto-proposed edges (False) from
    # manual #135 gestures and accepted auto edges (True).  The lens detector
    # filters to user_approved=True only; auto edges are speculative until
    # the user clicks "Accept correlations" on the section.  Default TRUE so
    # all existing Phase 1 manual edges migrate forward as approved.
    user_approved: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default="true",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
