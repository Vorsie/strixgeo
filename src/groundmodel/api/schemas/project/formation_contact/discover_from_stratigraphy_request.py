"""Pydantic schema: :class:`DiscoverFromStratigraphyRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class DiscoverFromStratigraphyRequest(BaseModel):
    """Body of ``POST .../contacts/discover-from-stratigraphy``.

    Same validation shape as :class:`AutoPopulateFromStratigraphyRequest`:
    1..500 borehole ids. The endpoint is read-only — it runs the same scan
    but commits nothing.
    """

    borehole_ids: list[UUID] = Field(min_length=1, max_length=500)
