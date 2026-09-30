"""ORM model for LabSeriesSpecimen — one specimen of a raw lab test."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class LabSeriesSpecimenOrm(Base):
    """Persisted specimen: a triaxial "deelmonster" (a, b, c) or THE oedometer specimen.

    Every value is the lab's, as written (pass-through). The typed columns are
    the ones a viewer or a later analysis reads; every header label the export
    carries for the specimen also rides verbatim in ``source_header`` so
    nothing is lost to the promotion. Columns a kind does not fill stay NULL
    (an oedometer has no strain rate, a triaxial dump no lever ratio).

    The specimen depth interval is the SPECIMEN's (owner 2026-09-29: the
    listing interval is the sample interval, the specimen / .DAT interval the
    specimen interval). None of the raw exports carries it today, so it is
    NULL until a companion listing is imported.

    ``n_points`` is a denormalised reading count over all stages (Data
    Integrity §4), rewritten with the stages.
    """

    __tablename__ = "lab_series_specimen"
    __table_args__ = (Index("idx_lab_series_specimen_test_id", "test_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    test_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("lab_series_test.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The lab's specimen letter ('a', 'b', 'c'); NULL for the one oedometer specimen.
    specimen_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    # File order, 0-based.
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    initial_height_mm: Mapped[float | None] = mapped_column(Double, nullable=True)
    initial_diameter_mm: Mapped[float | None] = mapped_column(Double, nullable=True)
    initial_wet_mass_g: Mapped[float | None] = mapped_column(Double, nullable=True)
    dry_mass_g: Mapped[float | None] = mapped_column(Double, nullable=True)
    initial_water_content_pct: Mapped[float | None] = mapped_column(Double, nullable=True)
    grain_density_t_m3: Mapped[float | None] = mapped_column(Double, nullable=True)
    # How the grain density was obtained, verbatim ("aangenomen" = assumed).
    grain_density_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    specimen_depth_top_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    specimen_depth_base_m: Mapped[float | None] = mapped_column(Double, nullable=True)

    # Triaxial.
    strain_rate_mm_per_min: Mapped[float | None] = mapped_column(Double, nullable=True)
    consolidation_stress_kpa: Mapped[float | None] = mapped_column(Double, nullable=True)
    consolidation_volume_change_cm3: Mapped[float | None] = mapped_column(Double, nullable=True)
    failure_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Per channel word its calibration {"a": .., "b": ..} (all a=1, b=0 so far).
    calibration: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Oedometer.
    apparatus_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    lever_ratio: Mapped[float | None] = mapped_column(Double, nullable=True)
    dial_coefficient_mm_per_unit: Mapped[float | None] = mapped_column(Double, nullable=True)
    mounting_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Every specimen header label → value(s) as read.
    source_header: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    n_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    test: Mapped[LabSeriesTestOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesTestOrm", back_populates="specimens", lazy=RELATIONSHIP_LAZY
    )
    stages: Mapped[list[LabSeriesStageOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesStageOrm",
        back_populates="specimen",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LabSeriesStageOrm.stage_index",
        lazy=RELATIONSHIP_LAZY,
    )
