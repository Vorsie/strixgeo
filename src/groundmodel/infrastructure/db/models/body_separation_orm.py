"""ORM model for BodySeparation — a user "Separate" ruling on two bodies."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodySeparationOrm(Base):
    """One user "Separate" ruling — a cannot-link constraint between two layers.

    Owner ruling 2026-08-31 (debt #278, R5): the "Separate" verb is the
    counterpart to Dissolve, so the engineer can state *"these two are NOT the
    same body"* and have the resolver honour it PERMANENTLY. His standing rule:
    *"a body is only a body if it is geometrically connected, OR if the user says
    this body is the same as that body"* — a separation is the subtractive half
    that only the user can write.

    Semantics: **the body containing ``layer_a_id`` is never the same body as the
    body containing ``layer_b_id``.** The resolver reads these rows and drops any
    edge whose union would place the two anchors under one root, even across an
    indirect chain of ties / geometry facts.

    LAYER-id space, never body-id space: body ids re-mint on every resolve (the
    ``(formation, ordinal)`` key recycles rows, a production oscillation observed
    2026-08-12), so a body-anchored constraint would bind the wrong mass after
    the next renumbering. Anchoring on the layer rows survives that.

    ONLY the user writes rows here — the tombstone rule (cf.
    ``geotech_tie_tombstone_orm``): a separation records the ENGINEER's judgement,
    not the machine's housekeeping. The resolver, the recompute, the subdivide
    all READ separations; none of them CREATE one.

    Anchors are stored in canonical ``layer_a_id < layer_b_id`` order (the
    ``body_geometry_fact`` pattern) so the pair is unique regardless of the order
    the user selected the two bodies in.
    """

    __tablename__ = "body_separation"
    __table_args__ = (
        # Canonical ordering (min, max) — the router normalises before INSERT;
        # the CHECK is defence in depth (the correlation-edge / geometry-fact
        # pattern).
        CheckConstraint(
            "layer_a_id < layer_b_id",
            name="ck_body_separation_canonical_order",
        ),
        # One separation per (model, ordered pair): the verb is reversible and
        # idempotent — re-asserting an existing separation returns the same row,
        # never a second one.
        UniqueConstraint(
            "model_id",
            "layer_a_id",
            "layer_b_id",
            name="uq_body_separation_pair",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # ON DELETE CASCADE: deleting the model (a stage wipe, a re-subdivide from
    # scratch) takes the engineer's separations with it — a fresh model is a
    # fresh set of bodies to judge. Indexed — the resolver scans by model.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The two anchor layers (canonical: a < b). ON DELETE CASCADE — a wiped layer
    # (subdivide/divide rebuilding the geotech bands with fresh ids) takes its
    # separations with it, exactly as it takes accepted ties. The re-anchor pass
    # (``body_separation_reanchor``) captures the anchors' band identities before
    # the wipe and re-creates the row against the rebuilt bands afterwards, so a
    # geotech separation survives a re-subdivide.
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
