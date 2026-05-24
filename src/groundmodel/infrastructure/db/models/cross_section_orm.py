"""ORM model for CrossSection — a project-scoped slice for viewing / editing the model."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Double, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base

# String FK reference to litho_lens — avoids a circular import since
# litho_lens_orm also references cross_section via primary_section_id.
_LITHO_LENS_TABLE = "litho_lens"


class CrossSectionOrm(Base):
    """Persisted CrossSection — a 2D slice the user defines through a project.

    A section is a line on the map plus display preferences. The model
    editor (#34) projects nearby investigations onto the line and lets
    the user draw formation tops between them; the section is the
    edit / view surface, not the data primitive — see the modelling
    hierarchy in CLAUDE.md "Commercial Direction".

    Sections are **project-scoped** (not model-scoped). The same section
    can render any of the project's geological models — they live
    independently and combine at the render layer.

    The line endpoints stay as plain Doubles + EPSG (not a PostGIS
    LINESTRING) because v1 doesn't need spatial queries on sections,
    and the existing CPT / Borehole tables already use the same
    location_x / location_y / epsg pattern for their points. Keep the
    schema's point-shape vocabulary consistent across tables.

    The polylines the user draws ON a section (formation tops between
    investigations) live in their own ``formation_surface_on_section``
    table added by the editor task, not here.
    """

    __tablename__ = "cross_section"
    __table_args__ = (Index("idx_cross_section_app_project_id", "app_project_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Line endpoints in the section's CRS.
    start_x: Mapped[float] = mapped_column(Double, nullable=False)
    start_y: Mapped[float] = mapped_column(Double, nullable=False)
    end_x: Mapped[float] = mapped_column(Double, nullable=False)
    end_y: Mapped[float] = mapped_column(Double, nullable=False)
    epsg: Mapped[int] = mapped_column(Integer, nullable=False)

    # Lateral projection buffer in metres. Investigations within this
    # perpendicular distance from the line are eligible to appear on
    # the section. 50 m is a reasonable default for the API layer; the
    # column itself has no server default so each row stores exactly
    # what the caller chose.
    projection_buffer_m: Mapped[float] = mapped_column(Double, nullable=False)

    # Vertical scale for display. 1.0 = true scale; > 1.0 stretches the
    # depth axis. Saved per-section so a section reopens with the same
    # proportions when the .gmproj travels to a different machine.
    vertical_exaggeration: Mapped[float] = mapped_column(Double, nullable=False, default=1.0)

    # Explicit user-chosen exclusions. Empty arrays (the default) mean
    # "include every investigation within the buffer".
    excluded_borehole_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PG_UUID(as_uuid=True)), nullable=False, default=list
    )
    excluded_cpt_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PG_UUID(as_uuid=True)), nullable=False, default=list
    )

    # Explicit-content invariant (owner directive 2026-05-17).
    # A section shows formation contacts ONLY whose id appears in this
    # set.  Empty array (the default) means "nothing seeded — show
    # investigations only".  The set grows when the user clicks "Seed
    # from stratigraphy" or manually draws a contact on this section.
    # Model-level contacts that are NOT in this set are invisible on the
    # section even if they are in the corridor — see
    # BuildSectionSnapshot and CLAUDE.md "Cross-sections are the editing
    # surface…Seed from stratigraphy".
    seeded_formation_contact_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PG_UUID(as_uuid=True)), nullable=False, default=list
    )

    # Optional view-window depths. NULL means "auto-fit to the deepest
    # projected investigation on render".
    min_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)
    max_depth_m: Mapped[float | None] = mapped_column(Double, nullable=True)

    # Sidebar display order. Loose hint, tied breaks by name in the UI.
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Schema-less display-preference bag for per-section toggles —
    # CPT channel toggles (qc/Rf/fs/u2/qTotal), borehole interpretation
    # toggles, future scale locks. Bundle round-trips automatically
    # via the project_bundle snapshot machinery, so user preferences
    # persist across machines without per-toggle migrations. Nullable
    # so existing rows from before the column landed read as None;
    # frontend defaults apply via ``readCptChannels`` and similar.
    view_state: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True, default=None)

    # Lens companion linkage (Slice 4 of debt #101).
    # When set, this section was auto-created as the perpendicular companion
    # for the referenced lens.  FK is ON DELETE SET NULL so deleting a lens
    # reverts the section to a plain user section rather than cascading the
    # delete.
    companion_lens_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(f"{_LITHO_LENS_TABLE}.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Stays True even after companion_lens_id is nulled by a lens deletion.
    # The UI uses this flag to show a "was a lens companion" badge without a
    # separate query.  Defaults False so all existing sections are unaffected.
    is_lens_companion: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
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
