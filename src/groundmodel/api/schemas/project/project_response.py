"""Pydantic schema for a single Project response."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectResponse(BaseModel):
    """Full project metadata returned by every project endpoint.

    Used for both the list endpoint and the detail endpoint — projects are
    metadata-only (no heavy children), so list and detail return the same
    shape. Mirrors the columns on ``ProjectOrm`` 1:1; the desktop client
    serialises this directly into the ``.gmproj`` file.

    Lifecycle fields (``phase`` / ``status``) are validated at the
    request-schema layer, not here — a value already in the DB is treated
    as ground truth.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    project_number: str | None
    client: str | None
    site_label: str | None
    description: str | None
    tags: list[str]
    default_horizontal_epsg: int | None
    default_vertical_epsg: int | None
    phase: str | None
    status: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Project-level view toggles (DEM overlay, hidden-by-type sets, …).
    # Always a dict — the column default is ``{}`` so reads never see
    # null. Schema discipline for keys lives at the PATCH endpoint.
    view_state: dict[str, Any] = Field(default_factory=dict)
    # The two-stage home for the "Fill from boreholes" lumping map.
    # ``staged`` is written on Apply; ``saved`` is what the last
    # File → Save committed. Both are exposed on every project read so
    # the desktop can seed its two in-memory slots on open and keep
    # deriving dirty from the pair. ``None`` means "no lumping map",
    # which is NOT the same as a snapshot with an empty ``map``.
    #
    # PASS-THROUGH dicts, deliberately NOT typed as ``StratigraphyLumping``.
    # WHY: ``ProjectResponse`` serialises straight off the ORM row and
    # ``GET /projects/`` is a ``list[ProjectResponse]``. A single row whose
    # restored JSONB fails validation would raise ResponseValidationError and
    # 500 the ENTIRE project list — i.e. one poisoned project takes down the
    # start screen for every project. Validation belongs on the WRITE path
    # (``PUT .../staged`` already validates via
    # ``StratigraphyLumpingStageRequest``); the read path stays
    # pass-through, exactly like ``view_state``.
    #
    # Additive + optional: bundles and clients written before these
    # columns existed neither send nor read them.
    stratigraphy_lumping_staged: dict[str, Any] | None = None
    stratigraphy_lumping_saved: dict[str, Any] | None = None
    # Renderer-owned monotonic counter bumped on every stage. Exposed so the
    # crash-recovery prompt can compare it against the revision in the
    # recovery file (docs/design/autosave-recovery.md §3 — revision wins,
    # never the clock). ``None`` = never staged.
    stratigraphy_lumping_revision: int | None = None
