"""ORM model for CPT raw depth-series arrays."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, String, event
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY
from groundmodel.shared.logging.logger_factory import LoggerFactory


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


def compact_void_qc_rows(series: CptSeriesOrm) -> int:
    """Drop every row of ``series`` whose cone resistance is null, in place.

    Builds 0.1.0 to 0.1.2 persisted a GEF row whose qc was the file's void
    marker as a null element of ``qc_mpa`` (issue #55). The GEF parser no
    longer emits such a row (it drops it at parse time, as the DOV parser
    always did), and every reader of the series takes qc as a number — so a
    series stored by an earlier build is brought to the same shape the moment
    it loads. Only the parallel channels the source measured are compacted;
    an absent channel stays ``None``.

    Parameters
    ----------
    series : CptSeriesOrm
        The loaded series; its array attributes are reassigned when a row
        goes. SQLAlchemy sees the reassignment as a change, so a session that
        later commits writes the compacted arrays back — the one-time repair
        happens on the first commit after the first read.

    Returns
    -------
    int
        How many rows were dropped; 0 when every row carried a qc.
    """
    qc = series.qc_mpa
    if None not in qc:
        return 0
    keep = [i for i, value in enumerate(qc) if value is not None]
    dropped = len(qc) - len(keep)
    series.depths_m = [series.depths_m[i] for i in keep]
    series.qc_mpa = [qc[i] for i in keep]
    for channel in ("fs_mpa", "u2_mpa", "rf_pct", "q_total_mpa"):
        values = getattr(series, channel)
        if values is not None:
            setattr(series, channel, [values[i] for i in keep])
    LoggerFactory.get_logger(__name__).warning(
        f"CPT {series.cpt_id}: {dropped} of {len(qc)} series row(s) carried no cone "
        "resistance (stored by a build before the parser dropped them) — dropped on read"
    )
    return dropped


def _compact_void_qc_rows_on_load(target: CptSeriesOrm, *_: object) -> None:
    """ORM ``load`` / ``refresh`` hook: no reader ever sees a null qc.

    Parameters
    ----------
    target : CptSeriesOrm
        The instance SQLAlchemy just populated from the database.
    *_ : object
        The query context (and, on refresh, the attribute names) — unused.
    """
    compact_void_qc_rows(target)


event.listen(CptSeriesOrm, "load", _compact_void_qc_rows_on_load)
event.listen(CptSeriesOrm, "refresh", _compact_void_qc_rows_on_load)
