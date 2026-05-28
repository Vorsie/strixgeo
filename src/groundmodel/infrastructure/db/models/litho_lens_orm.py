"""ORM model for LithoLens — metadata attached to a lens body (#101 Position 4)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base

# Forward reference — cross_section table is declared in cross_section_orm.py;
# the FK is a string reference to avoid a circular import.
_CROSS_SECTION_TABLE = "cross_section"


class LithoLensOrm(Base):
    """Persisted LithoLens — optional metadata attached to a named lens body.

    Under Position 4 (owner directive 2026-05-24), a "lens body" is identified
    by ``(formation_id, body_ordinal)`` — the connected component ordinal
    computed by the correlation-graph resolver.  A ``LithoLensOrm`` row is NOT
    the body itself; it is METADATA attached to a body that already has an
    identity from the resolver.

    Why this table still exists
    ---------------------------
    * **Name** — the user can attach a human label ("Channel sand lens") to a
      body so the inspector and section header show a readable name.
    * **Primary section** — records the section on which the user first
      interacted with the body, enabling ``CreatePerpendicularCompanion``.
    * **Companion section link** — kept on the cross_section row but mirrored
      here for the reverse direction.

    Body identity
    -------------
    A body is uniquely identified by ``(model_id, formation_id, body_ordinal)``.
    The UNIQUE constraint on those three columns enforces that at most one
    metadata row exists per body.  ``body_ordinal`` is the 0-based ordinal
    assigned by the ``ResolveLithoInstances`` use case (the correlation-graph
    connected-component resolver).

    Cascade semantics
    -----------------
    * ``model_id`` → CASCADE: deleting the model evaporates all lens metadata.
    * ``formation_id`` → CASCADE: deleting the formation evaporates its metadata.
    * ``app_project_id`` → CASCADE: project deletion cascades to all lenses.
    * ``primary_section_id`` → SET NULL: deleting the primary section clears
      the pointer but does not delete the lens metadata row.

    No SQLAlchemy ``relationship()`` objects
    ----------------------------------------
    FK columns only — no ``relationship()`` objects.  Consistent with the rest
    of the geology ORM layer.  Every load goes through an explicit ``select()``
    in the use-case layer.
    """

    __tablename__ = "litho_lens"
    __table_args__ = (
        # One metadata row per body — (model_id, formation_id, body_ordinal)
        # uniquely identifies a body within the correlation resolver.
        UniqueConstraint(
            "model_id",
            "formation_id",
            "body_ordinal",
            name="uq_litho_lens_model_formation_ordinal",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # Denormalised project-scope key.  Greenfield tables created from #101
    # onward DO declare the FK so the cascade is enforced at the DB layer.
    app_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The lithostratigraphic model this lens metadata belongs to.
    # CASCADE — a deleted model evaporates its lens metadata rows.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The formation the body belongs to.  CASCADE — deleting the parent
    # formation also removes its lens metadata children.
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 0-based ordinal assigned by the correlation resolver.  Two distinct
    # clay drapes within the same formation have ordinal 0 and 1 respectively.
    body_ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Stable content key (#163f) — the sorted hash of the body's three
    # defining contact ids, stamped by DetectLithoLenses.  Unlike
    # ``body_ordinal`` (volatile), this survives a resolver re-run, so a
    # user-authored boundary shape (``litho_lens_shape``) joins to the lens
    # by this key and is not lost when the ordinal shifts.  Nullable for rows
    # created before the shaping feature / not yet re-detected.
    content_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional human label.  UI falls back to a derived name when null
    # ("Lens 1 in <formation>").
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # The cross-section the lens was first interacted with.  SET NULL on
    # section delete so the metadata row survives a section reshuffle.
    primary_section_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(f"{_CROSS_SECTION_TABLE}.id", ondelete="SET NULL"),
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
