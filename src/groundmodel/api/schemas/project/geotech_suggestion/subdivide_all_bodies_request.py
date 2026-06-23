"""Pydantic schema: :class:`SubdivideAllBodiesRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class SubdivideAllBodiesRequest(BaseModel):
    """Body of ``POST .../geotech/subdivide-all-bodies``.

    Parameters
    ----------
    section_id : UUID
        The cross-section whose in-corridor investigations are classified and
        materialised into geotech NAD spatial bodies.
    """

    section_id: UUID
