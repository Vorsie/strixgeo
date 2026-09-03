"""ORM model for CPT raw depth-series arrays."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


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

    # CPTM totaalweerstand: combined tip + sleeve force a Begemann/CPTM cone
    # reads in one go. Genuinely source-measured — the mechanical apparatus
    # cannot separate tip from sleeve, so q_total is what the cone reports.
    # Populated for CPTM only.
    #
    # CPTU corrected cone resistance qt = qc + u2(1-a) is NOT stored. Even
    # when source files provide it (GEF qty 15, DOV's <Qt> for piezocones),
    # the value is the cone software performing the same arithmetic we'd
    # perform from qc + u2 + cone_area_ratio. Per CLAUDE.md "Data Integrity
    # Rules" §1, derivable values are computed on read in the API layer
    # (see calculate_qt_series in domain/services/cpt_corrections.py and
    # the /cpt/{id}/plot endpoint).
    q_total_mpa: Mapped[list[float] | None] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=True)

    # Provenance flag for rf_pct. NULL means unknown (legacy rows persisted
    # before this column existed). Values match DerivedValueSource:
    # "measured" = source-provided (qty 4 in GEF), "computed" = derived by our
    # parser from qc and fs. See domain/value_objects/derived_value_source.py.
    rf_source: Mapped[str | None] = mapped_column(String(10), nullable=True)

    cpt: Mapped[CptOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "CptOrm", back_populates="series", lazy=RELATIONSHIP_LAZY
    )
