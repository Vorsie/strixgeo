"""ORM model for CPT metadata and summary statistics."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import DateTime, Double, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class CptOrm(Base):
    """Persisted CPT — header metadata, cone properties, and denormalised summary."""

    __tablename__ = "cpt"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cpt_type: Mapped[str] = mapped_column(String(10), nullable=False)  # CPTE / CPTU / CPTM / UNKNOWN

    # Source file metadata
    project_id: Mapped[str] = mapped_column(String(200), default="")
    test_id: Mapped[str] = mapped_column(String(200), default="")
    file_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    report_code: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Raw source coordinates (native CRS as parsed)
    location_x: Mapped[float] = mapped_column(Double, nullable=False)
    location_y: Mapped[float] = mapped_column(Double, nullable=False)
    elevation_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    z_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # PostGIS geometry (populated on import when CRS is known; NULL otherwise)
    # spatial_index=False — the migration creates idx_cpt_location explicitly via USING GIST
    location: Mapped[WKBElement | None] = mapped_column(Geometry("POINT", spatial_index=False), nullable=True)

    # Cone properties
    pre_drill_m: Mapped[float] = mapped_column(Double, default=0.0)
    water_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    cone_area_ratio: Mapped[float | None] = mapped_column(Double, nullable=True)
    cone_type_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stop_criterion: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Denormalised summary (avoids loading full arrays for list queries)
    max_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    avg_qc_mpa: Mapped[float | None] = mapped_column(Double, nullable=True)
    n_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    series: Mapped[CptSeriesOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "CptSeriesOrm", back_populates="cpt", uselist=False, cascade="all, delete-orphan"
    )
