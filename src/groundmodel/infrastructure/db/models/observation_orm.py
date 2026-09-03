"""ORM model for Observation — one interpretation stream attached to a borehole."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class ObservationOrm(Base):
    """Persisted Observation — one interpretation stream attached to a borehole.

    A borehole can carry multiple observations of different types — e.g. an
    original "coded_lithology" recorded by the driller plus a later
    "geotechnical_coding" by an engineer. Each is a separate row here, with
    its own author, date, and quality metadata, and aggregates its layers via
    the ``layers`` relationship.

    ``observation_type`` is stored as VARCHAR rather than a Postgres ENUM so
    adding a new type doesn't require an ENUM-evolution migration. The
    ``ObservationType`` enum at the application layer is the authoritative
    allow-list (eight values: coded_lithology, geotechnical_coding,
    lithological_description, informal_stratigraphy, formal_stratigraphy,
    quaternary_stratigraphy, hydrogeological_stratigraphy,
    informal_hydrogeological_stratigraphy).

    Indexed on ``borehole_id`` (FK lookup) and ``observation_type`` (filter
    by stream type, e.g. "show only formal_stratigraphy across the project").
    """

    __tablename__ = "observation"
    __table_args__ = (
        Index("idx_observation_borehole_id", "borehole_id"),
        Index("idx_observation_type", "observation_type"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    borehole_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV permkey of the source interpretatie — stable upstream identity
    # used by ImportBoreholeDov to dedupe on re-import (refresh existing
    # boreholes' interpretations without re-creating already-stored
    # rows). Nullable so legacy rows pre-dating this column don't break.
    # See "Refresh-on-duplicate" in CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # ObservationType enum string value — see class docstring for the allow-list.
    observation_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Source-vocabulary metadata, all nullable because DOV interpretations
    # vary in completeness. ``author`` combines person + organisation as DOV
    # ships them in one field; reliability / score_category / drill_method_score
    # are categorical strings ("goed", "matig", "Hoog", ...). Translation to
    # English is a presentation concern.
    author: Mapped[str | None] = mapped_column(String(300), nullable=True)
    observation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reliability: Mapped[str | None] = mapped_column(String(50), nullable=True)
    score_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    drill_method_score: Mapped[str | None] = mapped_column(String(50), nullable=True)

    borehole: Mapped[BoreholeOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BoreholeOrm", back_populates="observations", lazy=RELATIONSHIP_LAZY
    )
    layers: Mapped[list[ObservationLayerOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ObservationLayerOrm",
        back_populates="observation",
        cascade="all, delete-orphan",
        order_by="ObservationLayerOrm.layer_index",
        lazy=RELATIONSHIP_LAZY,
    )
