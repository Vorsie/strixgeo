"""ORM model for FormationSurface — cached interpolated surface per formation."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class FormationSurfaceOrm(Base):
    """Persisted FormationSurface — interpolated top of one formation in one model.

    Derived artifact: the source of truth is the FormationContact rows
    on the parent model. This row is a CACHE so the section editor +
    exporters can query "give me a polyline along this section line"
    without re-running Delaunay on every render.

    Recomputed in the same transaction as any contact mutation that
    touches this (model, formation) pair. Bundle round-trip
    (.strix file <-> DB) carries the cache so opening a file on a
    fresh DB doesn't pay the recompute cost up-front; the next
    contact edit refreshes it anyway.

    Schema design notes
    -------------------
    * ``method``: enum-like string. v1 = ``"tin"`` (Delaunay on
      contact (x, y, elevation_m) points). Phase 5 may add
      ``"kriging"`` / ``"rbf"`` / ``"gempy"`` without a migration.
    * ``vertices`` / ``triangles`` stored as JSONB blobs:
        - vertices: list[[x_m, y_m, elevation_m]]   (all in the project's
          horizontal CRS + the formation's vertical datum)
        - triangles: list[[i, j, k]]                (indices into vertices)
      JSONB lets us evolve the schema (add edge tags, hole markers,
      etc.) without an alter-table churn.
    * ``source_contact_count`` + ``source_contact_checksum``: cheap
      cache-validity tag. The recompute hook compares against the
      current contact set; mismatch ⇒ refresh. Avoids unnecessary
      Delaunay calls when a mutation didn't actually change THIS
      formation's contacts.
    * UNIQUE(model_id, formation_id) — exactly one cached surface
      per (model, formation) pair. Recompute upserts via the unique
      key.
    """

    __tablename__ = "formation_surface"
    __table_args__ = (
        UniqueConstraint("model_id", "formation_id", name="uq_formation_surface_model_formation"),
        Index("idx_formation_surface_model", "model_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # CASCADE on both parents — a deleted model / formation evaporates
    # its cached surface. The data has no meaning without the parent.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Method that produced the surface. v1 only writes "tin"; Phase 5
    # adds "kriging" / "rbf" / "gempy" as the surface schema is
    # method-agnostic. Stored as a short string (vs an enum type) so a
    # new method is one row's value, not a migration.
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="tin")

    # Geometry payload. JSONB blobs for forward compatibility (we may
    # add edge attributes, hole rings, etc. without an alter-table).
    # vertices: list[[x_m, y_m, elevation_m]]
    # triangles: list[[i_a, i_b, i_c]] — vertex indices, anticlockwise
    vertices: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    triangles: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)

    # Cache-validity tag. ``source_contact_count`` is a cheap pre-check;
    # ``source_contact_checksum`` is a stable hash over the contact ids
    # + their (x, y, depth) tuples so a no-op edit (e.g. a re-PATCH that
    # ends up at the same depth) doesn't trigger an unnecessary recompute.
    source_contact_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_contact_checksum: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # On-click build pivot: contact mutations flip this to True (cheap
    # one-row UPDATE, no Delaunay); only ``POST /surfaces/rebuild``
    # clears it back to False after a successful recompute. The
    # section view renders stale TINs at lower opacity + dashed so
    # the engineer can see "this was your last build, refresh to
    # update." Bundle restore independently recomputes from the
    # source_contact_checksum vs current contacts so a tampered
    # .strix can't silently claim freshness.
    is_stale: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
        default=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
