"""ORM model for BodyUnion — a user "Join with…" ruling on two bodies."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyUnionOrm(Base):
    """One user "Join with…" ruling — a must-link constraint between two layers.

    Owner ruling 2026-08-31 (debt #278): the "Join with…" verb is the POSITIVE
    half of the body-identity rule, the counterpart to Separate. His standing
    rule: *"a body is only a body if it is geometrically connected, OR if the
    user says this body is the same as that body"* — a union is that second,
    additive half, which only the user writes.

    Semantics: **the body containing ``layer_a_id`` IS the same body as the body
    containing ``layer_b_id``.** The resolver reads these rows and merges the two
    anchors even when no edge (tie or geometry fact) connects them — the mirror of
    a ``body_separation``, which forbids the merge. A union that would make a
    mixed body (across two soils / packing classes) is inert, and a union
    contradicting a standing separation is suppressed (cannot-link wins): both are
    decided in the pure resolver, never here.

    LAYER-id space, never body-id space: body ids re-mint on every resolve (the
    ``(formation, ordinal)`` key recycles rows, a production oscillation observed
    2026-08-12), so a body-anchored constraint would bind the wrong mass after
    the next renumbering. Anchoring on the layer rows survives that.

    ONLY the user writes rows here — the tombstone rule (cf.
    ``body_separation_orm`` / ``geotech_tie_tombstone_orm``): a union records the
    ENGINEER's judgement, not the machine's housekeeping. The resolver, the
    recompute, the subdivide all READ unions; none of them CREATE one.

    Anchors are stored in canonical ``layer_a_id < layer_b_id`` order (the
    ``body_separation`` / ``body_geometry_fact`` pattern) so the pair is unique
    regardless of the order the user selected the two bodies in.
    """

    __tablename__ = "body_union"
    __table_args__ = (
        # Canonical ordering (min, max) — the router normalises before INSERT;
        # the CHECK is defence in depth (the separation / geometry-fact pattern).
        CheckConstraint(
            "layer_a_id < layer_b_id",
            name="ck_body_union_canonical_order",
        ),
        # One union per (model, ordered pair): the verb is reversible and
        # idempotent — re-asserting an existing union returns the same row,
        # never a second one.
        UniqueConstraint(
            "model_id",
            "layer_a_id",
            "layer_b_id",
            name="uq_body_union_pair",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # ON DELETE CASCADE: deleting the model (a stage wipe, a re-subdivide from
    # scratch) takes the engineer's unions with it — a fresh model is a fresh set
    # of bodies to judge. Indexed — the resolver scans by model.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The two anchor layers (canonical: a < b). ON DELETE CASCADE — a wiped layer
    # (subdivide/divide rebuilding the geotech bands with fresh ids) takes its
    # unions with it, exactly as it takes accepted ties. The re-anchor pass
    # (``body_union_reanchor``) captures the anchors' band identities before the
    # wipe and re-creates the row against the rebuilt bands afterwards, so a
    # geotech union survives a re-subdivide.
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
