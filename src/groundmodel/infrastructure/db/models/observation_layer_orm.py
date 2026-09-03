"""ORM model for ObservationLayer — one depth interval within a borehole observation."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Double, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class ObservationLayerOrm(Base):
    """Persisted ObservationLayer — one depth interval inside an Observation.

    Single-table layout for two physically-different sub-shapes (intentional)
    -----------------------------------------------------------------------
    The same row holds two layer sub-shapes, discriminated by the parent
    Observation's ``observation_type``:

    * **Lithology** layers (``coded_lithology``, ``geotechnical_coding``,
      ``lithological_description``) populate ``color`` + ``main_soil_codes`` +
      ``admixtures`` and typically leave ``description`` NULL.
    * **Stratigraphy** layers (``formal_stratigraphy``, ``informal_stratigraphy``,
      ``quaternary_stratigraphy``, ``hydrogeological_stratigraphy``,
      ``informal_hydrogeological_stratigraphy``) populate ``description`` and
      typically leave the lithology fields empty.

    Within one observation, all layers are the same sub-shape; across
    different observations on the same borehole, sub-shapes co-exist. We
    deliberately keep both in one table rather than splitting into
    ``lithology_layer`` + ``stratigraphy_layer`` because: the unified domain
    ``ObservationLayer`` already mirrors this shape; a single relationship
    from Observation is simpler than two; "all layers in this observation"
    queries don't need a UNION; and DOV could add a ninth observation type
    tomorrow with yet another sub-shape, which a wide-and-flexible row
    absorbs more cleanly than a per-type table sprawl.

    Trade-off acknowledged: lithology rows carry a NULL ``description``
    column and stratigraphy rows carry an empty ``main_soil_codes`` array
    and zero admixtures. If query patterns later demand strict per-type
    schemas (e.g. severe NULL-column slowness, accidental cross-type field
    reads), splitting is a bounded refactor — both halves still hang off the
    same ``observation`` parent.

    Other layout decisions:

    * ``main_soil_codes`` is a Postgres ARRAY because DOV's ``<hoofdnaam>``
      can repeat for equally-dominant main soils (e.g. ``["XZ", "KL"]``);
      order is preserved.
    * ``layer_index`` is the zero-based source order; the parent's
      ``order_by="ObservationLayerOrm.layer_index"`` makes consumers receive
      layers depth-ordered.
    * ``admixtures`` is a relationship to a separate table rather than JSONB
      so the ``soil_code`` index can answer "find all layers with glauconite".
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
    # lithology layers. TEXT (uncapped) because DOV's geotechnical-coding
    # streams ship long human-written descriptions that blew past a
    # previous VARCHAR(500) cap on real-world data.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Zero-based position of this layer within its parent observation.
    layer_index: Mapped[int] = mapped_column(Integer, nullable=False)

    observation: Mapped[ObservationOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ObservationOrm", back_populates="layers", lazy=RELATIONSHIP_LAZY
    )
    admixtures: Mapped[list[AdmixtureOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "AdmixtureOrm",
        back_populates="layer",
        cascade="all, delete-orphan",
        order_by="AdmixtureOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
