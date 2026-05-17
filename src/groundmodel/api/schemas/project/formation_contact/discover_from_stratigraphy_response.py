"""Pydantic schema: :class:`DiscoverFromStratigraphyResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from .formation_candidate_item import FormationCandidateItem


class DiscoverFromStratigraphyResponse(BaseModel):
    """Body returned by ``POST .../contacts/discover-from-stratigraphy``.

    Contains the full candidate list sorted by ``borehole_count`` descending
    then ``name`` ascending. Empty list when no borehole in scope carries
    stratigraphy data.
    """

    candidates: list[FormationCandidateItem]
