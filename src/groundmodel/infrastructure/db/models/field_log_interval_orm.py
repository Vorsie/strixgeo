"""ORM model for FieldLogInterval — driller's per-interval observation during drilling."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class FieldLogIntervalOrm(Base):
    """Persisted FieldLogInterval — one depth interval of one field-recorded property.

    Stores the driller's direct observations (color, moisture, consistency)
    keyed by depth interval. ``kind`` is the source-vocabulary discriminator
    matching the ``FieldLogKind`` enum values (``"color"`` / ``"moisture"`` /
    ``"consistency"``). ``value`` is the raw source-vocabulary string and is
    NEVER translated at ingest — translation is a presentation concern (see
    CLAUDE.md "Data Integrity Rules"; ``reference_dov_codelists`` memory).
    """

    __tablename__ = "field_log_interval"
    __table_args__ = (
        Index("idx_field_log_interval_borehole_id", "borehole_id"),
        Index("idx_field_log_interval_kind", "kind"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    borehole_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=False,
    )
    top_m: Mapped[float] = mapped_column(Double, nullable=False)
    base_m: Mapped[float] = mapped_column(Double, nullable=False)

    # Which property of the soil this interval describes. One of the
    # FieldLogKind enum string values: "color", "moisture", or "consistency".
    # Stored as a plain VARCHAR rather than a Postgres ENUM so adding a new
    # kind (e.g. "drilling_diameter") doesn't require an ENUM-evolution
    # migration; the FieldLogKind enum at the application layer is the
    # authoritative allow-list.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)

    # The property's value in the source vocabulary, e.g. "groenbruin" for
    # color, "vochtig" for moisture, "plastisch" for consistency. DOV ships
    # Dutch terms; we store them raw and translate at the API/UI boundary
    # (see CLAUDE.md "Data Integrity Rules" and the reference_dov_codelists
    # memory).
    value: Mapped[str] = mapped_column(String(200), nullable=False)

    borehole: Mapped[BoreholeOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BoreholeOrm", back_populates="field_log_intervals", lazy=RELATIONSHIP_LAZY
    )
