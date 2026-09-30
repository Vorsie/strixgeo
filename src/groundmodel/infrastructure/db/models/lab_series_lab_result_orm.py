"""ORM model for LabSeriesLabResult — a summary value the lab reported."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Double, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class LabSeriesLabResultOrm(Base):
    """Persisted lab-reported value: pass-through, read-only, never an input.

    Owner 2026-09-29: "don't use default values, you can list them but we'll
    be doing our own interpretations". So the lab's per-stage table (e, Cc,
    av, mv, ...) and a triaxial specimen's before/after values are stored
    here, labelled ``provenance = 'lab_reported'``, shown in a "Reported by
    the lab" table and fed into NOTHING Strix computes.

    The row names its place by the lab's own coordinates — ``specimen_label``
    ('a', 'b', 'c'; NULL for the oedometer) and ``stage_index`` (the lab's
    stage number; NULL for a specimen-level value) — rather than a foreign key
    to a specimen / stage row: the value is the lab's statement about its own
    test, and keying it by the lab's labels keeps it readable when a refresh
    re-creates the specimen rows.
    """

    __tablename__ = "lab_series_lab_result"
    __table_args__ = (Index("idx_lab_series_lab_result_test_id", "test_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    test_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("lab_series_test.id", ondelete="CASCADE"),
        nullable=False,
    )
    specimen_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The lab's label verbatim ('e', 'Cc', 'Watergehalte (voor de proef)').
    parameter: Mapped[str] = mapped_column(Text, nullable=False)
    value_numeric: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance: Mapped[str] = mapped_column(Text, nullable=False, default="lab_reported")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    test: Mapped[LabSeriesTestOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesTestOrm", back_populates="lab_results", lazy=RELATIONSHIP_LAZY
    )
