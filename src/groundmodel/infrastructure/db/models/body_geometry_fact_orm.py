"""ORM model for BodyGeometryFact — persisted geometric body-connectivity facts."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyGeometryFactOrm(Base):
    """One observed geometric adjacency between two same-lithology layers.

    Owner ruling 2026-08-12: *"every same litho that is connected should get
    the same body id"* — connectivity read off the partition fill (tie-born
    band/onlap/lens regions, never fallback paint), per section plus across
    sections at shared columns and fence crossings. A tie cannot state this
    without redrawing the fill (a tie defines the 2/1/0 geometry AND body
    membership), so the statement gets its own record.

    A fact is an **edge for the body resolver**, nothing more: `_run_resolver`
    unions facts alongside user-approved correlation edges, under the same
    one-lithology filter and the same dangling-endpoint guard. Facts are NOT
    correlations — they draw nothing, they carry no fill semantics, and the
    section render never reads them.

    Facts are pairs actually OBSERVED adjacent by the recompute (never a star
    per component): the graph mirrors physical adjacency, so losing one layer
    breaks only what physically broke.

    Lifecycle: ``RecomputeBodies`` replaces a model's facts wholesale from the
    frontend's current partition — the frontend owns the partition geometry
    (Tier-D note in docs/design/body-model.md), so facts are a snapshot that
    the debounced background recompute keeps fresh. Stale facts self-heal at
    the next recompute; in between, the dangling guard neutralises facts whose
    endpoints were deleted (FK CASCADE) or rejected (status flip).
    """

    __tablename__ = "body_geometry_fact"
    __table_args__ = (
        # Canonical ordering (min, max) — the use case normalises before every
        # INSERT; CHECK is defence in depth (the correlation-edge pattern).
        CheckConstraint(
            "layer_a_id < layer_b_id",
            name="ck_body_geometry_fact_canonical_order",
        ),
        UniqueConstraint(
            "model_id",
            "layer_a_id",
            "layer_b_id",
            name="uq_body_geometry_fact_pair",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # ON DELETE CASCADE: model deletion removes its facts atomically. Indexed —
    # the resolver and the full-replace both scan by model.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The two layers observed geometrically connected (canonical: a < b).
    # ON DELETE CASCADE — a wiped layer (e.g. subdivide-cpts deleting every
    # geotech row) takes its facts with it.
    layer_a_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("litho_layer.id", ondelete="CASCADE"),
        nullable=False,
    )
    layer_b_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("litho_layer.id", ondelete="CASCADE"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
