"""ORM model for CPT metadata and summary statistics."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import DateTime, Double, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class CptOrm(Base):
    """Persisted CPT — header metadata, cone properties, and denormalised summary."""

    __tablename__ = "cpt"
    __table_args__ = (
        Index("idx_cpt_location", "location", postgresql_using="gist"),
        Index("idx_cpt_app_project_id", "app_project_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cpt_type: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # CPTE / CPTU / CPTM / UNKNOWN

    # App-level project scoping (separate from the GEF file's project reference)
    app_project_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)

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
    # Where ``elevation_m`` came from — see ``ElevationSource``. The
    # refresh-on-duplicate import path checks this before overwriting
    # an imported Z so manual edits survive re-imports (debt #8). The
    # default mirrors the column's NOT NULL constraint at the DB layer
    # and stamps "none" for new rows that don't explicitly set it
    # (caller must set the right value before the row is non-trivial).
    elevation_source: Mapped[str] = mapped_column(
        String(8), nullable=False, default=ElevationSource.NONE.value
    )
    # Rollback snapshot (debt #21): the upstream (DOV/GEF) elevation
    # triple captured on the FIRST manual override, so clearing a manual
    # edit restores the surveyed Z instead of nulling the row. NULL =
    # no snapshot held. Logic lives in
    # ``domain.services.elevation_rollback`` (shared with borehole).
    original_elevation_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    original_z_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_elevation_source: Mapped[str | None] = mapped_column(String(8), nullable=True)

    # PostGIS geometry in the source CRS (same SRID as epsg column).
    # NULL when the GEF file has no usable EPSG code (NO_EPSG / NO_COORDINATES
    # validation issues).  We still store the CPT — raw x/y/epsg columns always
    # capture whatever the file contained, and the parse issues document the gap.
    # spatial_index=False — the migration creates idx_cpt_location explicitly via USING GIST
    location: Mapped[WKBElement | None] = mapped_column(
        Geometry("POINT", spatial_index=False), nullable=True
    )

    # Cone properties
    pre_drill_m: Mapped[float] = mapped_column(Double, default=0.0)
    water_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    # Provenance for ``water_depth_m`` — see ``WaterDepthSource``. NULL when no
    # water table is recorded (the row then falls back to the project-wide
    # assumption, labelled as assumed at the UI boundary). ``'engineer'``
    # outranks the file on a refresh-on-duplicate re-import, the same contract
    # ``elevation_source = 'manual'`` gives the surveyed collar (debt #8).
    water_depth_source: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Rollback snapshot for the water table — the exact counterpart of the
    # ``original_elevation_*`` triple above, captured on the FIRST engineer
    # override of a recorded depth so clearing his value restores the file's
    # number instead of dropping the row to the assumption. NULL depth = no
    # snapshot held (the source alone cannot be the sentinel: a legacy row
    # carries a real depth with a NULL source). Logic lives in
    # ``domain.services.water_table_rollback``.
    original_water_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    original_water_depth_source: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Net area ratio (a-value) — parsed directly from GEF MEASUREMENTVAR 3.
    # No fallback is ever inferred: the a-value is a physical cone property
    # (manufacturer-stated or calibrated) and must not be invented.  Using the
    # wrong value corrupts the qt and Bq corrections used in EC7 soil
    # classification.  Absence is flagged by the NO_NET_AREA_RATIO warning.
    cone_area_ratio: Mapped[float | None] = mapped_column(Double, nullable=True)
    cone_type_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stop_criterion: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Denormalised summary — lets list/spatial queries filter without loading the
    # full series arrays (which can be 10k+ floats per CPT).
    max_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    n_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # How a CPT that did NOT come from a data file was produced (Data
    # Integrity rule 1). The PDF digitiser writes ``source = "pdf-digitised"``,
    # the report file + sha, the pages, the calibration and the digitiser
    # version; a clipped point's flag and the printed arrow value live here
    # too (the series arrays have no flag column). NULL for GEF / DOV imports,
    # whose file is their provenance.
    import_provenance: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    series: Mapped[CptSeriesOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "CptSeriesOrm",
        back_populates="cpt",
        uselist=False,
        cascade="all, delete-orphan",
        lazy=RELATIONSHIP_LAZY,
    )
