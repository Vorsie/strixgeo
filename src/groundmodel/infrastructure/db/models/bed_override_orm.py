"""ORM model for BedOverride — a project-scoped manual bed-level polygon."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Double, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BedOverrideOrm(Base):
    """Persisted manual bed-level override — a map polygon at one elevation.

    The owner's site was dredged for a canal.  The DEM over the water carries
    the water surface, not the dredged bed, so the ground surface would place
    the terrain (and everything clipped to it) at the wrong level under the
    water.  A ``BedOverride`` is the manual fix: inside the polygon the ground
    surface takes ``level_m`` instead of the DEM; outside, the DEM stands.

    Bathymetry survey-file import stays Phase 5 — only the drawn polygon exists
    now.  Bed overrides are **project-scoped** (like ``CrossSectionOrm``): they
    apply to the whole project's ground surface, independent of any single
    geological model.

    The polygon ring is stored as JSONB (a list of ``[x, y]`` pairs in the
    project's horizontal CRS) rather than PostGIS geometry — v1 needs no
    spatial query on bed overrides, and the point-in-polygon test lives in the
    domain layer, consistent with the section point-shape vocabulary.
    """

    __tablename__ = "bed_override"
    __table_args__ = (Index("idx_bed_override_app_project_id", "app_project_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    # Project scope. Plain UUID + no FK, matching the convention on
    # cross_section / cpt / borehole (scope is enforced in the app layer).
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Human-readable name shown in the bed-override list (e.g. "Canal bed").
    label: Mapped[str] = mapped_column(String(200), nullable=False)

    # The bed elevation in the project's vertical datum (m TAW / NAP). One
    # constant value across the whole polygon. 0.0 is a real elevation.
    level_m: Mapped[float] = mapped_column(Double, nullable=False)

    # EPSG of the polygon's coordinates — the project's horizontal CRS.
    epsg: Mapped[int] = mapped_column(Integer, nullable=False)

    # The polygon ring as a JSONB list of [x, y] pairs in the project CRS.
    # Open ring (the closing edge is implicit). Server default "[]" so a row
    # inserted before a vertex list is written reads as an empty (degenerate)
    # polygon rather than NULL.
    vertices: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
