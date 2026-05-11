"""ORM model for Project — first-class app-level container for CPTs, boreholes, and lab data."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ARRAY, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class ProjectOrm(Base):
    """Persisted Project — the app-level container that scopes every CPT and borehole.

    Every ``CptOrm`` / ``BoreholeOrm`` row already carries ``app_project_id``;
    until this table existed those UUIDs lived only in the desktop client's
    localStorage. Promoting Project to a first-class table lets the platform:

    * list, rename, and archive projects from a real source of truth
    * carry richer metadata (client, site, tags, default CRSes, phase, status)
      that the desktop file format then mirrors
    * support Save-As as a duplicate-with-children operation rather than just
      a file copy

    Soft delete: ``archived_at`` is a nullable timestamp. ``NULL`` = active;
    set = archived (hidden from default listings, never destroyed). Matches the
    project's "remove from view, never DB delete" UX rule.

    Default CRSes (``default_horizontal_epsg`` / ``default_vertical_epsg``) are
    project-level conventions applied to manual entries so the user doesn't
    pick a CRS per row. ``NULL`` means "no project-level default — fall back to
    horizontal-EPSG-derived (vertical_crs.default_vertical_epsg)".
    """

    __tablename__ = "project"
    __table_args__ = (Index("idx_project_archived_at", "archived_at"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # Internal firm reference — 'GEO-2026-042' style. Optional but conventional
    # in engineering practice. Not unique: same number under different clients
    # is allowed; uniqueness, when needed, is a project-management policy.
    project_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    client: Mapped[str | None] = mapped_column(String(200), nullable=True)
    site_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Postgres TEXT[] — free-form labels, ordering preserved, duplicates allowed
    # (UI dedupes). Default empty array so application code never has to
    # null-check on read.
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")

    # Project-level CRS defaults. Applied to manual entries when the row's
    # own CRS is missing. NULL = no project default; callers fall back further.
    default_horizontal_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_vertical_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Lifecycle. ``phase`` and ``status`` are stored as plain strings (not
    # Postgres enums) so adding a new bucket is an application-side change,
    # never an ALTER TYPE migration. Allowed values are validated at the
    # Pydantic / domain layer:
    #   phase  : feasibility | design | construction | monitoring
    #   status : active | on_hold | completed
    phase: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")

    # Soft-delete marker. NULL = active project. Setting this hides the
    # project from default listings; the row + every child CPT/borehole is
    # preserved untouched.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # JSONB bag for project-level view toggles that aren't tied to a
    # specific investigation: DEM overlay enabled/opacity, hidden-by-type
    # sets in the map's layer-control, future project-level view prefs.
    # Each new toggle is a key in the dict — no migrations per toggle.
    # Schema discipline lives at the Pydantic layer; the column itself
    # accepts any JSON object. Default ``{}`` so callers can read keys
    # via .get(...) without null-checking the column.
    view_state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
