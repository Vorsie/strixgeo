"""ORM model for Admixture — secondary soil component within an ObservationLayer."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class AdmixtureOrm(Base):
    """Persisted Admixture — secondary soil component within an ObservationLayer.

    The domain ``Admixture`` is a frozen value object with no identity; the
    DB needs a primary key, so each row gets a synthetic ``id``. The id is
    stable across reads — order is preserved via uuid7's time-ordering — but
    callers should treat the value object semantics: identity is structural
    (soil_code + amount + locally), not by id.

    Indexed on ``observation_layer_id`` for FK lookup and on ``soil_code`` so
    queries like "find all layers with glauconite" can use the index instead
    of a sequential scan over the cross-borehole admixture set.
    """

    __tablename__ = "admixture"
    __table_args__ = (
        Index("idx_admixture_observation_layer_id", "observation_layer_id"),
        Index("idx_admixture_soil_code", "soil_code"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    observation_layer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("observation_layer.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source-vocabulary code for the admixture soil type (DOV: GL = glauconiet,
    # KL = klei, KA = kalk, etc.). Stored raw, translated at presentation.
    soil_code: Mapped[str] = mapped_column(String(20), nullable=False)

    # Source-vocabulary amount qualifier (DOV: Z = weak, M = medium, S = strong,
    # V = much). Empty string when DOV omitted the qualifier.
    amount: Mapped[str] = mapped_column(String(10), nullable=False, default="")

    # True when the admixture is only locally present within the parent
    # interval (DOV's <plaatselijk>true</plaatselijk>); False when it occurs
    # throughout. Defaults to False because absence of the tag in DOV means
    # "throughout".
    locally: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    layer: Mapped[ObservationLayerOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ObservationLayerOrm", back_populates="admixtures", lazy=RELATIONSHIP_LAZY
    )
