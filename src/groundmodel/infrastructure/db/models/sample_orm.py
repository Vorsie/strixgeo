"""ORM model for Sample — material taken from a borehole at a depth interval."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Double, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class SampleOrm(Base):
    """Persisted Sample — material taken from a borehole at a depth interval.

    A Sample is the link between a borehole and the lab tests performed on
    its material. Phase A3 adds the lab-test tables (``grain_size``,
    ``atterberg_limits``, ``caco3_content``, ``organic_content``,
    ``water_content``) — each one FKs to ``sample.id`` and SampleOrm
    gets a reverse relationship per test type so loading a sample with all
    its tests is one selectinload per type, no joins.

    Discovery pattern, intentional:

    * Lab test → sample is a hard FK (test belongs to its sample).
    * Sample → lab tests is reverse-only — there is no "tests_performed"
      list column denormalised onto Sample. Storing such a list would
      duplicate information already present in the lab tables and would
      drift when tests are added or removed (Data Integrity Rules §4).
    * Inheritance is NOT used (sample is not a test); the relationship is
      purely compositional.

    ``depth_top_m`` and ``depth_base_m`` accept equal values: DOV uses spot
    samples (top == base) for non-depth-resolved samples and we store them
    faithfully rather than fabricating a synthetic interval.

    All metadata fields are source-vocabulary strings, never translated at
    ingest. ``sample_number`` is the source's own identifier (DOV ``monster``
    is often a small integer like "0" or "19"); ``sample_type``,
    ``composition``, and ``instrument`` carry DOV's Dutch terms.
    """

    __tablename__ = "sample"
    __table_args__ = (
        Index("idx_sample_borehole_id", "borehole_id"),
        # Index on geotech_body_id supports joins from the geotech inspector
        # that wants all samples in a body group without a full table scan.
        Index("idx_sample_geotech_body_id", "geotech_body_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    borehole_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV permkey_monster — stable upstream identity used by
    # ImportBoreholeDov to dedupe samples on re-import. See
    # "Refresh-on-duplicate" in CLAUDE.md. Nullable for legacy rows.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    depth_top_m: Mapped[float] = mapped_column(Double, nullable=False)
    depth_base_m: Mapped[float] = mapped_column(Double, nullable=False)
    # TEXT (uncapped) because DOV samples occasionally ship long
    # free-text descriptions; a previous VARCHAR(500) cap blew up on
    # real-world data.
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sample_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sample_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    composition: Mapped[str | None] = mapped_column(String(50), nullable=True)
    instrument: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sampling_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Geotech assignment — written by DivideBoreholes (Task 4).
    # Stores the GEOTECH packing body_id — the resolver-connected component of
    # same-(litho-body, nad_class) CPT packing bands (i.e. the body_id stamped
    # on CPT LithoLayerOrm rows in the geotech model by ResolveLithoInstances
    # during SubdivideAllBodies).  Each borehole fill band gets the body_id of
    # the nearest CPT with the same nad_class in the same litho-body group.
    # None when the band was filled by a conservative fallback (body_min /
    # absolute_min) and no same-class CPT exists in the group.
    #
    # FK to ``body.id`` with ON DELETE SET NULL, mirroring ``litho_layer.body_id``
    # (the same body_id space — BodyOrm rows exist for every resolver component,
    # which is why litho_layer already FK's it). Before this FK the column was a
    # bare UUID, so a body deleted by ``DeleteBody`` or the resolver's orphan
    # sweep left a DANGLING id on every sample it grouped (production-readiness
    # audit L5). SET NULL (not CASCADE) so the sample survives a body
    # reconciliation that drops its group — the material is still there, only its
    # grouping label is gone.
    geotech_body_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body.id", ondelete="SET NULL"),
        nullable=True,
    )
    geotech_nad_class: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Provenance tier: "cpt_interpolated" | "body_min" | "absolute_min" | "unresolved"
    geotech_assignment_source: Mapped[str | None] = mapped_column(String(50), nullable=True)

    borehole: Mapped[BoreholeOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BoreholeOrm", back_populates="samples", lazy=RELATIONSHIP_LAZY
    )

    # Reverse relationships per lab-test type. Loading a sample with all of
    # its tests is one selectinload per type (no joins, no Cartesian
    # explosion). Most samples carry one of each type at most; the
    # order_by="<Class>.id" preserves uuid7 insertion order for the rare
    # case where the same test is run twice.
    grain_sizes: Mapped[list[GrainSizeOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GrainSizeOrm",
        back_populates="sample",
        cascade="all, delete-orphan",
        order_by="GrainSizeOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
    atterberg_limits_tests: Mapped[list[AtterbergLimitsOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "AtterbergLimitsOrm",
        back_populates="sample",
        cascade="all, delete-orphan",
        order_by="AtterbergLimitsOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
    caco3_content_tests: Mapped[list[CaCO3ContentOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "CaCO3ContentOrm",
        back_populates="sample",
        cascade="all, delete-orphan",
        order_by="CaCO3ContentOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
    organic_content_tests: Mapped[list[OrganicContentOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "OrganicContentOrm",
        back_populates="sample",
        cascade="all, delete-orphan",
        order_by="OrganicContentOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
    water_content_tests: Mapped[list[WaterContentOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "WaterContentOrm",
        back_populates="sample",
        cascade="all, delete-orphan",
        order_by="WaterContentOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
    # Catch-all family for scalar tests outside the 5 typed families above
    # (grain density, ASTM classification, descriptive calcareous content,
    # plus any future scalar parameters DOV adds — see
    # DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS in lab/dov/dov_constants.py).
    scalar_lab_tests: Mapped[list[ScalarLabTestOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ScalarLabTestOrm",
        back_populates="sample",
        cascade="all, delete-orphan",
        order_by="ScalarLabTestOrm.id",
        lazy=RELATIONSHIP_LAZY,
    )
