"""ORM model for Sample — material taken from a borehole at a depth interval."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class SampleOrm(Base):
    """Persisted Sample — material taken from a borehole at a depth interval.

    A Sample is the link between a borehole and the lab tests performed on
    its material (grain size, Atterberg, CaCO3, organic content, water
    content — each in its own table linked to ``sample.id``).

    ``depth_top_m`` and ``depth_base_m`` accept equal values: DOV uses spot
    samples (top == base) for non-depth-resolved samples and we store them
    faithfully rather than fabricating a synthetic interval.

    All metadata fields are source-vocabulary strings, never translated at
    ingest. ``sample_number`` is the source's own identifier (DOV ``monster``
    is often a small integer like "0" or "19"); ``sample_type``,
    ``composition``, and ``instrument`` carry DOV's Dutch terms.
    """

    __tablename__ = "sample"
    __table_args__ = (Index("idx_sample_borehole_id", "borehole_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    borehole_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=False,
    )
    depth_top_m: Mapped[float] = mapped_column(Double, nullable=False)
    depth_base_m: Mapped[float] = mapped_column(Double, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    sample_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sample_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    composition: Mapped[str | None] = mapped_column(String(50), nullable=True)
    instrument: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sampling_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    borehole: Mapped[BoreholeOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BoreholeOrm", back_populates="samples"
    )
