"""ORM model for AtterbergLimits — consistency-limits lab test."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Boolean, Date, Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class AtterbergLimitsOrm(Base):
    """Persisted AtterbergLimits — liquid limit, plastic limit, and non-plastic flag.

    Stores ONLY the measured limits and the non-plastic flag. The
    plasticity index ``PI = LL - PL`` is **derived on read** by the domain
    AtterbergLimits's ``@property``; it has no column here. Per Data
    Integrity Rules §1, derivable values are computed on read so the DB
    can never disagree with its own inputs after a row edit.

    DOV exposes both limits under ``parametergroep = "Onderkenning - proeven"``
    via separate observation rows; on persist we collapse the pair into a
    single AtterbergLimits row per sample.
    """

    __tablename__ = "atterberg_limits"
    __table_args__ = (Index("idx_atterberg_limits_sample_id", "sample_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV per-observation permkey of the LIQUID-LIMIT row (the canonical
    # half of the LL+PL pair) — used as the stable identity for dedup
    # on re-import. PL row's permkey isn't tracked because the Atterberg
    # ORM aggregates both into one row. See "Refresh-on-duplicate" in
    # CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Liquid limit (LL / w_L) and plastic limit (PL / w_P) in % water content
    # of dry mass. Range generously 0–1000 (extreme bentonites / quick clays
    # exceed 100). Both nullable: a sample may have only LL or only PL.
    liquid_limit_pct: Mapped[float | None] = mapped_column(Double, nullable=True)
    plastic_limit_pct: Mapped[float | None] = mapped_column(Double, nullable=True)

    # Tri-state: True = soil cannot be rolled into a 3 mm thread, False =
    # explicitly plastic, NULL = not asserted by the source.
    non_plastic: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="atterberg_limits_tests", lazy=RELATIONSHIP_LAZY
    )
