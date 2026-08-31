"""ORM model for Body — replaces LithoLensOrm (#body-with-extent 2026-05-31).

A body is identified by ``(model_id, formation_id, body_ordinal)``. The
partition-fill model (member-layer chains keyed on ``litho_layer.body_id``
plus ``body_boundary_shape``) owns the body's lateral shape; the per-side
``extent_*`` markers were retired 2026-06-06.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
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
        # Litho-parent-body backlink (debt #278, R1) — the resolver re-stamps
        # every sibling geotech body of a litho recompute through this column.
        Index("idx_body_parent_litho_body", "parent_litho_body_id"),
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
    # TEXT, not VARCHAR(N) — a user-entered free-form label should never
    # surprise-truncate (CLAUDE.md schema-design rule; debt #126).
    name: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Per-project display colour override for the 3D Solid view.
    #
    # Nullable hex string, e.g. ``"#aabbcc"``.  ``null`` means "fall back to
    # the lithology (formation) colour" — the 3D viewer reads formation.color
    # when this is absent.  Stored here (not in localStorage) because it is a
    # per-project engineering decision — the engineer picks a colour that
    # communicates something about THIS project's model, so it must travel in
    # the .gmproj/.strix bundle and survive a move to a different machine.
    # Task 8 adds the colour-picker UI; this column is the persistence layer.
    display_color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # The cross-section the body was first interacted with.
    # SET NULL on section delete so the body row survives a section reshuffle.
    primary_section_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cross_section.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The litho parent BODY this geotech body subdivides (self-referencing).
    #
    # Owner ruling 2026-08-31 (debt #278, R1): one connected geotech body is one
    # row with an FK to its litho parent. NULL on litho-model rows (they ARE
    # litho bodies) and on a geotech body with no derivable litho parent (every
    # member band lacks a covering accepted litho band).
    #
    # MAINTENANCE CONTRACT — resolver-maintained, never restored from a bundle:
    # * every GEOTECH resolve stamps this from the body's SHALLOWEST member
    #   band's ``litho_layer.parent_litho_layer_id`` -> that litho layer's
    #   ``body_id`` (mirrors the shallowest-member rule the body formation uses);
    # * every LITHO resolve re-mints litho body ids, so it re-stamps every
    #   sibling geotech model's bodies in the SAME transaction — a re-minted
    #   litho body id therefore never leaves a geotech body dangling;
    # * ``ON DELETE SET NULL`` catches the residual case where a litho body row
    #   is deleted outright.
    # This deliberately reverses the band-FK-only note on
    # ``litho_layer.parent_litho_layer_id`` (that FK stays — it is the band-level
    # link this body-level FK is derived FROM).
    parent_litho_body_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body.id", ondelete="SET NULL"),
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
