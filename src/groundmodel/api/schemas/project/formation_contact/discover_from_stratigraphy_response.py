"""Pydantic schema: :class:`DiscoverFromStratigraphyResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from .formation_candidate_item import FormationCandidateItem
from .lumping_collision_item import LumpingCollisionItem


class DiscoverFromStratigraphyResponse(BaseModel):
    """Body returned by ``POST .../contacts/discover-from-stratigraphy``.

    Contains the full candidate list sorted by ``borehole_count`` descending
    then ``name`` ascending.  Empty list when no borehole in scope carries
    stratigraphy data.

    ``collisions`` is populated only when ``manual_map`` was provided and
    at least one borehole had ≥2 primary layers resolve to the same effective
    key after lumping.  Empty list when no ``manual_map`` is provided or when
    no collision occurred.  Mirrors the collision list the write path will
    return, so the dialog can show warnings before the user confirms.
    """

    candidates: list[FormationCandidateItem]
    collisions: list[LumpingCollisionItem] = []
