"""Pydantic schema: :class:`BuildGeotechRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class BuildGeotechRequest(BaseModel):
    """Body of ``POST .../geotech/build``.

    Parameters
    ----------
    section_id : UUID
        The cross-section whose in-corridor investigations are subdivided into
        the geo-bounded geotech skeleton.
    """

    section_id: UUID
