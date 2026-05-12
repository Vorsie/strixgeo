"""CrossSection — a project-scoped view definition for the section panel.

A cross-section is a *view*, not a data primitive — it picks two
endpoints on the project, defines a perpendicular buffer for
projecting nearby investigations, and carries display preferences
(vertical exaggeration, depth window, view-state bag). Edits to
the geological model committed FROM the section view land on
``FormationContact``, not on the section row.

This is the domain-layer dataclass; ORM mapping lives in
``infrastructure/db/models/cross_section_orm.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass(frozen=True)
class CrossSection:
    """One cross-section view definition.

    Attributes
    ----------
    id : UUID
        Primary key.
    app_project_id : UUID
        Project this section belongs to.
    name : str
        Display label.
    description : str | None
        Free-text engineer note.
    start_x, start_y : float
        Section line start point (in the project's horizontal CRS).
    end_x, end_y : float
        Section line end point. Must not coincide with the start
        — enforced at API + DB layers.
    epsg : int
        Horizontal EPSG of the start/end coordinates. Usually
        matches the project's default.
    projection_buffer_m : float
        Perpendicular distance — investigations within this band
        of the line project onto the section as columns. Default
        50 m matches DOV's lengteprofiel convention.
    vertical_exaggeration : float
        VEX multiplier applied to the Y axis vs the X axis in the
        viewer. Default 1.0 (true-scale); engineers commonly bump
        to 2-5× for shallow sections.
    excluded_borehole_ids, excluded_cpt_ids : list[UUID]
        Per-section exclusion sets — investigations the engineer
        chose to hide on THIS section while keeping them in the
        project. Persists across re-opens.
    min_depth_m, max_depth_m : float | None
        Optional Y-window override. ``None`` = auto-fit.
    display_order : int
        Sidebar ordering hint.
    created_at, updated_at : datetime
        Audit timestamps.
    """

    id: UUID
    app_project_id: UUID
    name: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    epsg: int
    projection_buffer_m: float
    vertical_exaggeration: float = 1.0
    description: str | None = None
    excluded_borehole_ids: list[UUID] = field(default_factory=list)
    excluded_cpt_ids: list[UUID] = field(default_factory=list)
    min_depth_m: float | None = None
    max_depth_m: float | None = None
    display_order: int = 0
    view_state: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
