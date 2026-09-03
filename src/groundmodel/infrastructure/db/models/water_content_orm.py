"""ORM model for WaterContent — moisture content lab test."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class WaterContentOrm(Base):
    """Persisted WaterContent — water content as percentage of dry mass.

    DOV: ``parametergroep = "Bodem_fysisch_vocht"`` /
    ``parameter = "Vochtgehalte luchtdroge grond"`` (unit g/100g, numerically
    equal to %).

    The column is plain DOUBLE PRECISION rather than constrained to 0–100
    because organic soils, peats, and quick clays routinely exceed 100% (the
    water mass can exceed the dry mass — w = m_water / m_dry × 100). The
    domain entity validates 0–1000 to reject clearly non-physical values; we
    don't add a CHECK constraint here for the same reason as elsewhere
    (domain validates; raw-SQL bypass is not in scope).
    """

    __tablename__ = "water_content"
    __table_args__ = (Index("idx_water_content_sample_id", "sample_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV per-observation permkey — stable upstream identity for dedup
    # on re-import. See "Refresh-on-duplicate" in CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    content_pct: Mapped[float | None] = mapped_column(Double, nullable=True)
    method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="water_content_tests", lazy=RELATIONSHIP_LAZY
    )
