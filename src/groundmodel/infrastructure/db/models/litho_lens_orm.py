"""ORM model for LithoLens — first-class lens entity (#101)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoLensOrm(Base):
    """Persisted LithoLens — a body of one lithology within a parent formation.

    A lens is a geological body that exists at some investigations and is
    explicitly absent at others. It carries its own identity so two
    distinct lenses of the same parent formation (e.g. two clay drapes at
    different elevations within the same sand) do not collide
    (Q1 directive 2026-05-24 — two LithoLens entities sharing the same
    parent formation, NOT one formation with two depth ranges).

    Relationship cardinality
    ------------------------
    * One ``geological_formation`` → many ``litho_lens`` rows
    * One ``litho_lens`` → many ``formation_contact`` rows (tagged via
      the nullable ``lens_id`` column on the contact table)
    * One ``litho_lens`` → many ``litho_lens_absence`` rows
      (added in Slice 2)
    * One ``litho_lens`` → 0..1 ``cross_section`` rows as its
      perpendicular companion (added in Slice 4 via the nullable
      ``companion_lens_id`` column on the section table)

    No SQLAlchemy ``relationship()`` objects defined — every load goes
    through an explicit ``select()`` in the use case layer. Adding
    relationships pulls the ORM into the domain services and breaks the
    clean-architecture layering rule.
    """

    __tablename__ = "litho_lens"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # Denormalised project-scope key. Existing project-scoped tables
    # (cpt, borehole, cross_section, geological_model, ...) carry
    # ``app_project_id`` as a plain UUID without an FK — legacy
    # convention, tracked under debt #107. Greenfield tables created
    # from #101 onward DO declare the FK so the cascade is enforced
    # at the DB layer.
    app_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The lithostratigraphic model this lens belongs to. CASCADE so a
    # deleted model evaporates its lenses (they have no meaning outside
    # their model).
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The formation the lens carves a body out of. Mandatory — a lens
    # always lives within a parent formation. CASCADE: deleting the
    # parent formation also removes its lens children.
    parent_formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Optional human label. UI falls back to a derived name when null
    # ("Lens 1 in <formation>").
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
