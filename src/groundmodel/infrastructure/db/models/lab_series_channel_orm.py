"""ORM model for LabSeriesChannel — one named reading series of a stage."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class LabSeriesChannelOrm(Base):
    """Persisted channel: one value per reading of its stage, as an array.

    Arrays, like ``cpt_series`` and ``grain_size``: access is always "the whole
    series of one stage", one fetch per specimen; no workload queries single
    readings across tests. One ROW per channel (not a fixed column each)
    because the channel set differs per test type (dV only drained, total
    stresses only CU, no effective stresses in UU) and because every channel
    carries its own ``provenance``, ``unit`` and ``source_label``.

    ``provenance`` (SeriesProvenance): ``measured`` — the machine's log;
    ``lab_derived`` — a column the lab software computed (stored
    pass-through, never shown or exported as a measurement); ``derived`` — a
    Strix computation, with ``formula`` and ``derivation_inputs`` recorded
    (Data Integrity §1), e.g. the oedometer vertical strain delta_h / h0.

    ``series_values`` may hold NULL elements: an unreadable cell stays
    missing, it is never invented. (Named ``series_values``, not ``values``:
    VALUES is an SQL keyword.)
    """

    __tablename__ = "lab_series_channel"
    __table_args__ = (
        UniqueConstraint("stage_id", "channel_key", name="uq_lab_series_channel_key"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    stage_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("lab_series_stage.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Canonical key ('settlement_mm', 'force_n', 'vertical_strain', ...).
    channel_key: Mapped[str] = mapped_column(Text, nullable=False)
    # The lab's column label verbatim ('Zetting', 'Verpl.'); for a derived
    # channel, the Strix name.
    source_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance: Mapped[str] = mapped_column(Text, nullable=False)
    series_values: Mapped[list[float | None]] = mapped_column(
        ARRAY(DOUBLE_PRECISION), nullable=False
    )
    # Derived channels only: how the values were made.
    formula: Mapped[str | None] = mapped_column(Text, nullable=True)
    derivation_inputs: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    stage: Mapped[LabSeriesStageOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LabSeriesStageOrm", back_populates="channels", lazy=RELATIONSHIP_LAZY
    )
