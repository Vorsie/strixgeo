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

    # qt_mpa stores ONLY the CPTU corrected cone resistance (qt = qc + u2(1-a)),
    # populated for piezocones. CPTM mechanical totaalweerstand lives in the
    # separate q_total_mpa column — they are physically different quantities
    # despite the historic shared "qt" symbol.
    qt_mpa: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)

    # CPTM totaalweerstand: combined tip + sleeve force a Begemann/CPTM cone
    # reads in one go. Always source-measured. Mutually exclusive with qt_mpa
    # in practice (CPTM populates this, CPTU populates qt_mpa).
    q_total_mpa: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)

    # Provenance flag for rf_pct. NULL means unknown (legacy rows persisted
    # before this column existed). Values match DerivedValueSource:
    # "measured" = source-provided (qty 4 in GEF), "computed" = derived by our
    # parser from qc and fs. See domain/value_objects/derived_value_source.py.
    # qt_mpa and q_total_mpa carry no source flag because both are always
    # source-provided in our pipeline today; if a future _calculate_qt path is
    # added for CPTU, qt_source can be reintroduced symmetrically.
    rf_source: Mapped[str | None] = mapped_column(String(10), nullable=True)

    cpt: Mapped[CptOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "CptOrm", back_populates="series"
    )
