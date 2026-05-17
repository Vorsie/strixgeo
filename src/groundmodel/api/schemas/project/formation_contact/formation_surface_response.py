"""Pydantic schema: :class:`FormationSurfaceResponse`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FormationSurfaceResponse(BaseModel):
    """API representation of a cached TIN per (model, formation).

    Derived from the formation's contacts; the section consumer
    fetches these to render slice-of-TIN polylines instead of
    connect-the-dots. The bundle round-trip carries them so a
    .strix re-open doesn't pay the recompute cost up front.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    method: str
    # vertices: list of [x_m, y_m, elevation_m] tuples — typed as
    # ``list[list[float]]`` rather than the tighter
    # ``list[tuple[float, float, float]]`` because Pydantic JSON
    # serialises tuples as arrays anyway, and the frontend just
    # wants the array shape.
    vertices: list[list[float]]
    triangles: list[list[int]]
    source_contact_count: int
    # On-click build pivot: True when the cached TIN no longer
    # reflects the current contacts (a mutation flipped this since the
    # last build). The section consumer renders stale surfaces with a
    # demoted style (faded + dashed) until the user clicks Build.
    is_stale: bool = False
    created_at: datetime
    updated_at: datetime
