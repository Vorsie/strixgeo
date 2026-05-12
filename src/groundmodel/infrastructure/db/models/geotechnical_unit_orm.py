"""ORM model for GeotechnicalUnit — formation subdivision (structure only).

A single geological formation often contains multiple geotechnical
units with different parameter sets (e.g. weathered crust of Boom Klei
vs the undisturbed clay below). The geotechnical model lives one
level below the geological model:

    Project
      └── GeologicalFormation (Boom Klei)
            └── GeotechnicalUnit (weathered crust)
            └── GeotechnicalUnit (undisturbed)

v1.0 stores structure only — name / code / display order / colour /
notes. Per-unit parameter values (γ, c', φ', …) land in Phase 5; the
schema is intentionally narrow today so the MVP gate's "subdivision
without parameters" deliverable is shippable.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class GeotechnicalUnitOrm(Base):
    """Persisted GeotechnicalUnit — a subdivision of a geological formation.

    Parent: ``GeologicalFormationOrm`` (CASCADE delete — removing the
    formation removes every unit beneath it; the user has to confirm
    in the editor before that fires).
    """

    __tablename__ = "geotechnical_unit"
    __table_args__ = (
        Index("idx_geotechnical_unit_app_project_id", "app_project_id"),
        Index("idx_geotechnical_unit_formation_id", "geological_formation_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # App-level scope — denormalised onto the unit row so list / filter
    # queries don't need a join with geological_formation. Matches the
    # convention used by FormationContactOrm / CrossSectionOrm.
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    geological_formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Hex colour ("#aabbcc") — defaults at the API layer so the column
    # stays NOT NULL while fixtures don't have to set it.
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    # Top-to-bottom hint within a formation. Two units with the same
    # display_order in the same formation is allowed (UI breaks ties by
    # name); the column is a hint not a constraint.
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
