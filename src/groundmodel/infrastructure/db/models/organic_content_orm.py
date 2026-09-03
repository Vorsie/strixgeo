"""ORM model for OrganicContent — organic carbon and/or organic matter content."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class OrganicContentOrm(Base):
    """Persisted OrganicContent — organic carbon (OC) and/or organic matter (OM).

    Stores ``carbon_pct`` and ``matter_pct`` as **independent** columns
    rather than auto-deriving one from the other. The Van Bemmelen factor
    ``OM ≈ 1.724 × OC`` is empirical and soil-type-dependent (peats range
    1.6–1.9), so silently converting would fabricate data the consumer
    cannot tell apart from a measurement. DOV reports ``Organische C -
    percentage`` (i.e. OC) under ``parametergroep = "Bodem_chemisch"``;
    other labs may report OM directly via loss-on-ignition. We store
    whichever was reported and leave the other NULL.
    """

    __tablename__ = "organic_content"
    __table_args__ = (Index("idx_organic_content_sample_id", "sample_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV per-observation permkey — stable upstream identity for dedup
    # on re-import. See "Refresh-on-duplicate" in CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Organic carbon (OC) — measured by combustion / Walkley-Black; % of dry mass.
    carbon_pct: Mapped[float | None] = mapped_column(Double, nullable=True)
    # Organic matter (OM) — measured by loss on ignition; % of dry mass.
    matter_pct: Mapped[float | None] = mapped_column(Double, nullable=True)

    method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="organic_content_tests", lazy=RELATIONSHIP_LAZY
    )
