"""ORM model for LithoCorrelationEdge — Phase-2 litho correlation."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoCorrelationEdgeOrm(Base):
    """Persisted LithoCorrelationEdge — one undirected edge in the correlation graph.

    An edge records that two ``geological_formation`` rows (both in the
    same lithostratigraphic model) belong to the **same stratigraphic
    instance** of a given lithology.  The edge joins formation rows, NOT
    contact rows — it is a model-level decision that persists independently
    of any individual investigation pick.

    Canonical ordering
    ------------------
    ``formation_a_id < formation_b_id`` is enforced by a DB CHECK constraint
    AND by every use-case caller before INSERT.  This halves the effective
    uniqueness space and makes the UNIQUE constraint on the triple
    ``(model_id, formation_a_id, formation_b_id)`` sufficient to represent
    the undirected edge uniquely.

    Graph semantics
    ---------------
    The full set of edges for a model forms an undirected graph over
    formation nodes.  Connected components in this graph are the
    **correlation groups**.  The resolver (``resolve_litho_instances``)
    labels each node within a group with an ``instance_ordinal`` —
    e.g. "ZAND body 1" vs "ZAND body 2" when two sand bodies within the
    same geological formation are known to be stratigraphically distinct.

    No relationships defined
    ------------------------
    FK columns only — no SQLAlchemy ``relationship()`` objects.  The
    resolver and use-cases load edges with explicit ``select()`` queries.
    Adding relationships would pull the ORM into the domain services and
    violate the clean-architecture rule (domain must not import from
    infrastructure).
    """

    __tablename__ = "litho_correlation_edge"
    __table_args__ = (
        # Canonical ordering: the use case normalises (min, max) before
        # every insert; the CHECK is defence in depth.
        CheckConstraint(
            "formation_a_id < formation_b_id",
            name="ck_litho_correlation_edge_canonical_order",
        ),
        # A formation cannot be correlated with itself.
        CheckConstraint(
            "formation_a_id != formation_b_id",
            name="ck_litho_correlation_edge_no_self_loop",
        ),
        # Only one edge per (model, formation-pair).  With canonical
        # ordering this also blocks the symmetric duplicate.
        UniqueConstraint(
            "model_id",
            "formation_a_id",
            "formation_b_id",
            name="uq_litho_correlation_edge_triple",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # FK to geological_model.  ON DELETE CASCADE — model deletion removes
    # all its correlation edges atomically.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The two formation endpoints (canonical: a < b).  ON DELETE CASCADE
    # — deleting either formation dissolves the edge.
    formation_a_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )
    formation_b_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Provenance token.  'manual' = user-drawn gesture in the section
    # editor (the only source in Phase 2; future: 'g3dv3_seed',
    # 'cpt_sbt_auto').
    source: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="manual",
        server_default="manual",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
