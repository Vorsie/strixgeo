"""ORM model for GrainSize — sieve / hydrometer / laser-diffraction lab test."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Boolean, Date, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class GrainSizeOrm(Base):
    """Persisted GrainSize — cumulative grain-size curve for a sample.

    Stores the curve as two parallel Postgres ARRAYs of DOUBLE_PRECISION,
    mirroring the CPT series-array pattern: one row per test, two arrays per
    row, one network round-trip to fetch the whole curve. Per Data Integrity
    Rules §4, no row-per-sieve-point normalisation — the consumer needs the
    full curve atomically anyway.

    The arrays are method-agnostic: sieve-test diameters, hydrometer Stokes-
    derived particle diameters, and laser-diffraction bin centres all land in
    the same shape. ``method`` carries the raw source-vocabulary string
    (DOV: "Zeving", "Hydrometer", "D.m.v. Laserdiffractie", "Pipette",
    "Sedigraaf"); translation is a presentation concern.

    ``lime_removed`` and ``organics_removed`` are PRE-TREATMENT booleans
    indicating whether those substances were chemically stripped BEFORE the
    test, NOT measurements of CaCO3 / organic content (those are separate
    lab tests).

    Variable sieve sets across samples (intentional)
    -------------------------------------------------
    Each test may use a different set of sieve apertures: ISO mm, US
    standard, hydrometer time series, laser-diffraction logarithmic bins.
    Postgres ARRAY handles variable lengths per row natively, so per-sample
    queries (load curve, render chart, compute D-stats for one sample) are
    completely unaffected.

    Cross-sample aggregates ARE harder — "median % passing 0.063 mm across
    the project" can't be done in pure SQL because each row's index for
    0.063 differs (or 0.063 is absent and needs interpolation). That work
    belongs in a domain service that loads the curves and interpolates per-
    row, not in the storage shape — interpolating at ingest would store
    derived data and lose source fidelity (Data Integrity Rules §1).

    Escape hatch when cross-sample queries become a real workload:
    denormalise the standard D-stats (D10, D30, D50, D60, D85, in mm) as
    additional columns computed at write time. Atomic with the parent
    write, recomputable from the curve, indexable for fast filtering — the
    canonical Data Integrity Rules §4 use case. Add when a concrete query
    pattern motivates it, not speculatively.
    """

    __tablename__ = "grain_size"
    __table_args__ = (Index("idx_grain_size_sample_id", "sample_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    sample_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sample.id", ondelete="CASCADE"),
        nullable=False,
    )

    # DOV per-observation permkey — stable upstream identity for dedup
    # on re-import. See "Refresh-on-duplicate" in CLAUDE.md.
    dov_permkey: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Particle diameters in millimetres, strictly ascending. Sieve apertures
    # for sieve tests; instrument-reported diameters for hydrometer / laser.
    diameters_mm: Mapped[list[float]] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=False)
    # Cumulative %-oversize per row — DOV's "Fractie met grotere diameter"
    # (mass fraction with diameter LARGER than the corresponding sieve).
    # Same length as diameters_mm; 0–100 range.
    pct_larger: Mapped[list[float]] = mapped_column(ARRAY(DOUBLE_PRECISION), nullable=False)

    method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    lime_removed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    organics_removed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    sample: Mapped[SampleOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm", back_populates="grain_sizes", lazy=RELATIONSHIP_LAZY
    )
