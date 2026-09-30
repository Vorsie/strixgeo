"""ORM model for LabSeriesTest — one imported raw lab test (oedometer / triaxial)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Date, DateTime, Double, ForeignKey, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class LabSeriesTestOrm(Base):
    """Persisted raw lab test: the root of test → specimen → stage → channel.

    The six older lab families are scalar rows or one curve. A raw oedometer
    or triaxial test is a three-level shape (specimens, stages, named channel
    arrays), so it is its own typed family (domain-model.md, the catch-all vs
    typed rule (a)). One family serves both kinds, discriminated by ``kind``,
    because the storage shape is the same and the next raw tests (direct
    shear, CRS, permeability) fit it too.

    Identity and header values are the LAB's, pass-through (Data Integrity
    §2): the lab's job, sample, borehole and sequence as written, the lab's
    sampling interval (the SAMPLE interval, owner 2026-09-29), the visual
    description. The match to a project sample is ``sample_id``, never the
    lab's names.

    ``source_sha256`` makes a re-import idempotent: same identity + same hash
    is a no-op; same identity + a different hash is a consented refresh (the
    CPT pattern). ``import_issues`` freezes the parser findings of the import
    that wrote the row, so the flags stay visible after the file is gone.
    ``n_specimens`` is a denormalised count (Data Integrity §4) rewritten in
    the same transaction as the specimens.
    """

    __tablename__ = "lab_series_test"
    __table_args__ = (
        Index("idx_lab_series_test_sample_id", "sample_id"),
        # The re-import identity lookup filters on the lab's sample number.
        Index("idx_lab_series_test_lab_sample_number", "lab_sample_number"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Our vocabulary: 'oedometer' | 'triaxial' (LabSeriesKind).
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # The lab's test-type token verbatim ('CD', 'CU', 'UU'); NULL for oedometer.
    test_type_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A standard the export names (e.g. 'NBN EN ISO 17892-9:2018'); none of the
    # raw exports names one today, a later listing companion may.
    standard_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lab identity as written (TEXT: free-form upstream strings).
    lab_job_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    lab_sample_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    lab_borehole_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    lab_sequence_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The lab's sampling interval, m below ground (pass-through).
    sampling_depth_top_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    sampling_depth_base_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    visual_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Source stamp: which export, which file, which native lab file.
    source_format: Mapped[str] = mapped_column(Text, nullable=False)
    source_file_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    source_native_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_program_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Every sample-level header label → value as read (display only).
    source_header: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    # Parser findings frozen at import: [{level, code, message, rows}].
    import_issues: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    n_specimens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="lab_series_tests", lazy=RELATIONSHIP_LAZY
    )
    specimens: Mapped[list[LabSeriesSpecimenOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesSpecimenOrm",
        back_populates="test",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LabSeriesSpecimenOrm.sort_order",
        lazy=RELATIONSHIP_LAZY,
    )
    lab_results: Mapped[list[LabSeriesLabResultOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesLabResultOrm",
        back_populates="test",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LabSeriesLabResultOrm.sort_order",
        lazy=RELATIONSHIP_LAZY,
    )
