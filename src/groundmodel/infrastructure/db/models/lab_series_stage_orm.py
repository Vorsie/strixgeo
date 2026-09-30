"""ORM model for LabSeriesStage — one load step / shear phase of a specimen."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Double, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class LabSeriesStageOrm(Base):
    """Persisted stage: an oedometer load step or a triaxial shear phase.

    The reading AXIS lives here, the channels hang below it:

    * oedometer: ``reading_timestamps`` — the absolute timestamp of every
      reading, raw (local lab time, no zone);
    * triaxial: ``point_numbers`` — the lab's measuring-point numbers. The
      triaxial dumps carry NO time column (owner 2026-09-29: "what we have is
      what we have"), so the point number is the only axis there is.

    ``rezero_indices`` marks readings that repeat the previous timestamp at a
    dial-gauge re-zero: stored as read, skipped by a viewer and by any count,
    so no series counts that moment twice.

    Stage values from the header / footer (hanger load, listed stress, height
    at the stage start, the lab's stage settlement and C / A coefficient) are
    pass-through; the lab's ones are the lab's computation and stay labelled
    ``lab_``. ``n_readings`` is denormalised (Data Integrity §4).
    """

    __tablename__ = "lab_series_stage"
    __table_args__ = (
        UniqueConstraint("specimen_id", "stage_index", name="uq_lab_series_stage_index"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    specimen_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("lab_series_specimen.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 1-based, test order (the lab's stage number for an oedometer).
    stage_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'load_step' (oedometer) | 'shear' (triaxial).
    stage_kind: Mapped[str] = mapped_column(Text, nullable=False)
    # 'Belasting' (loading) / 'Ontlasting' (unloading) verbatim; NULL when the
    # export carries no token (triaxial, the newer oedometer module).
    direction_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    hanger_load_kg: Mapped[float | None] = mapped_column(Double, nullable=True)
    # The stress the listing prints for the stage (pass-through, never computed).
    target_stress_kpa: Mapped[float | None] = mapped_column(Double, nullable=True)
    height_at_start_mm: Mapped[float | None] = mapped_column(Double, nullable=True)
    lab_stage_settlement_mm: Mapped[float | None] = mapped_column(Double, nullable=True)
    lab_coefficient_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    lab_coefficient: Mapped[float | None] = mapped_column(Double, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    reading_timestamps: Mapped[list[datetime] | None] = mapped_column(
        ARRAY(DateTime(timezone=False)), nullable=True
    )
    point_numbers: Mapped[list[int] | None] = mapped_column(ARRAY(Integer), nullable=True)
    rezero_indices: Mapped[list[int] | None] = mapped_column(ARRAY(Integer), nullable=True)
    n_readings: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    specimen: Mapped[LabSeriesSpecimenOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesSpecimenOrm", back_populates="stages", lazy=RELATIONSHIP_LAZY
    )
    channels: Mapped[list[LabSeriesChannelOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesChannelOrm",
        back_populates="stage",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LabSeriesChannelOrm.sort_order",
        lazy=RELATIONSHIP_LAZY,
    )
