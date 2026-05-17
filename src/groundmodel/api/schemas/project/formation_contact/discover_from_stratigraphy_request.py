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
    manual_map: dict[str, str] | None = None
    """Optional ``{ normalize_formation_key(raw) -> target_formation_name }`` map.

    When provided, the discover scan applies the manual lump map and returns
    the merged candidate list + collision warnings so the dialog can show the
    user a preview of what the write path will produce (``discover≡apply``).
    ``None`` (omitted) = no lumping; every raw key remains its own candidate.
    """
