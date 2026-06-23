"""Pydantic schema: :class:`SuggestGeotechRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class SuggestGeotechRequest(BaseModel):
    """Body of ``POST .../geotech/suggest``.

    Parameters
    ----------
    section_id : UUID
        The cross-section whose in-corridor investigations are processed for
        NAD packing sub-unit suggestions.
    """

    section_id: UUID
