"""ORM model for CaCO3Content — calcium carbonate (lime) content lab test."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class CaCO3ContentOrm(Base):
    """Persisted CaCO3Content — calcium carbonate (lime) content of a sample.

    DOV exposes this under ``parametergroep = "Bodem_chemisch"`` /
    ``parameter = "Calciumcarbonaatgehalte (caco3_gehalte)"``.

    Distinct from ``GrainSize.lime_removed`` — that is a pre-treatment
    boolean indicating whether lime was chemically stripped before a grain-
    size test. This row stores a measured % by mass.
    """

    __tablename__ = "caco3_content"
    __table_args__ = (Index("idx_caco3_content_sample_id", "sample_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV per-observation permkey — stable upstream identity for dedup
    # on re-import. See "Refresh-on-duplicate" in CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # CaCO3 content in % of dry mass; 0–100 range. Nullable so a row can be
    # created with method/test_date metadata even when the value itself is
    # pending or below detection.
    content_pct: Mapped[float | None] = mapped_column(Double, nullable=True)

    method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="caco3_content_tests", lazy=RELATIONSHIP_LAZY
    )
