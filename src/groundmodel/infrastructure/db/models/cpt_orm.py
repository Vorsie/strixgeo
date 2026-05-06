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

    # PostGIS geometry in the source CRS (same SRID as epsg column).
    # NULL when the GEF file has no usable EPSG code (NO_EPSG / NO_COORDINATES
    # validation issues).  We still store the CPT — raw x/y/epsg columns always
    # capture whatever the file contained, and the parse issues document the gap.
    # spatial_index=False — the migration creates idx_cpt_location explicitly via USING GIST
    location: Mapped[WKBElement | None] = mapped_column(Geometry("POINT", spatial_index=False), nullable=True)

    # Cone properties
    pre_drill_m: Mapped[float] = mapped_column(Double, default=0.0)
    water_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    # Net area ratio (a-value) — parsed directly from GEF MEASUREMENTVAR 3.
    # No fallback is ever inferred: the a-value is a physical cone property
    # (manufacturer-stated or calibrated) and must not be invented.  Using the
    # wrong value corrupts the qt and Bq corrections used in EC7 soil
    # classification.  Absence is flagged by the NO_NET_AREA_RATIO warning.
    cone_area_ratio: Mapped[float | None] = mapped_column(Double, nullable=True)
    cone_type_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stop_criterion: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Denormalised summary — lets spatial / cross-CPT queries filter by depth or
    # soil stiffness without loading the full series arrays (which can be 10k+
    # floats per CPT).  avg_qc_mpa is a rough proxy for overall soil resistance
    # useful for map-layer colouring and filtering ("show CPTs with avg qc > 5 MPa
    # in this area").  Precise profile analysis always goes back to the full arrays.
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
