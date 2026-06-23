"""Pydantic schema: :class:`BuildGeotechResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class BuildGeotechResponse(BaseModel):
    """Response of ``POST .../geotech/build``.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model created or reused.
    created_model : bool
        ``True`` when the geotech model was created in this call; ``False``
        when an existing one was reused.
    created_formation_ids : list[UUID]
        Skeleton geotech ``geological_formation`` rows created in this call.
    created_contact_ids : list[UUID]
        Geotech ``FormationContact`` rows created in this call.
    divided_contact_count : int
        Count of geo-division cuts (segments whose top is a geological-boundary
        cut, not a carried-through litho top).
    """

    geotech_model_id: UUID
    created_model: bool
    created_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    divided_contact_count: int
