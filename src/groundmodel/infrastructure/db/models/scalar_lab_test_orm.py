"""ORM model for ScalarLabTest — generic catch-all for scalar lab tests."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class ScalarLabTestOrm(Base):
    """Persisted ScalarLabTest — a single (parameter, value, unit) tuple.

    Catch-all family for DOV scalar lab tests we don't model with a
    typed table. Today this stores grain density, ASTM classification,
    and descriptive calcareous content; new parameters land here as a
    config addition (extra parameter strings in
    ``DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS``) without a migration.

    ``value_numeric`` and ``value_text`` are mutually-preferred storage:
    numeric source values land in ``value_numeric``; non-numeric (most
    importantly ASTM classification codes like ``"CL"`` / ``"SP"``) in
    ``value_text``. Both ``None`` only when ``detection_condition``
    flags the row as not-measurable (DOV ``NM``).
    """

    __tablename__ = "scalar_lab_test"
    __table_args__ = (Index("idx_scalar_lab_test_sample_id", "sample_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV per-observation permkey — stable upstream identity for dedup
    # on re-import. See "Refresh-on-duplicate" in CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Source vocabulary — pass-through, never translated at ingest. ALL
    # free-text columns on the catch-all are TEXT (uncapped): the
    # family is meant to swallow whatever DOV ships, and capping had
    # us play whack-a-mole with truncation outages 3× in a row before
    # we got the policy right. The detection_condition column stays
    # capped because it's a small enum-ish set ("NM", "<").
    parameter_group: Mapped[str] = mapped_column(Text, nullable=False)
    parameter: Mapped[str] = mapped_column(Text, nullable=False)

    value_numeric: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    method: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    detection_condition: Mapped[str | None] = mapped_column(String(8), nullable=True)

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="scalar_lab_tests", lazy=RELATIONSHIP_LAZY
    )
