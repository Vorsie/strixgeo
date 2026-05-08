"""ORM model for ObservationLayer — one depth interval within a borehole observation."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Double, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class ObservationLayerOrm(Base):
    """Persisted ObservationLayer — one depth interval inside an Observation.

    Same row shape fits both lithology streams (color + main_soil_codes +
    admixtures) and stratigraphy streams (description). Lithology layers
    typically leave ``description`` empty; stratigraphy layers typically leave
    the lithology fields empty. Both shapes co-exist on the same borehole
    when its source ships multiple interpretation streams.

    ``main_soil_codes`` is a Postgres ARRAY because DOV's ``<hoofdnaam>`` can
    repeat — a single layer with two equally-dominant main soils (e.g.
    ``["XZ", "KL"]``). Order is preserved.

    ``layer_index`` is the zero-based source order. Loaded via the parent
    Observation's ``order_by="ObservationLayerOrm.layer_index"``, so consumers
    receive layers depth-ordered.

    ``admixtures`` is a relationship to a separate table rather than JSONB
    because we want to query by admixture (e.g. "find layers with glauconite").
    """

    __tablename__ = "observation_layer"
    __table_args__ = (Index("idx_observation_layer_observation_id", "observation_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    observation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("observation.id", ondelete="CASCADE"),
        nullable=False,
    )
    top_m: Mapped[float] = mapped_column(Double, nullable=False)
    base_m: Mapped[float] = mapped_column(Double, nullable=False)

    # Optional source-vocabulary colour string (e.g. "groenbruin"). NULL for
    # stratigraphy layers and for lithology layers where DOV omitted colour.
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # ARRAY of source-vocabulary soil-type codes (DOV examples: FZ = fijn zand,
    # KL = klei, GL = glauconiet). Empty array for stratigraphy layers; one or
    # more elements for lithology layers (DOV's <hoofdnaam> can repeat for
    # equally-dominant types). Default is an empty array, never NULL — keeps
    # the "main_soil_codes is iterable" invariant on the consumer side.
    main_soil_codes: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), nullable=False, default=list
    )

    # Free-text or formation-code description used by stratigraphy streams
    # (e.g. "HyEg - Lid van Egem (Formatie van Hyon)"). NULL for pure
    # lithology layers.
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Zero-based position of this layer within its parent observation.
    layer_index: Mapped[int] = mapped_column(Integer, nullable=False)

    observation: Mapped[ObservationOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ObservationOrm", back_populates="layers"
    )
    admixtures: Mapped[list[AdmixtureOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "AdmixtureOrm",
        back_populates="layer",
        cascade="all, delete-orphan",
        order_by="AdmixtureOrm.id",
    )
