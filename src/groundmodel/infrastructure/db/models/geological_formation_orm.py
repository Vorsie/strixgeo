"""ORM model for GeologicalFormation — project-scoped formation vocabulary."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class GeologicalFormationOrm(Base):
    """Persisted GeologicalFormation — a project's substrate vocabulary entry.

    A formation is the primary modelling unit (Boom Klei, Diest Zand,
    Quaternary deposits, ...). Each project carries its own list — the
    same formation name in two different projects is two separate rows.
    A future SaaS layer might normalise this into a shared catalogue,
    but at v1 we keep the data fully self-contained per project so
    .gmproj bundles stay round-trippable.

    Companion tables:
    * ``GeologicalModelOrm`` — the interpretation container that
      references formations through FormationContact.
    * ``FormationContactOrm`` — anchored data points (formation top at
      a specific investigation).
    """

    __tablename__ = "geological_formation"
    __table_args__ = (Index("idx_geological_formation_app_project_id", "app_project_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # App-level scope — plain UUID column with no FK, matching the
    # convention used by CptOrm / BoreholeOrm. Lifetimes are decoupled.
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Hex string ("#aabbcc"). Defaulted at the API layer so the column
    # can be NOT NULL without forcing every test fixture to set it.
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    # Top-to-bottom hint for the legend / borelog ordering. Ties are
    # tolerated and broken by name in the UI.
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Opaque pointer to whatever public source seeded this formation
    # (G3Dv3 formation id in Flanders, BRO-NL DGM unit code, etc.).
    # Free-text so adding a new source needs no migration.
    regional_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Reverse relationship for cascade discovery + bundle serialisation.
    # No load by default; callers selectinload explicitly when they need
    # the contacts (typically the editor and the bundle exporter).
    contacts: Mapped[list[FormationContactOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "FormationContactOrm",
        back_populates="formation",
        cascade="all, delete-orphan",
    )
