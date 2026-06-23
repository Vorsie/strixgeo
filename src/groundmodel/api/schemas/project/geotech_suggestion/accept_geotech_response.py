"""Pydantic schema: :class:`AcceptGeotechResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AcceptGeotechResponse(BaseModel):
    """Response of ``POST .../contacts/accept-geotech-suggestions``.

    Parameters
    ----------
    created_formation_ids : list[UUID]
        Classified geotech ``geological_formation`` rows created in this call.
    created_contact_ids : list[UUID]
        Geotech ``FormationContact`` rows created in this call.
    deleted_skeleton_ids : list[UUID]
        Orphaned skeleton formations deleted in this call.
    """

    created_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    deleted_skeleton_ids: list[UUID]
