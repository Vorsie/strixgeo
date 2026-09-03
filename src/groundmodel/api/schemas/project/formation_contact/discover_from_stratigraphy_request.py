"""Pydantic schema: :class:`DiscoverFromStratigraphyRequest`."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# manual_map originates from a .gmproj file's lumping snapshot, which is
# attacker-controlled on the restore path. Bound it so a crafted payload
# cannot allocate an arbitrarily large dict during Pydantic validation.
# Mirrors AutoPopulateFromStratigraphyRequest.
_MAP_MAX_ENTRIES = 2_000
_KEY_STR_MAX = 512


class DiscoverFromStratigraphyRequest(StrictRequestModel):
    """Body of ``POST .../contacts/discover-from-stratigraphy``.

    Same validation shape as :class:`AutoPopulateFromStratigraphyRequest`:
    1..500 borehole ids. The endpoint is read-only — it runs the same scan
    but commits nothing.
    """

    borehole_ids: list[UUID] = Field(min_length=1, max_length=500)
    manual_map: (
        dict[
            Annotated[str, Field(max_length=_KEY_STR_MAX)],
            Annotated[str, Field(max_length=_KEY_STR_MAX)],
        ]
        | None
    ) = Field(default=None, max_length=_MAP_MAX_ENTRIES)
    """Optional ``{ normalize_formation_key(raw) -> target_formation_name }`` map.

    When provided, the discover scan applies the manual lump map and returns
    the merged candidate list + collision warnings so the dialog can show the
    user a preview of what the write path will produce (``discover≡apply``).
    ``None`` (omitted) = no lumping; every raw key remains its own candidate.
    """
