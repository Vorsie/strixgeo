"""ORM model for CPT raw depth-series arrays."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class CptSeriesOrm(Base):
    """Raw CPT depth series — one row per CPT, columns stored as PostgreSQL arrays."""

    __tablename__ = "cpt_series"

    cpt_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cpt.id", ondelete="CASCADE"),
        primary_key=True,
    )

    depths_m: Mapped[list[float]] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=False)
    qc_mpa: Mapped[list[float]] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=False)
    fs_mpa: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)
    u2_mpa: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)
    rf_pct: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)
    qt_mpa: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)

    # Provenance flags for the two derivable columns above. NULL means unknown
    # (legacy rows persisted before these columns existed). Values match
    # DerivedValueSource: "measured" = source-provided, "computed" = our parser
    # derived it from other columns. See domain/value_objects/derived_value_source.py.
    rf_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    qt_source: Mapped[str | None] = mapped_column(String(10), nullable=True)

    cpt: Mapped[CptOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "CptOrm", back_populates="series"
    )
