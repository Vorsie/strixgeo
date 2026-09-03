"""ORM model for DrillSegment — depth interval drilled with one specific technique."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class DrillSegmentOrm(Base):
    """Persisted DrillSegment — one interval of one drilling technique.

    A borehole's overall ``drill_method`` is the source-provided summary
    (e.g. "Meerdere technieken" = multiple techniques). The actual per-interval
    techniques live here, in source order along ``top_m``.
    """

    __tablename__ = "drill_segment"
    __table_args__ = (Index("idx_drill_segment_borehole_id", "borehole_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    borehole_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=False,
    )
    top_m: Mapped[float] = mapped_column(Double, nullable=False)
    base_m: Mapped[float] = mapped_column(Double, nullable=False)
    method: Mapped[str] = mapped_column(String(100), nullable=False)

    borehole: Mapped[BoreholeOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BoreholeOrm", back_populates="drill_segments", lazy=RELATIONSHIP_LAZY
    )
