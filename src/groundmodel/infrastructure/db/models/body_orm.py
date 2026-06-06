"""ORM model for Body — replaces LithoLensOrm (#body-with-extent 2026-05-31).

A body is identified by ``(model_id, formation_id, body_ordinal)``. The
partition-fill model (member-layer chains keyed on ``litho_layer.body_id``
plus ``body_boundary_shape``) owns the body's lateral shape; the per-side
``extent_*`` markers were retired 2026-06-06.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyOrm(Base):
    """Persisted body — identity row for one correlated single-lithology unit.

    Replaces LithoLensOrm. Pre-ship backwards-compat is suspended, so the
    rename is clean (no alias kept). The body's lateral shape is owned by
    the partition-fill model (member-layer chains keyed on
    ``litho_layer.body_id`` + ``body_boundary_shape``); the per-side
    ``extent_*`` markers were retired 2026-06-06.

    Body identity
    -------------
    A body is uniquely identified by ``(model_id, formation_id,
    body_ordinal)``. The UNIQUE constraint on those three columns enforces
    that at most one row exists per body. ``body_ordinal`` is the 0-based
    ordinal assigned by the ``ResolveLithoInstances`` use case (the
    correlation-graph connected-component resolver).

    Cascade semantics
    -----------------
    * ``app_project_id`` → CASCADE
    * ``model_id`` → CASCADE
    * ``formation_id`` → CASCADE
    * ``primary_section_id`` → SET NULL (body survives section delete)

    ``source_investigation_id`` is polymorphic UUID (refs cpt.id OR
    borehole.id); NO FK constraint, mirroring the existing
    ``formation_contact.borehole_id`` / ``cpt_id`` pattern. Cascade on
    investigation delete is handled at the use-case layer.

    No SQLAlchemy ``relationship()`` objects
    ----------------------------------------
    FK columns only — no ``relationship()`` objects. Consistent with the
    rest of the geology ORM layer. Every load goes through an explicit
    ``select()`` in the use-case layer.
    """

    __tablename__ = "body"
    __table_args__ = (
        UniqueConstraint(
            "model_id",
            "formation_id",
            "body_ordinal",
            name="uq_body_model_formation_ordinal",
        ),
        # Project-scope key index — the bundle build and _restore_bodies both
        # filter ``BodyOrm.app_project_id == project_id``; without this index
        # those are seq-scans (every other project-scoped root has one).
        Index("idx_body_app_project_id", "app_project_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # Denormalised project-scope key — CASCADE enforced at the DB layer.
    app_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The lithostratigraphic model this body belongs to.
    # CASCADE — a deleted model evaporates its body rows.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The formation the body belongs to.
    # CASCADE — deleting the formation removes its body rows.
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 0-based ordinal assigned by the correlation resolver. Two distinct
    # clay drapes within the same formation have ordinal 0 and 1.
    body_ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Polymorphic UUID — refs cpt.id OR borehole.id. NO FK constraint.
    source_investigation_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Optional human label. UI falls back to a derived name when null.
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # The cross-section the body was first interacted with.
    # SET NULL on section delete so the body row survives a section reshuffle.
    primary_section_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cross_section.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
