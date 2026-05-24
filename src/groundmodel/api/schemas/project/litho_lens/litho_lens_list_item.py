"""Pydantic schema: :class:`LithoLensListItem`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LithoLensListItem(BaseModel):
    """API representation of a single LithoLensOrm metadata row.

    Position 4: a metadata row is decoration attached to a body identified
    by ``(formation_id, body_ordinal)``.  The body itself is defined by
    the correlation resolver; this row is an optional human label.

    Attributes
    ----------
    id : UUID
        Metadata row identity.
    app_project_id : UUID
        Project scope.
    model_id : UUID
        The lithostratigraphic model this lens belongs to.
    formation_id : UUID
        The geological formation whose body this label is attached to.
    body_ordinal : int
        Zero-based ordinal assigned by the correlation resolver.
    name : str | None
        Optional human label.  UI falls back to a derived label when null.
    primary_section_id : UUID | None
        The section from which the naming gesture was invoked.
    created_at : datetime
        Row creation timestamp.
    updated_at : datetime
        Row last-modified timestamp.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    model_id: UUID
    formation_id: UUID
    body_ordinal: int
    name: str | None
    primary_section_id: UUID | None
    created_at: datetime
    updated_at: datetime
