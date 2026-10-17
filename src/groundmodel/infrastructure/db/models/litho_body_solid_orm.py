"""ORM model for LithoBodySolid — cached watertight solid per (model, body)."""

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


class LithoBodySolidOrm(Base):
    """Persisted LithoBodySolid — watertight triangulated solid for one body in one model.

    Derived artifact: the source of truth is the set of
    ``LithoLayerOrm`` rows whose ``body_id`` matches this body, plus
    the ``FormationContactOrm`` rows that frame them. This row is a
    CACHE so the 3-D viewer + DXF/Plaxis exporters can query "give me
    the solid for this body" without re-running the triangulation on
    every render.

    Recomputed by the ``BuildVoxelLithoModel`` use case, which is
    triggered explicitly (on-click build). The
    ``source_pick_checksum`` enables a short-circuit:
    if the pick-set hash matches the stored hash the solid is already
    current and the triangulation is skipped, mirroring exactly the
    ``RecomputeFormationSurface`` pattern.

    Schema design notes
    -------------------
    * ``method``: enum-like string. v1 only writes ``"tin"``
      (Delaunay-based watertight solid). Phase 5 may add alternative
      methods without a migration — plain VARCHAR, not a Postgres ENUM.
    * ``vertices`` / ``triangles`` stored as JSONB blobs for forward
      compatibility (extra per-vertex attributes, hole markers, …):

        - vertices: ``list[[x_m, y_m, z_m]]``       (project CRS + vertical datum)
        - triangles: ``list[[i, j, k]]``             (indices into vertices,
          outward-facing normal by right-hand rule)

    * ``source_pick_count`` + ``source_pick_checksum``: cheap cache-
      validity tag.  The recompute hook compares against the current
      pick set; mismatch → refresh.  Avoids unnecessary triangulation
      when a mutation doesn't actually change this body's geometry.
    * ``UNIQUE(model_id, body_id)`` — exactly one cached solid per
      (model, body) pair.  Recompute upserts via the unique key.
    * ``body_id`` is NOT a foreign key: geology-split halves receive
      synthesized ``uuid5(parent_body_id, band)`` ids that have no row
      in the ``body`` table. ``model_id`` and ``formation_id`` still
      cascade-delete their cached solids when the parent is removed.
    * ``is_stale``: True when a contact mutation has invalidated the
      cached solid.  The 3-D viewer renders stale solids at lower
      opacity; only ``POST /solids/rebuild`` clears it.
    * ``is_flagged``: True when the builder detected a structural
      anomaly (e.g. open boundary, non-manifold edge) that produced a
      best-effort rather than watertight solid.  Displayed as an amber
      warning badge in the UI without blocking save/export.
    * CASCADE on model_id and formation_id FKs — a deleted model or
      formation evaporates its cached solid automatically.
    """

    __tablename__ = "litho_body_solid"
    __table_args__ = (
        UniqueConstraint("model_id", "body_id", name="uq_litho_body_solid_model_body"),
        Index("idx_litho_body_solid_model", "model_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # CASCADE on model_id and formation_id — a deleted model or formation
    # evaporates its cached solid. body_id is intentionally NOT an FK (see below).
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )
    # NOT an FK: the litho-3D build may store geology-split bodies under
    # synthesized uuid5(parent_body_id, band) ids that are NOT rows in
    # the `body` table (build-only 3D cache; the geological/body model is untouched).
    # The (model_id, body_id) unique constraint + idx_litho_body_solid_model stay.
    body_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Method that produced the solid. v1 only writes "tin"; Phase 5
    # may add alternative interpolation methods without a migration.
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="tin")

    # Geometry payload. JSONB blobs for forward compatibility.
    # vertices: list[[x_m, y_m, z_m]]
    # triangles: list[[i, j, k]] — vertex indices, outward-facing normal
    vertices: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    triangles: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)

    # Cache-validity tag. ``source_pick_count`` is a cheap pre-check;
    # ``source_pick_checksum`` is a stable hash over the pick set
    # (body member layer ids + their depth extents) so a no-op edit
    # doesn't trigger an unnecessary retriangulation.
    source_pick_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_pick_checksum: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # On-click build pivot: pick mutations flip this to True (cheap
    # one-row UPDATE, no triangulation); only ``POST /solids/rebuild``
    # clears it back to False after a successful recompute. The 3-D
    # viewer renders stale solids at lower opacity.
    is_stale: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
        default=False,
    )

    # Builder anomaly flag: True when the triangulation produced a
    # best-effort solid (open boundary, non-manifold edge, etc.).
    # Does NOT block save or export — amber badge in the UI only.
    is_flagged: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
        default=False,
    )

    #: The build that produced this mesh — see ``LithoBuildGenerationOrm`` for
    #: the payload, settings and derived-identity map behind it. Nullable so rows
    #: written before build generations existed remain readable; a build always
    #: stamps it.
    generation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("litho_build_generation.id", ondelete="SET NULL"),
        nullable=True,
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
