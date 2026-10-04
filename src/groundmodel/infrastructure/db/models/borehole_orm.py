"""ORM model for Borehole — physical hole anchoring tests, observations, samples."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import Date, DateTime, Double, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class BoreholeOrm(Base):
    """Persisted Borehole — header metadata, location, denormalised summary.

    A borehole is *not* a test; it is a hole drilled into the ground. The
    things it carries (drill segments, field log intervals, observations, lab
    samples) live in their own tables linked by FK to ``borehole.id``.

    The schema mirrors the CPT pattern: raw source coordinates as separate
    floats with their own EPSG codes, plus a PostGIS geometry column in the
    source CRS for spatial queries. ``location`` is nullable because legacy /
    incomplete sources sometimes omit CRS metadata; the row is still stored
    and the parser flags the gap as a validation issue.

    Denormalised counts (``n_drill_segments``, etc.) are written atomically
    with the parent on each import. Per CLAUDE.md "Data Integrity Rules" §4,
    they are query-perf optimisations, not authoritative.
    """

    __tablename__ = "borehole"
    __table_args__ = (
        Index("idx_borehole_location", "location", postgresql_using="gist"),
        Index("idx_borehole_app_project_id", "app_project_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # App-level project scoping (separate from any source-file project reference)
    app_project_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)

    # Source identifiers for dedup. project_id="DOV" + test_id=<boornummer> is
    # the DOV pattern; future GEF/AGS imports populate them from their own headers.
    project_id: Mapped[str] = mapped_column(String(200), default="")
    test_id: Mapped[str] = mapped_column(String(200), default="")

    # Raw source coordinates (native CRS as parsed)
    location_x: Mapped[float] = mapped_column(Double, nullable=False)
    location_y: Mapped[float] = mapped_column(Double, nullable=False)
    elevation_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    z_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Where ``elevation_m`` came from — see ``ElevationSource``. Mirrors
    # the cpt column so refresh-on-duplicate on either side respects
    # manual edits (debt #8).
    elevation_source: Mapped[str] = mapped_column(
        String(8), nullable=False, default=ElevationSource.NONE.value
    )
    # Rollback snapshot (debt #21): upstream (DOV/GEF) elevation triple
    # captured on the FIRST manual override so clearing a manual edit
    # restores the surveyed Z instead of nulling. NULL = no snapshot.
    # Shared logic in ``domain.services.elevation_rollback``.
    original_elevation_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    original_z_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_elevation_source: Mapped[str | None] = mapped_column(String(8), nullable=True)

    # PostGIS geometry in the source CRS (same SRID as epsg column).
    # spatial_index=False — the migration creates idx_borehole_location explicitly via USING GIST
    location: Mapped[WKBElement | None] = mapped_column(
        Geometry("POINT", spatial_index=False), nullable=True
    )

    # Borehole metadata — all DOV-source-vocabulary strings, never translated at ingest.
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    drill_method: Mapped[str | None] = mapped_column(String(200), nullable=True)
    borehole_type: Mapped[str | None] = mapped_column(String(200), nullable=True)
    purpose: Mapped[str | None] = mapped_column(String(200), nullable=True)
    municipality: Mapped[str | None] = mapped_column(String(200), nullable=True)
    executor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    total_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    water_table_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)

    # Denormalised summary — lets list/spatial queries skip joining the child
    # tables. Per Data Integrity Rules §4, these are atomic with the parent
    # write and never the source of truth.
    n_drill_segments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    n_field_log_intervals: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # The DOV permkeys of the interpretation tracks the user DELETED from this
    # borehole (owner dogfeed 2026-10-01: "a deleted DOV track comes back on a
    # DOV bbox re-import"). A re-import keeps refreshing a held borehole with
    # interpretations DOV published since, so a permkey missing from the
    # borehole is not proof that it is new: this list is. An array on the row
    # (not a table): it rides the ``.strix`` bundle through the generic column
    # serialiser with no format bump, and dies with the borehole. Additive -
    # empty for every row written before migration c8d9e0f1a2b4.
    deleted_dov_permkeys: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, default=list, server_default=text("'{}'")
    )

    # ``created_at`` and ``updated_at`` are timestamps — they record WHEN the
    # row was inserted or last changed, NOT what changed. We deliberately do
    # not maintain a version history at this layer. A real audit trail would
    # need a separate ``borehole_history`` table populated by trigger or by
    # the application on every UPDATE (capturing the prior column values), or
    # a temporal-column pattern (``valid_from`` / ``valid_to`` + soft updates).
    # Either is a substantial design decision and CPT doesn't have one either —
    # add when there's a concrete driver (regulatory audit, dispute resolution,
    # multi-user undo) rather than speculatively.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    drill_segments: Mapped[list[DrillSegmentOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "DrillSegmentOrm",
        back_populates="borehole",
        cascade="all, delete-orphan",
        order_by="DrillSegmentOrm.top_m",
        lazy=RELATIONSHIP_LAZY,
    )
    field_log_intervals: Mapped[list[FieldLogIntervalOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "FieldLogIntervalOrm",
        back_populates="borehole",
        cascade="all, delete-orphan",
        order_by="FieldLogIntervalOrm.top_m",
        lazy=RELATIONSHIP_LAZY,
    )
    observations: Mapped[list[ObservationOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ObservationOrm",
        back_populates="borehole",
        cascade="all, delete-orphan",
        order_by="ObservationOrm.observation_date",
        lazy=RELATIONSHIP_LAZY,
    )
    samples: Mapped[list[SampleOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "SampleOrm",
        back_populates="borehole",
        cascade="all, delete-orphan",
        order_by="SampleOrm.depth_top_m",
        lazy=RELATIONSHIP_LAZY,
    )
