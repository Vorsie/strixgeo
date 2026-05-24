"""Pydantic schema: :class:`LithoLensListItem`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LithoLensListItem(BaseModel):
    """API representation of a single LithoLens row in a list response.

    Lightweight read-only item; the heavy contact-list and absence-list
    fields are omitted — the caller fetches them via the per-lens detail
    endpoint when needed.

    Attributes
    ----------
    id : UUID
        Lens identity.
    app_project_id : UUID
        Project scope.
    model_id : UUID
        The lithostratigraphic model this lens belongs to.
    parent_formation_id : UUID
        The formation the lens carves a body out of.
    name : str | None
        Optional human label.  UI falls back to a derived label when null.
    primary_section_id : UUID | None
        The section on which this lens was originally defined.
    created_at : datetime
        Row creation timestamp.
    updated_at : datetime
        Row last-modified timestamp.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    model_id: UUID
    parent_formation_id: UUID
    name: str | None
    primary_section_id: UUID | None
    created_at: datetime
    updated_at: datetime
