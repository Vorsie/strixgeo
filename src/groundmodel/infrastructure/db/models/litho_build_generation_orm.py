"""ORM model for LithoBuildGeneration — one row per 3-D litho build, with provenance.

A ``litho_body_solid`` row says WHAT was built. Nothing said HOW, or from what.
The build's inputs lived only in the frontend, its settings only in the project's
view-state at the moment it ran, and its derived body identity only in memory —
so no diagnostic could reproduce a build after the fact, and "why is this mesh
one body?" had no answer the database could give.

That is not a theoretical gap. Every real-data check in the 2026-07 voxel
campaign ran against a payload captured by hand into a throwaway file, and the
one time the owner's live build differed from that capture (14 sections vs 16)
the mismatch was invisible until it was looked for. A separate incident had a
successful build's meshes carrying the timestamp of an earlier build, because
nothing recorded when a generation actually happened.

This row is the build's audit trail:

* **Reproducibility** — the exact ``payload`` POSTed (the validated 2-D section
  partitions) plus its checksum, the grid geometry, and every setting that
  changes the output. A rebuild from a stored generation must produce the same
  meshes.
* **Identity provenance** — ``body_aliases`` maps each SOURCE body id to the
  derived component it was merged into (the cross-section merge, debt #244), so
  a reader can answer "which user-authored bodies make up this mesh?".
* **Derived, never authoritative.** These aliases are geometry-derived build
  data. They do NOT represent user intent and must never be read back as
  correlations — the user's ties remain exactly the user's ties.

``litho_body_solid.generation_id`` points here, so every persisted mesh names the
build that made it.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoBuildGenerationOrm(Base):
    """One 3-D litho build: its inputs, its settings, and its derived identity map."""

    __tablename__ = "litho_build_generation"
    __table_args__ = (Index("idx_litho_build_generation_model", "model_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    #: The lithostratigraphic model this build produced. Cascade-deletes with it.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    #: Identifies the builder that produced this generation, so a mesh built by
    #: an older builder is recognisable after the algorithm changes.
    builder_version: Mapped[str] = mapped_column(String(32), nullable=False)

    # --- settings that change the output -----------------------------------
    # Every one of these alters the labelling, so a generation is only
    # reproducible with all of them recorded.
    horizontal_spacing_m: Mapped[float] = mapped_column(Float, nullable=False)
    vertical_spacing_m: Mapped[float] = mapped_column(Float, nullable=False)
    honor_radius_m: Mapped[float] = mapped_column(Float, nullable=False)
    litho_snap_tolerance_m: Mapped[float] = mapped_column(Float, nullable=False)

    # --- grid geometry ------------------------------------------------------
    # The grid ORIGIN matters as much as the spacing: which cell an investigation
    # lands in depends on grid phase, and the phase moves when the footprint
    # changes. Two builds with identical spacing and different origins are not
    # the same build.
    grid_nx: Mapped[int] = mapped_column(Integer, nullable=False)
    grid_ny: Mapped[int] = mapped_column(Integer, nullable=False)
    grid_nz: Mapped[int] = mapped_column(Integer, nullable=False)
    grid_origin_x: Mapped[float] = mapped_column(Float, nullable=False)
    grid_origin_y: Mapped[float] = mapped_column(Float, nullable=False)
    grid_origin_z: Mapped[float] = mapped_column(Float, nullable=False)

    # --- inputs -------------------------------------------------------------
    #: The section-partition payload exactly AS RECEIVED — before the
    #: cross-section alias map and before columns are re-seated onto their true
    #: map positions. Both of those are re-derivable from it; the projected-foot
    #: column positions it carries are NOT recoverable afterwards, and the
    #: footprint hull needs them (it unions the columns as-drawn with the true
    #: positions, so it can only grow). Storing the re-seated payload instead
    #: made a reproduction come back 21 grid cells narrower in Y.
    #: Large (hundreds of kB); PostgreSQL TOASTs it out of line.
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    #: Digest over the payload + settings — the same value stamped on every
    #: solid row as ``source_pick_checksum``, so a mesh can be matched to the
    #: generation that produced it even if ``generation_id`` is missing.
    payload_checksum: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    #: Digest of the parent geological model's band surfaces; a geo rebuild that
    #: moves a band changes the litho labelling without touching the payload.
    geo_surface_digest: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    # --- derived identity ---------------------------------------------------
    #: ``{source_body_id: derived_component_id}`` from the cross-section merge.
    #: DERIVED build data with provenance — never a user correlation. Ids that
    #: merged with nothing map to themselves.
    body_aliases: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)

    # --- outcome ------------------------------------------------------------
    sections_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bodies_built: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    triangles: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # --- seven-clause gapless gate -------------------------------------------
    #: The gate's report for THIS build (all seven clauses, always, in order —
    #: see ``groundmodel.application.gapless_build_report_assembler``).
    #: Nullable, NOT ``server_default='{}'``: an older generation genuinely has
    #: no report (the gate postdates it), and an empty dict would be
    #: indistinguishable from "the gate ran and found nothing" — a different,
    #: false, claim.
    gapless_report: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
